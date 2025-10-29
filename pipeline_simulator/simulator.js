// simulator.js
// Simulador pipeline 5 estágios (IF, ID, EX, MEM, WB)
// Fase completa: hazards, forwarding, 1-bit predictor, caches associativas LRU WB/WA
// Desenvolvido para rodar no navegador (VS Code + Live Server)

// ===================== UTILITÁRIOS / PARSER =====================
function isRegisterToken(tok) { return tok && tok.startsWith("x"); }
function regNum(tok) { return parseInt(tok.substring(1)); }

// Parse simples: suporta:
// add rd rs1 rs2
// sub, and, or, xor, slt
// addi rd rs1 imm
// lw rd, imm(xrs1)
// sw rs2, imm(xrs1)
// beq rs1 rs2 offset   (offset is relative number of instructions)
// bne ...
// jal rd, offset
// jalr rd, imm(xrs1)
function parseInstruction(line) {
  if (!line) return { opcode: "nop" };
  const s = line.trim();
  if (s === "" || s.startsWith("#")) return { opcode: "nop" };
  const t = s.replace(",", " ").split(/\s+/);
  const op = t[0];
  try {
    switch (op) {
      case "add": case "sub": case "and": case "or": case "xor": case "slt":
        return { opcode: op, rd: regNum(t[1]), rs1: regNum(t[2]), rs2: regNum(t[3]) };
      case "addi":
        return { opcode: op, rd: regNum(t[1]), rs1: regNum(t[2]), imm: parseInt(t[3]) };
      case "lw": {
        // lw x1, imm(x2)
        const match = t[2].match(/(-?\d+)\(x(\d+)\)/);
        return { opcode: op, rd: regNum(t[1]), rs1: parseInt(match[2]), imm: parseInt(match[1]) };
      }
      case "sw": {
        // sw x2, imm(x1)
        const match = t[2].match(/(-?\d+)\(x(\d+)\)/);
        return { opcode: op, rs2: regNum(t[1]), rs1: parseInt(match[2]), imm: parseInt(match[1]) };
      }
      case "beq": case "bne":
        return { opcode: op, rs1: regNum(t[1]), rs2: regNum(t[2]), imm: parseInt(t[3]) };
      case "jal":
        return { opcode: op, rd: regNum(t[1]), imm: parseInt(t[2]) }; // imm = target offset (relative)
      case "jalr": {
        const match = t[2].match(/(-?\d+)\(x(\d+)\)/);
        return { opcode: op, rd: regNum(t[1]), rs1: parseInt(match[2]), imm: parseInt(match[1]) };
      }
      case "nop":
      default:
        return { opcode: "nop" };
    }
  } catch (e) {
    return { opcode: "nop" };
  }
}

// ===================== REGISTER FILE & MEMORY =====================
class RegisterFile {
  constructor() { this.regs = Array(32).fill(0); }
  read(num) { return num === 0 ? 0 : this.regs[num]; }
  write(num, value) { if (num !== 0) this.regs[num] = value; }
  dump() { return this.regs.map((v,i)=>`x${i}=${v}`).join(" "); }
}

class Memory {
  constructor(sizeWords = 4096) { this.data = new Array(sizeWords).fill(0); }
  load(addrWord) { return this.data[addrWord] || 0; }
  store(addrWord, value) { this.data[addrWord] = value; }
}

// ===================== ONE-BIT PREDICTOR =====================
class OneBitPredictor {
  constructor(size = 64) {
    this.size = size;
    this.table = new Uint8Array(size); // 0 -> not-taken, 1 -> taken
  }
  index(pc) { return pc & (this.size - 1); }
  predict(pc) { return this.table[this.index(pc)] === 1; }
  update(pc, taken) { this.table[this.index(pc)] = taken ? 1 : 0; }
}

// ===================== ASSOCIATIVE CACHE LRU (WB/WA) =====================
class AssociativeCache {
  // config: { name, sizeWords, lineSizeWords, associativity, hitTime, missPenalty }
  constructor(config = {}) {
    this.name = config.name || "L1";
    this.sizeWords = config.sizeWords || 256; // treat as words
    this.lineSizeWords = config.lineSizeWords || 4;
    this.associativity = config.associativity || 2;
    this.hitTime = config.hitTime || 1;
    this.missPenalty = config.missPenalty || 10;

    const numLines = Math.max(1, Math.floor(this.sizeWords / this.lineSizeWords));
    this.numSets = Math.max(1, Math.floor(numLines / this.associativity));
    this.sets = Array.from({ length: this.numSets }, () =>
      new Array(this.associativity).fill(null).map(() => ({ valid:false, tag:null, dirty:false, data: new Array(this.lineSizeWords).fill(0), _blockAddrCached:null }))
    );
    // LRU arrays: least recently used at index 0
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

  // Instruction fetch (reads program array at addr)
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
    // fill block (evict if needed)
    this._fillBlock(setIndex, tag, blockAddr, { load: (a)=> programArray[a], store: ()=>{} , loadRaw: ()=>{} , storeRaw: ()=>{} , /* memory facade */ });
    return { hit:false, latency:this.missPenalty, instr: programArray[addrWordIndex] || null };
  }

  // Data read (lw)
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
    // miss -> fill
    this.misses++;
    const filled = this._fillBlock(setIndex, tag, blockAddr, memory);
    const way = this.sets[setIndex][filled];
    return { hit:false, latency:this.missPenalty, value: way.data[offset] };
  }

  // Data write (sw) - write-back + write-allocate
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
    // miss: write-allocate (fill then write)
    this.misses++;
    const filled = this._fillBlock(setIndex, tag, blockAddr, memory);
    const way = this.sets[setIndex][filled];
    way.data[offset] = value; way.dirty = true;
    return { hit:false, latency:this.missPenalty };
  }

  stats() { const total = this.hits + this.misses; return { name:this.name, hits:this.hits, misses:this.misses, hitRate: total ? (this.hits/total) : 1.0 }; }
}

// ===================== PIPELINE SIMULATOR =====================
class PipelineSimulator {
  constructor(programLines = [], config = {}) {
    // program array (parsed)
    this.program = programLines.map(parseInstruction);
    this.pc = 0;

    this.regFile = new RegisterFile();
    this.memory = new Memory(config.memorySizeWords || 4096);

    // caches
    this.cacheI = new AssociativeCache({
      name: "L1I",
      sizeWords: config.L1ISizeWords || 256,
      lineSizeWords: config.L1ILineWords || 4,
      associativity: config.L1IAssoc || 2,
      hitTime: config.L1IHit || 1,
      missPenalty: config.L1IMissPenalty || 10
    });
    this.cacheD = new AssociativeCache({
      name: "L1D",
      sizeWords: config.L1DSizeWords || 256,
      lineSizeWords: config.L1DLineWords || 4,
      associativity: config.L1DAssoc || 2,
      hitTime: config.L1DHit || 1,
      missPenalty: config.L1DMissPenalty || 10
    });

    // predictor
    this.predictorMode = config.predictorMode || "static"; // "static" or "onebit"
    this.predictor = (this.predictorMode === "onebit") ? new OneBitPredictor(config.predictorSize || 64) : null;

    // pipeline registers
    this.IF_ID = { instr: null, pc: 0, predictedFromPC: null, predictedTaken: false };
    this.ID_EX = { instr: null, pc: 0, rs1Val:0, rs2Val:0 };
    this.EX_MEM = { instr: null, aluResult: undefined, rd: undefined, rs2Val: undefined };
    this.MEM_WB = { instr: null, aluResult: undefined, memData: undefined, rd: undefined };

    // control and stalls
    this.stall = false;        // load-use one-cycle stall flag (ID injects bubble)
    this.stallCycles = 0;      // cache miss freeze cycles (pipeline frozen except WB)
    this.flushes = 0;

    // metrics
    this.cycle = 0;
    this.instructionsCommitted = 0;
    this.stallsData = 0;
    this.stallsCache = 0;
    this.branchPredictions = 0;
    this.branchCorrect = 0;

    this.finished = false;
  }

  isNOP(instr) { return !instr || instr.opcode === "nop"; }

  // ---------- load-use hazard detection ----------
  detectLoadUseHazard() {
    const idInstr = this.IF_ID.instr;
    const exInstr = this.ID_EX.instr; // instruction currently in EX stage
    if (!idInstr || !exInstr) return false;
    if (exInstr.opcode !== "lw") return false;

    const reads = [];
    switch (idInstr.opcode) {
      case "add": case "sub": case "and": case "or": case "xor": case "slt":
        reads.push(idInstr.rs1, idInstr.rs2); break;
      case "addi": case "jalr": case "lw":
        reads.push(idInstr.rs1); break;
      case "sw":
        reads.push(idInstr.rs1, idInstr.rs2); break;
      case "beq": case "bne":
        reads.push(idInstr.rs1, idInstr.rs2); break;
      default:
        break;
    }
    for (let r of reads) {
      if (r !== undefined && r === exInstr.rd) return true;
    }
    return false;
  }

  // ---------- forwarding helper ----------
  getOperandValue(regNum, defaultVal) {
    // check EX_MEM first (most recent)
    if (this.EX_MEM.instr && this.EX_MEM.rd !== undefined && this.EX_MEM.rd === regNum) {
      // if EX_MEM.aluResult present and instr not lw (we can forward aluResult)
      if (this.EX_MEM.aluResult !== undefined && this.EX_MEM.instr.opcode !== "lw") {
        return this.EX_MEM.aluResult;
      }
      // if EX_MEM was lw, memData not yet available -> cannot forward from EX_MEM for lw
    }
    if (this.MEM_WB.instr && this.MEM_WB.rd !== undefined && this.MEM_WB.rd === regNum) {
      // MEM_WB may have memData (for lw) or aluResult
      if (this.MEM_WB.memData !== undefined) return this.MEM_WB.memData;
      if (this.MEM_WB.aluResult !== undefined) return this.MEM_WB.aluResult;
    }
    return this.regFile.read(regNum);
  }

  // ---------- compute branch/jump target given branch instr and pcIndex ----------
  computeTargetFromInstr(pcIndex, instr) {
    if (!instr) return pcIndex + 1;
    if (instr.opcode === "beq" || instr.opcode === "bne" || instr.opcode === "jal") {
      // imm is relative offset in number of instructions
      return pcIndex + instr.imm;
    } else if (instr.opcode === "jalr") {
      // jalr target is register value + imm; cannot compute here (depend on register)
      return pcIndex + 1;
    }
    return pcIndex + 1;
  }

  // ---------- IF stage ----------
  doIF() {
    // If stallCycles active -> freeze IF
    if (this.stallCycles > 0) return;
    // If load-use stall -> freeze IF (don't fetch)
    if (this.stall) return;

    const pcIdx = this.pc;
    // If predictor onebit: attempt to predict
    if (this.predictorMode === "onebit") {
      const instrToPredict = this.program[pcIdx];
      if (instrToPredict && ["beq","bne","jal"].includes(instrToPredict.opcode)) {
        const predictTaken = this.predictor.predict(pcIdx);
        // record prediction attempt (we'll update correctness in EX when branch resolves)
        this.branchPredictions++;
        if (predictTaken) {
          // compute predicted target (for jalr we don't predict taken)
          const predictedTarget = this.computeTargetFromInstr(pcIdx, instrToPredict);
          const fetched = this.program[predictedTarget] || null;
          this.IF_ID = { instr: fetched, pc: predictedTarget, predictedFromPC: pcIdx, predictedTaken: true };
          this.pc = predictedTarget + 1;
          return;
        }
      }
    }

    // default: sequential fetch via L1I
    const res = this.cacheI.readInstr(pcIdx, this.program);
    if (!res.hit) {
      this.stallCycles = res.latency;
      this.stallsCache += res.latency;
      return;
    }
    const instrObj = res.instr || null;
    this.IF_ID = { instr: instrObj, pc: pcIdx, predictedFromPC: null, predictedTaken: false };
    if (instrObj) this.pc = pcIdx + 1;
  }

  // ---------- ID stage ----------
  doID() {
    if (this.stallCycles > 0) return;

    // If load-use stall flagged, inject bubble into ID_EX
    if (this.stall) {
      this.ID_EX = { instr: { opcode: "nop" }, pc: 0, rs1Val:0, rs2Val:0 };
      this.stallsData++;
      // clear stall flag - only one-cycle stall
      this.stall = false;
      return;
    }

    const stage = this.IF_ID;
    if (!stage || !stage.instr) {
      this.ID_EX = { instr: null };
      return;
    }
    const instr = stage.instr;
    const idex = { instr: instr, pc: stage.pc };

    if (instr.rs1 !== undefined) idex.rs1Val = this.regFile.read(instr.rs1);
    if (instr.rs2 !== undefined) idex.rs2Val = this.regFile.read(instr.rs2);
    this.ID_EX = idex;
  }

  // ---------- EX stage ----------
  doEX() {
    const stage = this.ID_EX;
    if (!stage || !stage.instr) {
      this.EX_MEM = { instr: null };
      return;
    }
    const instr = stage.instr;

    // operands with forwarding
    let op1 = (instr.rs1 !== undefined) ? this.getOperandValue(instr.rs1, stage.rs1Val) : undefined;
    let op2 = (instr.rs2 !== undefined) ? this.getOperandValue(instr.rs2, stage.rs2Val) : undefined;

    let aluResult = undefined;
    let takeBranch = false;
    let targetPC = null;

    switch (instr.opcode) {
      case "add": aluResult = op1 + op2; break;
      case "sub": aluResult = op1 - op2; break;
      case "and": aluResult = op1 & op2; break;
      case "or":  aluResult = op1 | op2; break;
      case "xor": aluResult = op1 ^ op2; break;
      case "slt": aluResult = (op1 < op2) ? 1 : 0; break;
      case "addi": aluResult = op1 + instr.imm; break;
      case "lw": case "sw":
        aluResult = op1 + instr.imm; break; // effective address (word index)
      case "beq":
        takeBranch = (op1 === op2);
        targetPC = stage.pc + instr.imm;
        break;
      case "bne":
        takeBranch = (op1 !== op2);
        targetPC = stage.pc + instr.imm;
        break;
      case "jal":
        aluResult = stage.pc + 1; // return address
        takeBranch = true;
        targetPC = stage.pc + instr.imm;
        break;
      case "jalr":
        aluResult = stage.pc + 1;
        takeBranch = true;
        // compute target from register value + imm (rounded to integer)
        targetPC = Math.floor(op1 + instr.imm);
        break;
      case "nop":
      default:
        break;
    }

    // Branch resolution & predictor update
    if (["beq","bne","jal","jalr"].includes(instr.opcode)) {
      const actualTaken = !!takeBranch;
      // If predictor is onebit and a prediction was made earlier, we need to check it.
      if (this.predictorMode === "onebit") {
        // update predictor table using branch PC (stage.pc)
        this.predictor.update(stage.pc, actualTaken);
        // Check if we had a prediction recorded at IF for this branch: it's stored in IF_ID.predictedFromPC equals branch pc
        // Note: predicted info likely lives in the IF_ID that was fetched for branch's fetch time - but to avoid complex tracking,
        // we'll consider that if any IF_ID has predictedFromPC == stage.pc we compare predictedTaken with actualTaken
        let predictedInfo = null;
        // Scan IF_ID (current) and maybe previous? We'll check IF_ID only (works with our fetch method)
        if (this.IF_ID && this.IF_ID.predictedFromPC === stage.pc) predictedInfo = this.IF_ID;
        if (predictedInfo) {
          if (predictedInfo.predictedTaken === actualTaken) {
            this.branchCorrect++;
          } else {
            // mispredict -> flush instructions in IF_ID and ID_EX and set PC to actual target
            this.flushes++;
            this.IF_ID = { instr: null, pc:0, predictedFromPC:null, predictedTaken:false };
            this.ID_EX = { instr: null };
            this.pc = actualTaken ? targetPC : stage.pc + 1;
          }
        } else {
          // no earlier prediction recorded (e.g., predictor predicted not-taken and we didn't set predicted flag)
          // nothing to compare, but we've updated predictor state
        }
      } else {
        // static not-taken
        this.branchPredictions++;
        if (actualTaken) {
          this.flushes++;
          this.IF_ID = { instr: null, pc:0, predictedFromPC:null, predictedTaken:false };
          this.ID_EX = { instr:null };
          this.pc = targetPC;
        } else {
          this.branchCorrect++;
        }
      }
    }

    // Move to EX/MEM
    this.EX_MEM = { instr: instr, aluResult: aluResult, rd: instr.rd, rs2Val: stage.rs2Val };
  }

  // ---------- MEM stage ----------
  doMEM() {
    const stage = this.EX_MEM;
    if (!stage || !stage.instr) {
      this.MEM_WB = { instr: null };
      return;
    }
    const instr = stage.instr;
    let memData = undefined;

    if (instr.opcode === "lw") {
      const addr = stage.aluResult; // word address
      const res = this.cacheD.read(addr, this.memory);
      if (!res.hit) {
        this.stallCycles = res.latency;
        this.stallsCache += res.latency;
        return; // keep EX_MEM until miss resolved
      }
      memData = res.value;
    } else if (instr.opcode === "sw") {
      const addr = stage.aluResult;
      const valueToStore = this.getOperandValue(instr.rs2, stage.rs2Val);
      const res = this.cacheD.write(addr, valueToStore, this.memory);
      if (!res.hit) {
        this.stallCycles = res.latency;
        this.stallsCache += res.latency;
        return;
      }
    }

    this.MEM_WB = { instr: instr, aluResult: stage.aluResult, memData: memData, rd: stage.rd };
  }

  // ---------- WB stage ----------
  doWB() {
    const stage = this.MEM_WB;
    if (!stage || !stage.instr) return;
    const instr = stage.instr;
    switch (instr.opcode) {
      case "add": case "sub": case "and": case "or": case "xor": case "slt": case "addi":
        this.regFile.write(instr.rd, stage.aluResult); this.instructionsCommitted++; break;
      case "lw":
        this.regFile.write(instr.rd, stage.memData); this.instructionsCommitted++; break;
      case "jal": case "jalr":
        this.regFile.write(instr.rd, stage.aluResult); this.instructionsCommitted++; break;
      default:
        break;
    }
    this.MEM_WB = { instr: null };
  }

  // ---------- tick: advance one cycle ----------
  tick() {
    if (this.finished) return;
    this.cycle++;

    // always allow WB to commit even when stallCycles active
    this.doWB();

    // if stallCycles active -> decrement and don't advance other stages
    if (this.stallCycles > 0) {
      this.stallCycles--;
      // when reaches 0, next tick stages resume
      return;
    }

    // normal flow (WB already done)
    this.doMEM();
    this.doEX();

    // detect load-use hazard: check IF_ID vs ID_EX
    if (this.detectLoadUseHazard()) {
      this.stall = true; // will cause ID to insert bubble next tick
    }

    this.doID();
    this.doIF();

    // finished condition: program exhausted and pipeline empty
    const pipelineEmpty = this.isNOP(this.IF_ID.instr) && this.isNOP(this.ID_EX.instr) && this.isNOP(this.EX_MEM.instr) && this.isNOP(this.MEM_WB.instr);
    const noMoreInstructions = (this.pc >= this.program.length);
    if (pipelineEmpty && noMoreInstructions) this.finished = true;
  }

  // ---------- export metrics CSV ----------
  exportMetricsCSV() {
    const header = ["cycles","instructionsCommitted","CPI","stallsData","stallsCache","flushes","branchPredictions","branchCorrect","branchAccuracy","L1I_hits","L1I_misses","L1D_hits","L1D_misses"];
    const cycles = this.cycle;
    const instr = this.instructionsCommitted || 0;
    const cpi = instr ? (cycles / instr).toFixed(4) : "";
    const branchAcc = this.branchPredictions ? (this.branchCorrect / this.branchPredictions).toFixed(4) : "";
    const values = [
      cycles,
      instr,
      cpi,
      this.stallsData,
      this.stallsCache,
      this.flushes,
      this.branchPredictions,
      this.branchCorrect,
      branchAcc,
      this.cacheI.hits, this.cacheI.misses, this.cacheD.hits, this.cacheD.misses
    ];
    const csv = header.join(";") + "\n" + values.join(";");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "metrics.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- diagnostics ----------
  dumpState() {
    console.log(`Cycle: ${this.cycle} | PC: ${this.pc}`);
    console.log("IF/ID:", this.IF_ID);
    console.log("ID/EX:", this.ID_EX);
    console.log("EX/MEM:", this.EX_MEM);
    console.log("MEM/WB:", this.MEM_WB);
    console.log("Regs:", this.regFile.dump());
    console.log("Metrics:", {
      cycles: this.cycle,
      committed: this.instructionsCommitted,
      stallsData: this.stallsData,
      stallsCache: this.stallsCache,
      flushes: this.flushes,
      branchPredictions: this.branchPredictions,
      branchCorrect: this.branchCorrect
    });
    console.log("Cache I:", this.cacheI.stats(), "Cache D:", this.cacheD.stats());
  }
}

// ===================== DEMO / COMO USAR =====================
/*
Exemplo de uso no navegador console (descomente para testar):

const program = [
  "addi x1, x0, 4",
  "sw x2, 0(x1)",
  "lw x3, 0(x1)",
  "add x4, x3, x2",
  "addi x5, x0, 1",
  "beq x5, x0, 2",   // example branch
  "add x6, x1, x1",
  "nop",
];

const sim = new PipelineSimulator(program, {
  predictorMode: "onebit",
  predictorSize: 32,
  L1ISizeWords: 64,
  L1ILineWords: 4,
  L1IAssoc: 2,
  L1IMissPenalty: 8,
  L1DSizeWords: 64,
  L1DLineWords: 4,
  L1DAssoc: 2,
  L1DMissPenalty: 12
});

for (let i=0; i<500 && !sim.finished; i++) {
  sim.tick();
  sim.dumpState();
}
sim.exportMetricsCSV();
*/

