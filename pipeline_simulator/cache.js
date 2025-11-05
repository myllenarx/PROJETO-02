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

    // Cálculo da geometria
    this.numSets = Math.floor(sizeWords / (lineSizeWords * associativity));
    if (this.numSets < 1) {
      throw new Error(`${this.name}: invalid cache geometry`);
    }

    // Função utilitária: verificar potência de 2
    const isPowerOfTwo = n => (Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0);
    if (!isPowerOfTwo(lineSizeWords) || !isPowerOfTwo(this.numSets)) {
      console.warn(`${this.name}: recommended power-of-two config (lineSizeWords=${lineSizeWords}, numSets=${this.numSets})`);
    }

    this.offsetBits = Math.log2(this.lineSizeWords) | 0;
    this.indexBits = Math.log2(this.numSets) | 0;

    // Inicializa sets e estatísticas
    this.sets = Array.from({ length: this.numSets }, () => []);
    this.hits = 0;
    this.misses = 0;
    this.accesses = 0;

    this.nextLevel = null;
  }

  // ==========================================================
  // Mapeamento de endereço
  // ==========================================================
  decodeAddress(addrWord) {
    const offset = addrWord & ((1 << this.offsetBits) - 1);
    const index = (addrWord >> this.offsetBits) & ((1 << this.indexBits) - 1);
    const tag = addrWord >> (this.offsetBits + this.indexBits);
    return { tag, index, offset };
  }

  touchLine(set, line) {
    const idx = set.indexOf(line);
    if (idx >= 0) {
      set.splice(idx, 1);
      set.unshift(line);
    }
  }

  evictLRU(set) {
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
    let value = 0;
    let latency = this.hitTime + this.missPenalty;

    if (nextLevel) {
      const res = nextLevel.read(addrWord, nextLevel.nextLevel);
      latency += res.latency;
      value = res.value;
    }

    const newLine = { tag, valid: true, dirty: false, data: [value] };
    if (set.length >= this.associativity) {
      const victim = this.evictLRU(set);
      if (victim?.dirty && this.writePolicy === "WB" && nextLevel) {
        nextLevel.writeBack(victim.tag, index, victim.data[0]);
      }
    }

    set.unshift(newLine);
    return { hit: false, latency, value, level: this.name };
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
    let latency = this.hitTime + this.missPenalty;

    if (this.allocatePolicy === "WA" && nextLevel) {
      const res = nextLevel.read(addrWord, nextLevel.nextLevel);
      latency += res.latency;
      const newLine = { tag, valid: true, dirty: this.writePolicy === "WB", data: [value] };

      if (set.length >= this.associativity) {
        const victim = this.evictLRU(set);
        if (victim?.dirty && this.writePolicy === "WB" && nextLevel) {
          nextLevel.writeBack(victim.tag, index, victim.data[0]);
        }
      }

      set.unshift(newLine);
    } else if (nextLevel) {
      nextLevel.write(addrWord, value, nextLevel.nextLevel);
    }

    return { hit: false, latency, level: this.name };
  }

  // ==========================================================
  // Escrita via write-back
  // ==========================================================
  writeBack(tag, index, value) {
    const addrWord = ((tag << this.indexBits) | index) * this.lineSizeWords;
    if (this.nextLevel) {
      this.nextLevel.write(addrWord, value, this.nextLevel.nextLevel);
    }
  }

  // ==========================================================
  // Estatísticas
  // ==========================================================
  stats() {
    const hitRate = this.accesses ? this.hits / this.accesses : 1;
    return {
      name: this.name,
      accesses: this.accesses,
      hits: this.hits,
      misses: this.misses,
      hitRate: (hitRate * 100).toFixed(2),
      missRate: ((1 - hitRate) * 100).toFixed(2)
    };
  }
}

// ==========================================================
// Memória principal (DRAM)
// ==========================================================
class MainMemory {
  constructor(latency = 50) {
    this.latency = latency;
    this.storage = new Map();
    this.accesses = 0;
  }

  read(addrWord) {
    this.accesses++;
    const value = this.storage.get(addrWord) || 0;
    return { hit: true, latency: this.latency, value, level: "DRAM" };
  }

  write(addrWord, value) {
    this.accesses++;
    this.storage.set(addrWord, value);
    return { hit: true, latency: this.latency, level: "DRAM" };
  }

  stats() {
    return {
      name: "DRAM",
      accesses: this.accesses,
      hits: this.accesses,
      misses: 0,
      hitRate: "100.00",
      missRate: "0.00"
    };
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

    // Ligações hierárquicas
    this.L1I.nextLevel = this.L2;
    this.L1D.nextLevel = this.L2;
    this.L2.nextLevel = this.L3;
    this.L3.nextLevel = this.DRAM;
  }

  readInstr(addrWord) { return this.L1I.read(addrWord, this.L1I.nextLevel); }
  readData(addrWord) { return this.L1D.read(addrWord, this.L1D.nextLevel); }
  writeData(addrWord, value) { return this.L1D.write(addrWord, value, this.L1D.nextLevel); }

  // ✅ Retorna todas as estatísticas juntas
  stats() {
    return [
      this.L1I.stats(),
      this.L1D.stats(),
      this.L2.stats(),
      this.L3.stats(),
      this.DRAM.stats()
    ];
  }
}

// ==========================================================
// Exporta globalmente
// ==========================================================
window.AssociativeCache = AssociativeCache;
window.MemoryHierarchy = MemoryHierarchy;
window.MainMemory = MainMemory;
