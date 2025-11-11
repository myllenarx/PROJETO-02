// ==========================================================
// cache.js – Hierarquia de memória (CORRIGIDO)
// ==========================================================

class AssociativeCache {
  constructor({
    name = "L1",
    sizeWords = 64,
    lineSizeWords = 4,
    associativity = 2,
    hitTime = 1,
    missPenalty = 10,
    writePolicy = "WB", // WB (write-back) | WT (write-through)
    allocatePolicy = "WA" // WA (write-allocate) | WNA (write-no-allocate)
  } = {}) {
    this.name = name;
    this.sizeWords = sizeWords;
    this.lineSizeWords = lineSizeWords;
    this.associativity = associativity;
    this.hitTime = hitTime;
    this.missPenalty = missPenalty;
    this.writePolicy = writePolicy;
    this.allocatePolicy = allocatePolicy;

    this.numSets = Math.floor(sizeWords / (lineSizeWords * associativity));
    if (this.numSets < 1) throw new Error(`${this.name}: geometria inválida`);

    const isPowerOfTwo = n => (Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0);
    if (!isPowerOfTwo(lineSizeWords) || !isPowerOfTwo(this.numSets)) {
      console.warn(`${this.name}: use potências de 2 (lineSizeWords=${lineSizeWords}, numSets=${this.numSets})`);
    }

    this.offsetBits = Math.log2(this.lineSizeWords) | 0;
    this.indexBits = Math.log2(this.numSets) | 0;

    this.sets = Array.from({ length: this.numSets }, () => []);
    this.hits = this.misses = this.accesses = 0;
    this.nextLevel = null;
    this.lruCounter = 0; // Contador global para LRU preciso
  }

  decodeAddress(addrWord) {
    const offset = addrWord & ((1 << this.offsetBits) - 1);
    const index = (addrWord >> this.offsetBits) & ((1 << this.indexBits) - 1);
    const tag = addrWord >> (this.offsetBits + this.indexBits);
    return { tag, index, offset };
  }

  // CORRIGIDO: Reconstruir endereço completo a partir de tag e index
  reconstructAddress(tag, index) {
    return (tag << (this.indexBits + this.offsetBits)) | (index << this.offsetBits);
  }

  touchLine(set, line) {
    // CORRIGIDO: LRU usando contador global ao invés de timestamp
    line.lastAccess = ++this.lruCounter;
  }

  evictLRU(set) { 
    // CORRIGIDO: Implementação precisa de LRU
    let oldest = set[0];
    let oldestIndex = 0;
    for (let i = 1; i < set.length; i++) {
      if (set[i].lastAccess < oldest.lastAccess) {
        oldest = set[i];
        oldestIndex = i;
      }
    }
    return set.splice(oldestIndex, 1)[0];
  }

  // Lê uma linha inteira do nível inferior e retorna {latencyTotal, lineData[]}
  _fetchLineFromNext(addrWordBase, nextLevel) {
    const data = new Array(this.lineSizeWords).fill(0);
    let latency = 0;

    // Realiza UMA leitura para contabilizar a latência do nível inferior
    const res0 = nextLevel.read(addrWordBase, nextLevel.nextLevel);
    latency += res0.latency;
    data[0] = res0.value ?? 0;

    // Obtém as demais palavras sem somar latência novamente
    for (let i = 1; i < this.lineSizeWords; i++) {
      const r = nextLevel.read(addrWordBase + i, nextLevel.nextLevel);
      data[i] = r.value ?? 0;
    }
    return { latency, data };
  }

  // CORRIGIDO: Writeback de vítima com endereço correto
  _writebackVictim(victim, index, nextLevel) {
    if (!victim || !victim.dirty || this.writePolicy !== "WB" || !nextLevel) {
      return 0;
    }

    let latency = 0;
    // CORRIGIDO: Reconstruir endereço base correto da vítima
    const victimAddrBase = this.reconstructAddress(victim.tag, index);
    
    for (let i = 0; i < this.lineSizeWords; i++) {
      const wr = nextLevel.write(victimAddrBase + i, victim.data[i] ?? 0, nextLevel.nextLevel);
      latency += wr.latency || 0;
    }
    
    return latency;
  }

  read(addrWord, nextLevel = null) {
    this.accesses++;
    const { tag, index, offset } = this.decodeAddress(addrWord);
    const set = this.sets[index];
    const line = set.find(l => l.valid && l.tag === tag);

    if (line) {
      this.hits++;
      this.touchLine(set, line);
      return { hit: true, latency: this.hitTime, value: line.data[offset] ?? 0, level: this.name };
    }

    this.misses++;
    let latency = this.hitTime + this.missPenalty;
    let value = 0;

    if (nextLevel) {
      // CORRIGIDO: Calcular corretamente o endereço base da linha
      const lineBaseAddr = addrWord & ~((1 << this.offsetBits) - 1);
      const { latency: lowerLat, data: lineData } = this._fetchLineFromNext(lineBaseAddr, nextLevel);
      latency += lowerLat;
      value = lineData[offset];

      const newLine = { 
        tag, 
        valid: true, 
        dirty: false, 
        data: lineData, 
        lastAccess: ++this.lruCounter 
      };

      if (set.length >= this.associativity) {
        const victim = this.evictLRU(set);
        // CORRIGIDO: Usar função auxiliar para writeback
        latency += this._writebackVictim(victim, index, nextLevel);
      }
      set.unshift(newLine);
    }

    return { hit: false, latency, value, level: this.name };
  }

  write(addrWord, value, nextLevel = null) {
    this.accesses++;
    const { tag, index, offset } = this.decodeAddress(addrWord);
    const set = this.sets[index];
    const line = set.find(l => l.valid && l.tag === tag);

    if (line) {
      this.hits++;
      this.touchLine(set, line);
      line.data[offset] = value;
      let latency = this.hitTime;

      if (this.writePolicy === "WB") {
        line.dirty = true;
      } else if (nextLevel) { // WT
        const wr = nextLevel.write(addrWord, value, nextLevel.nextLevel);
        latency += wr.latency || 0;
      }
      return { hit: true, latency, level: this.name };
    }

    // MISS
    this.misses++;
    let latency = this.hitTime + this.missPenalty;
    
    if (this.allocatePolicy === "WA" && nextLevel) {
      // CORRIGIDO: Calcular corretamente o endereço base da linha
      const lineBaseAddr = addrWord & ~((1 << this.offsetBits) - 1);
      const { latency: lowerLat, data: lineData } = this._fetchLineFromNext(lineBaseAddr, nextLevel);
      latency += lowerLat;

      lineData[offset] = value;
      const newLine = { 
        tag, 
        valid: true, 
        dirty: this.writePolicy === "WB", 
        data: lineData, 
        lastAccess: ++this.lruCounter 
      };

      if (set.length >= this.associativity) {
        const victim = this.evictLRU(set);
        // CORRIGIDO: Usar função auxiliar para writeback
        latency += this._writebackVictim(victim, index, nextLevel);
      }
      set.unshift(newLine);
    } else if (nextLevel) {
      const wr = nextLevel.write(addrWord, value, nextLevel.nextLevel);
      latency += wr.latency || 0;
    }

    return { hit: false, latency, level: this.name };
  }

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

class MainMemory {
  constructor(latency = 50) { 
    this.latency = latency; 
    this.storage = new Map(); 
    this.accesses = 0; 
  }
  
  read(addrWord) { 
    this.accesses++; 
    return { 
      hit: true, 
      latency: this.latency, 
      value: this.storage.get(addrWord) ?? 0, 
      level: "DRAM" 
    }; 
  }
  
  write(addrWord, value) { 
    this.accesses++; 
    this.storage.set(addrWord, value); 
    return { 
      hit: true, 
      latency: this.latency, 
      level: "DRAM" 
    }; 
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

class MemoryHierarchy {
  constructor() {
    this.L3 = new AssociativeCache({ 
      name: "L3", 
      sizeWords: 512, 
      lineSizeWords: 8, 
      associativity: 8, 
      hitTime: 8, 
      missPenalty: 10 
    });
    
    this.L2 = new AssociativeCache({ 
      name: "L2", 
      sizeWords: 256, 
      lineSizeWords: 4, 
      associativity: 4, 
      hitTime: 2, 
      missPenalty: 5 
    });
    
    this.L1I = new AssociativeCache({ 
      name: "L1I", 
      sizeWords: 64, 
      lineSizeWords: 4, 
      associativity: 2, 
      hitTime: 1, 
      missPenalty: 2, 
      writePolicy: "WT" 
    });
    
    this.L1D = new AssociativeCache({ 
      name: "L1D", 
      sizeWords: 64, 
      lineSizeWords: 4, 
      associativity: 2, 
      hitTime: 1, 
      missPenalty: 2 
    });
    
    this.DRAM = new MainMemory(50);
    
    this.L1I.nextLevel = this.L2; 
    this.L1D.nextLevel = this.L2; 
    this.L2.nextLevel = this.L3; 
    this.L3.nextLevel = this.DRAM;
  }
  
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
      this.L3.stats(), 
      this.DRAM.stats()
    ]; 
  }
}

window.AssociativeCache = AssociativeCache;
window.MemoryHierarchy = MemoryHierarchy;
window.MainMemory = MainMemory;