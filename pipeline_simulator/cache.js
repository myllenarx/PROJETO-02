// ===================== ASSOCIATIVE CACHE LRU (WB/WA) =====================
class AssociativeCache {
  constructor(config = {}) {
    this.name = config.name || "L1";
    this.sizeWords = config.sizeWords || 256;
    this.lineSizeWords = config.lineSizeWords || 4;
    this.associativity = config.associativity || 2;
    this.hitTime = config.hitTime || 1;
    this.missPenalty = config.missPenalty || 10;

    const numLines = Math.max(1, Math.floor(this.sizeWords / this.lineSizeWords));
    this.numSets = Math.max(1, Math.floor(numLines / this.associativity));
    this.sets = Array.from({ length: this.numSets }, () =>
      new Array(this.associativity).fill(null).map(() => ({ valid:false, tag:null, dirty:false, data: new Array(this.lineSizeWords).fill(0), _blockAddrCached:null }))
    );
    this.lru = Array.from({ length: this.numSets }, () => Array.from({ length: this.associativity }, (_, i) => i));

    this.hits = 0; this.misses = 0;
  }

  _blockAddr(addrWord) { return Math.floor(addrWord / this.lineSizeWords); }
  _setIndex(blockAddr) { return blockAddr % this.numSets; }
  _tag(blockAddr) { return Math.floor(blockAddr / this.numSets); }

  _updateLRUOnAccess(setIndex, wayIndex) {
    const arr = this.lru[setIndex];
    const pos = arr.indexOf(wayIndex);
    if (pos !== -1) arr.splice(pos,1);
    arr.push(wayIndex);
  }

  _evictIfNeeded(setIndex, wayIndex, memory) {
    const way = this.sets[setIndex][wayIndex];
    if (!way.valid) return;
    if (way.dirty) {
      const evictedBlockAddr = way._blockAddrCached;
      const base = evictedBlockAddr * this.lineSizeWords;
      for (let i = 0; i < this.lineSizeWords; i++) {
        memory.store(base + i, way.data[i]);
      }
    }
    way.valid = false; way.dirty = false; way.tag = null; way._blockAddrCached = null;
    way.data.fill(0);
  }

  _fillBlock(setIndex, tag, blockAddr, memory) {
    let wayIdx = this.sets[setIndex].findIndex(w => !w.valid);
    if (wayIdx === -1) {
      wayIdx = this.lru[setIndex][0]; // LRU way
      this._evictIfNeeded(setIndex, wayIdx, memory);
    }
    const way = this.sets[setIndex][wayIdx];
    way.valid = true; way.tag = tag; way.dirty = false; way._blockAddrCached = blockAddr;
    const base = blockAddr * this.lineSizeWords;
    for (let i = 0; i < this.lineSizeWords; i++) way.data[i] = memory.load(base + i);
    this._updateLRUOnAccess(setIndex, wayIdx);
    return wayIdx;
  }

  readInstr(addrWordIndex, programArray) {
    const blockAddr = this._blockAddr(addrWordIndex);
    const setIndex = this._setIndex(blockAddr);
    const tag = this._tag(blockAddr);

    for (let w=0; w < this.associativity; w++) {
      const way = this.sets[setIndex][w];
      if (way.valid && way.tag === tag) {
        this.hits++; this._updateLRUOnAccess(setIndex,w);
        return { hit:true, latency:this.hitTime, instr: programArray[addrWordIndex] || null };
      }
    }
    this.misses++;
    this._fillBlock(setIndex, tag, blockAddr, { load: (a)=> programArray[a], store: ()=>{} });
    return { hit:false, latency:this.missPenalty, instr: programArray[addrWordIndex] || null };
  }

  read(addrWordIndex, memory) {
    const blockAddr = this._blockAddr(addrWordIndex);
    const setIndex = this._setIndex(blockAddr);
    const tag = this._tag(blockAddr);
    const offset = addrWordIndex % this.lineSizeWords;

    for (let w=0; w < this.associativity; w++) {
      const way = this.sets[setIndex][w];
      if (way.valid && way.tag === tag) {
        this.hits++; this._updateLRUOnAccess(setIndex,w);
        return { hit:true, latency:this.hitTime, value: way.data[offset] };
      }
    }
    this.misses++;
    const filled = this._fillBlock(setIndex, tag, blockAddr, memory);
    const way = this.sets[setIndex][filled];
    return { hit:false, latency:this.missPenalty, value: way.data[offset] };
  }

  write(addrWordIndex, value, memory) {
    const blockAddr = this._blockAddr(addrWordIndex);
    const setIndex = this._setIndex(blockAddr);
    const tag = this._tag(blockAddr);
    const offset = addrWordIndex % this.lineSizeWords;

    for (let w=0; w < this.associativity; w++) {
      const way = this.sets[setIndex][w];
      if (way.valid && way.tag === tag) {
        way.data[offset] = value; way.dirty = true;
        this.hits++; this._updateLRUOnAccess(setIndex,w);
        return { hit:true, latency:this.hitTime };
      }
    }
    this.misses++;
    const filled = this._fillBlock(setIndex, tag, blockAddr, memory);
    const way = this.sets[setIndex][filled];
    way.data[offset] = value; way.dirty = true;
    return { hit:false, latency:this.missPenalty };
  }

  stats() { const total = this.hits + this.misses; return { name:this.name, hits:this.hits, misses:this.misses, hitRate: total ? (this.hits/total) : 1.0 }; }
}
