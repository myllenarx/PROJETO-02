// ==========================================================
// cache.js – Hierarquia de memória completa (L1 → L2 → L3 → DRAM)
// ==========================================================

// ==========================================================
// Classe base: Cache associativa (com LRU)
// ==========================================================
class AssociativeCache {
  constructor({
    name = "L1",
    sizeWords = 64,
    lineSizeWords = 4,
    associativity = 2,
    hitTime = 1,
    missPenalty = 10,
    writePolicy = "WB", // WB (Write-Back) | WT (Write-Through)
    allocatePolicy = "WA" // WA (Write-Allocate) | WNA (Write-No-Allocate)
  } = {}) {
    this.name = name;
    this.sizeWords = sizeWords;
    this.lineSizeWords = lineSizeWords;
    this.associativity = associativity;
    this.hitTime = hitTime;
    this.missPenalty = missPenalty;
    this.writePolicy = writePolicy;
    this.allocatePolicy = allocatePolicy;

    // --- validação e configuração de geometria da cache ---
    this.numSets = Math.floor(sizeWords / (lineSizeWords * associativity));

    // validação básica: numSets deve ser >= 1
    if (this.numSets < 1) {
    throw new Error(`${this.name}: invalid cache geometry — computed numSets < 1. ` +
                    `Verifique sizeWords (${sizeWords}), lineSizeWords (${lineSizeWords}) e associativity (${associativity}).`);
    }

    // utilitário: potência de 2
    const isPowerOfTwo = (n) => (Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0);

    // recomende (warn) potências de 2 para operações bitwise corretas
    if (!isPowerOfTwo(lineSizeWords) || !isPowerOfTwo(this.numSets)) {
    console.warn(`${this.name}: recommended that lineSizeWords (${lineSizeWords}) and numSets (${this.numSets}) ` +
                `are powers of two. decodeAddress uses bit-shifts/masks and may behave unexpectedly otherwise.`);
    }

    // calcule e armazene os deslocamentos (bits) para uso posterior
    this.offsetBits = Math.log2(this.lineSizeWords) | 0;
    this.indexBits  = Math.log2(this.numSets) | 0;

    // inicializa as sets (agora que numSets foi validado)
    this.sets = Array.from({ length: this.numSets }, () => []);


    // Estatísticas
    this.hits = 0;
    this.misses = 0;
    this.accesses = 0;
  }

  // ==========================================================
  // Mapeamento: TAG, INDEX, OFFSET
  // ==========================================================
    decodeAddress(addrWord) {
    // usa os bits pré-calculados (garante consistência e evita (Math.log2) em cada acesso)
    const offset = addrWord & ((1 << this.offsetBits) - 1);
    const index  = (addrWord >> this.offsetBits) & ((1 << this.indexBits) - 1);
    const tag    = addrWord >> (this.offsetBits + this.indexBits);
    return { tag, index, offset };
    }

  // ==========================================================
  // Política de substituição LRU
  // ==========================================================
  touchLine(set, line) {
    // Move linha usada para frente (mais recente)
    const idx = set.indexOf(line);
    if (idx >= 0) {
      set.splice(idx, 1);
      set.unshift(line);
    }
  }

  evictLRU(set) {
    // Remove a menos usada (última posição)
    return set.pop();
  }

  // ==========================================================
  // Leitura
  // ==========================================================
  read(addrWord, nextLevel = null) {
    this.accesses++;
    const { tag, index } = this.decodeAddress(addrWord);
    const set = this.sets[index];
    const line = set.find(l => l.valid && l.tag === tag);

    // HIT
    if (line) {
      this.hits++;
      this.touchLine(set, line);
      return { hit: true, latency: this.hitTime, value: line.data[0], level: this.name };
    }

    // MISS
    this.misses++;
    let totalLatency = this.hitTime + this.missPenalty;
    let value = 0;

    // Busca no próximo nível, se existir
    if (nextLevel) {
      const res = nextLevel.read(addrWord, nextLevel.nextLevel);
      totalLatency = this.hitTime + res.latency;
      value = res.value;
    }

    // Substituição LRU
    const newLine = { tag, valid: true, dirty: false, data: [value] };
    if (set.length >= this.associativity) {
      const victim = this.evictLRU(set);
      // Write-back: envia dado sujo ao nível inferior
      if (victim.dirty && this.writePolicy === "WB" && nextLevel) {
        nextLevel.writeBack(victim.tag, index, victim.data[0]);
      }
    }
    set.unshift(newLine);
    return { hit: false, latency: totalLatency, value, level: this.name };
  }

  // ==========================================================
  // Escrita
  // ==========================================================
  write(addrWord, value, nextLevel = null) {
    this.accesses++;
    const { tag, index } = this.decodeAddress(addrWord);
    const set = this.sets[index];
    const line = set.find(l => l.valid && l.tag === tag);

    // HIT
    if (line) {
      this.hits++;
      this.touchLine(set, line);
      line.data[0] = value;
      if (this.writePolicy === "WB") line.dirty = true;
      else if (nextLevel) nextLevel.write(addrWord, value, nextLevel.nextLevel);
      return { hit: true, latency: this.hitTime, level: this.name };
    }

    // MISS
    this.misses++;
    let totalLatency = this.hitTime + this.missPenalty;

    // Write-allocate: traz linha e grava nela
    if (this.allocatePolicy === "WA" && nextLevel) {
    // lê do nível inferior (para simular alocação da linha)
    const res = nextLevel.read(addrWord, nextLevel.nextLevel);
    totalLatency += res.latency;

    // cria a nova linha com o valor atualizado
    const newLine = { tag, valid: true, dirty: this.writePolicy === "WB", data: [value] };

    // se o conjunto estiver cheio, evict LRU com write-back se necessário
    if (set.length >= this.associativity) {
        const victim = this.evictLRU(set);
        if (victim && victim.dirty && this.writePolicy === "WB" && nextLevel) {
        nextLevel.writeBack(victim.tag, index, victim.data[0]);
        }
    }

    // insere a nova linha como a mais recentemente usada
    set.unshift(newLine);
    } else if (nextLevel) {
    // Write-no-allocate: escreve diretamente no nível inferior
    nextLevel.write(addrWord, value, nextLevel.nextLevel);
    }
    else if (nextLevel) {
      // Write-no-allocate
      nextLevel.write(addrWord, value, nextLevel.nextLevel);
    }

    return { hit: false, latency: totalLatency, level: this.name };
  }

  // ==========================================================
  // Escrita via write-back (vítima suja)
  // ==========================================================
  writeBack(tag, index, value) {
    const addrWord = ((tag << this.indexBits) | index) * this.lineSizeWords;
    if (this.nextLevel) {
        this.nextLevel.write(addrWord, value, this.nextLevel.nextLevel);
    } else {
        // se não houver nextLevel, escreva aqui (DRAM normalmente)
        this.write(addrWord, value, null);
    }
   }


  // ==========================================================
  // Estatísticas
  // ==========================================================
  stats() {
    const hitRate = this.accesses ? this.hits / this.accesses : 1;
    const missRate = 1 - hitRate;
    return {
      name: this.name,
      accesses: this.accesses,
      hits: this.hits,
      misses: this.misses,
      hitRate,
      missRate
    };
  }
}

// ==========================================================
// Memória principal (DRAM)
// ==========================================================
class MainMemory {
  constructor(latency = 50) {
    this.latency = latency;
    this.storage = new Map(); // Simples, mapeia endereços → valores
  }

  read(addrWord) {
    const value = this.storage.get(addrWord) || 0;
    return { hit: true, latency: this.latency, value, level: "DRAM" };
  }

  write(addrWord, value) {
    this.storage.set(addrWord, value);
    return { hit: true, latency: this.latency, level: "DRAM" };
  }
}

// ==========================================================
// Hierarquia completa de memória (L1I, L1D, L2, L3, DRAM)
// ==========================================================
class MemoryHierarchy {
  constructor() {
    this.L3 = new AssociativeCache({
      name: "L3",
      sizeWords: 512,
      lineSizeWords: 8,
      associativity: 8,
      hitTime: 12,
      missPenalty: 30,
      writePolicy: "WB",
      allocatePolicy: "WA"
    });

    this.L2 = new AssociativeCache({
      name: "L2",
      sizeWords: 256,
      lineSizeWords: 4,
      associativity: 4,
      hitTime: 4,
      missPenalty: 12,
      writePolicy: "WB",
      allocatePolicy: "WA"
    });

    this.L1I = new AssociativeCache({
      name: "L1I",
      sizeWords: 64,
      lineSizeWords: 4,
      associativity: 2,
      hitTime: 1,
      missPenalty: 6,
      writePolicy: "WT",
      allocatePolicy: "WA"
    });

    this.L1D = new AssociativeCache({
      name: "L1D",
      sizeWords: 64,
      lineSizeWords: 4,
      associativity: 2,
      hitTime: 1,
      missPenalty: 8,
      writePolicy: "WB",
      allocatePolicy: "WA"
    });

    this.DRAM = new MainMemory(50);

    // Ligações hierárquicas (em cascata)
    this.L1I.nextLevel = this.L2;
    this.L1D.nextLevel = this.L2;
    this.L2.nextLevel = this.L3;
    this.L3.nextLevel = this.DRAM;
  }

  // ==========================================================
  // Interfaces simples para o pipeline
  // ==========================================================
  readInstr(addrWord) {
    return this.L1I.read(addrWord, this.L1I.nextLevel);
  }

  readData(addrWord) {
    return this.L1D.read(addrWord, this.L1D.nextLevel);
  }

  writeData(addrWord, value) {
    return this.L1D.write(addrWord, value, this.L1D.nextLevel);
  }

  stats() {
    return [
      this.L1I.stats(),
      this.L1D.stats(),
      this.L2.stats(),
      this.L3.stats()
    ];
  }
}

// ==========================================================
// Exporta globalmente (para uso no navegador)
// ==========================================================
window.AssociativeCache = AssociativeCache;
window.MemoryHierarchy = MemoryHierarchy;
window.MainMemory = MainMemory;
