// ===================== UTILITÁRIOS / PARSER =====================
function isRegisterToken(tok) { return tok && tok.startsWith("x"); }
function regNum(tok) { return parseInt(tok.substring(1)); }

function parseInstruction(line, index) {
  const baseInstr = { opcode: "nop", pc: index, raw: line || "nop" };
  if (!line) return baseInstr;
  let s = line.trim();
  if (s === "" || s.startsWith("#")) return baseInstr;

  // Strip label if it exists
  const labelMatch = s.match(/^(\w+):/);
  if (labelMatch) {
    s = s.substring(labelMatch[0].length).trim();
    // If the line is just a label, it's a nop
    if (s === "") return baseInstr;
  }

  const t = s.replace(",", " ").split(/\s+/);
  const op = t[0];
  try {
    switch (op) {
      case "add": case "sub": case "and": case "or": case "xor": case "slt":
        return { ...baseInstr, opcode: op, rd: regNum(t[1]), rs1: regNum(t[2]), rs2: regNum(t[3]) };
      case "addi":
        return { ...baseInstr, opcode: op, rd: regNum(t[1]), rs1: regNum(t[2]), imm: parseInt(t[3]) };
      case "lw": {
        const match = t[2].match(/(-?\d+)\(x(\d+)\)/);
        return { ...baseInstr, opcode: op, rd: regNum(t[1]), rs1: parseInt(match[2]), imm: parseInt(match[1]) };
      }
      case "sw": {
        const match = t[2].match(/(-?\d+)\(x(\d+)\)/);
        return { ...baseInstr, opcode: op, rs2: regNum(t[1]), rs1: parseInt(match[2]), imm: parseInt(match[1]) };
      }
      case "beq": case "bne":
        return { ...baseInstr, opcode: op, rs1: regNum(t[1]), rs2: regNum(t[2]), imm: parseInt(t[3]) };
      case "jal":
        return { ...baseInstr, opcode: op, rd: regNum(t[1]), imm: parseInt(t[2]) }; // imm = target offset (relative)
      case "jalr": {
        const match = t[2].match(/(-?\d+)\(x(\d+)\)/);
        return { ...baseInstr, opcode: op, rd: regNum(t[1]), rs1: parseInt(match[2]), imm: parseInt(match[1]) };
      }
      case "nop":
      default:
        return { ...baseInstr, opcode: "nop" };
    }
  } catch (e) {
    console.warn("Falha no parse:", line, e);
    return { ...baseInstr, opcode: "nop" };
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

// ===================== PIPELINE SIMULATOR =====================
class PipelineSimulator {
  constructor(programLines = [], config = {}) {
    this.program = programLines.map((line, idx) => parseInstruction(line, idx));
    this.pc = 0;
    this.nopInstr = parseInstruction("nop", -1); // Um NOP padrão

    this.regFile = new RegisterFile();
    this.memory = new Memory(config.memorySizeWords || 4096);

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

    this.predictorMode = config.predictorMode || "static";
    this.predictor = (this.predictorMode === "onebit") ? new OneBitPredictor(config.predictorSize || 64) : null;

    this.IF_ID = { instr: this.nopInstr, pc: 0, predictedFromPC: null, predictedTaken: false };
    this.ID_EX = { instr: this.nopInstr, pc: 0, rs1Val:0, rs2Val:0 };
    this.EX_MEM = { instr: this.nopInstr, aluResult: undefined, rd: undefined, rs2Val: undefined };
    this.MEM_WB = { instr: this.nopInstr, aluResult: undefined, memData: undefined, rd: undefined };

    // Sinais de controle para a UI
    this.stall = false;
    this.stallCycles = 0;
    this.lastCommittedInstr = null;
    this.flushedPCs = [];
    this.isCacheStall = false;
    this.injectedStall = false;

    // metrics
    this.flushes = 0;
    this.cycle = 0;
    this.instructionsCommitted = 0;
    this.stallsData = 0;
    this.stallsCache = 0;
    this.branchPredictions = 0;
    this.branchCorrect = 0;

    this.finished = false;
  }

  isNOP(instr) { return !instr || instr.opcode === "nop"; }

  detectLoadUseHazard() {
    const idInstr = this.IF_ID.instr;
    const exInstr = this.ID_EX.instr;
    const memInstr = this.EX_MEM.instr; // Check against instruction in MEM stage as well
    if (this.isNOP(idInstr)) return false;

    const checkHazard = (stageInstr) => {
      if (this.isNOP(stageInstr) || stageInstr.opcode !== "lw") return false;

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
        if (r !== undefined && r === stageInstr.rd) return true;
      }
      return false;
    };

    return checkHazard(exInstr) || checkHazard(memInstr);
  }

  getOperandValue(regNum, defaultVal) {
    if (this.EX_MEM.instr && this.EX_MEM.rd !== undefined && this.EX_MEM.rd === regNum) {
      if (this.EX_MEM.aluResult !== undefined && this.EX_MEM.instr.opcode !== "lw") {
        return this.EX_MEM.aluResult;
      }
    }
    if (this.MEM_WB.instr && this.MEM_WB.rd !== undefined && this.MEM_WB.rd === regNum) {
      if (this.MEM_WB.memData !== undefined) return this.MEM_WB.memData;
      if (this.MEM_WB.aluResult !== undefined) return this.MEM_WB.aluResult;
    }
    return this.regFile.read(regNum);
  }

  computeTargetFromInstr(pcIndex, instr) {
    if (!instr) return pcIndex + 1;
    if (instr.opcode === "beq" || instr.opcode === "bne" || instr.opcode === "jal") {
      return pcIndex + instr.imm;
    } else if (instr.opcode === "jalr") {
      return pcIndex + 1;
    }
    return pcIndex + 1;
  }

  doIF() {
    if (this.stallCycles > 0) {
        this.isCacheStall = true;
        return;
    }
    if (this.stall) { // load-use stall congela IF e ID
        this.isCacheStall = true; // Tratar como um "freeze" para a UI
        return;
    }
    
    const pcIdx = this.pc;
    if (pcIdx >= this.program.length) {
        this.IF_ID = { instr: this.nopInstr, pc: pcIdx };
        return; // PC não incrementa mais, fica parado no fim
    }

    // 1. Fetch a instrução ATUAL (pcIdx)
    const res = this.cacheI.readInstr(pcIdx, this.program);
    if (!res.hit) {
      this.stallCycles = res.latency;
      this.stallsCache += res.latency;
      this.isCacheStall = true;
      return;
    }
    const instrObj = res.instr || this.nopInstr;
    
    // 2. Coloca a instrução ATUAL no pipeline
    // Anotações de predição são adicionadas abaixo
    this.IF_ID = { instr: instrObj, pc: pcIdx, predictedFromPC: null, predictedTaken: false }; 

    // 3. Decide qual será o PRÓXIMO PC
    let nextPC = pcIdx + 1;

    if (this.predictorMode === "onebit") {
      if (instrObj && ["beq","bne","jal"].includes(instrObj.opcode)) {
        const predictTaken = this.predictor.predict(pcIdx);
        this.branchPredictions++;
        
        // Anota a predição NA INSTRUÇÃO que está entrando no pipeline
        this.IF_ID.predictedFromPC = pcIdx; 
        this.IF_ID.predictedTaken = predictTaken;
        
        if (predictTaken) {
          nextPC = this.computeTargetFromInstr(pcIdx, instrObj);
        }
      }
    }
    
    // 4. Atualiza o PC para a próxima busca
    this.pc = nextPC;
  }

  doID() {
    if (this.stallCycles > 0) return;

    if (this.stall) {
      this.ID_EX = { instr: this.nopInstr, pc: -1, rs1Val:0, rs2Val:0 }; // Injeta bolha
      this.stallsData++;
      this.stall = false;
      this.injectedStall = true; // Sinaliza para a UI
      return;
    }

    const stage = this.IF_ID;
    if (!stage || !stage.instr) {
      this.ID_EX = { instr: this.nopInstr };
      return;
    }
    const instr = stage.instr;
    
    // Passa a info de predição (que veio do IF_ID) para o ID_EX
    const idex = { 
        instr: instr, 
        pc: stage.pc,
        predictedFromPC: stage.predictedFromPC,
        predictedTaken: stage.predictedTaken
    };

    if (instr.rs1 !== undefined) idex.rs1Val = this.regFile.read(instr.rs1);
    if (instr.rs2 !== undefined) idex.rs2Val = this.regFile.read(instr.rs2);
    this.ID_EX = idex;
  }

  doEX() {
    const stage = this.ID_EX; // 'stage' agora contém a instrução E sua predição
    if (!stage || !stage.instr) {
      this.EX_MEM = { instr: this.nopInstr };
      return;
    }
    const instr = stage.instr;

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
        aluResult = op1 + instr.imm; break;
      case "beq":
        takeBranch = (op1 === op2);
        targetPC = stage.pc + instr.imm;
        break;
      case "bne":
        takeBranch = (op1 !== op2);
        targetPC = stage.pc + instr.imm;
        break;
      case "jal":
        aluResult = stage.pc + 1;
        takeBranch = true;
        targetPC = stage.pc + instr.imm;
        break;
      case "jalr":
        aluResult = stage.pc + 1;
        takeBranch = true;
        targetPC = Math.floor(op1 + instr.imm);
        break;
      case "nop":
      default:
        break;
    }

    // Branch resolution & predictor update
    if (["beq","bne","jal","jalr"].includes(instr.opcode)) {
      const actualTaken = !!takeBranch;
      
      // For unconditional jumps like jal and jalr, we don't use the predictor, but we need to change PC
      if (instr.opcode === "jal" || instr.opcode === "jalr") {
          this.flushes++; // Unconditional jumps always flush the pipeline
          if(!this.isNOP(this.IF_ID.instr)) this.flushedPCs.push(this.IF_ID.instr.pc);
          if(!this.isNOP(this.ID_EX.instr)) this.flushedPCs.push(this.ID_EX.instr.pc);
          this.IF_ID = { instr: this.nopInstr, pc:0, predictedFromPC:null, predictedTaken:false };
          this.ID_EX = { instr: this.nopInstr };
          this.pc = targetPC;
      } else if (this.predictorMode === "onebit") {
        this.predictor.update(stage.pc, actualTaken);
        
        let predictedInfo = stage; 
        
        if (predictedInfo && predictedInfo.predictedFromPC === stage.pc) { 
          if (predictedInfo.predictedTaken !== actualTaken) {
            // MISPREDICT!
            this.flushes++;
            if(!this.isNOP(this.IF_ID.instr)) this.flushedPCs.push(this.IF_ID.instr.pc);
            if(!this.isNOP(this.ID_EX.instr)) this.flushedPCs.push(this.ID_EX.instr.pc);
            
            this.IF_ID = { instr: this.nopInstr, pc:0, predictedFromPC:null, predictedTaken:false };
            this.ID_EX = { instr: this.nopInstr };
            
            this.pc = actualTaken ? targetPC : stage.pc + 1;
          } else {
            this.branchCorrect++;
          }
        } 
      } else { // Static not-taken
        this.branchPredictions++;
        if (actualTaken) {
          this.flushes++;
          if(!this.isNOP(this.IF_ID.instr)) this.flushedPCs.push(this.IF_ID.instr.pc);
          if(!this.isNOP(this.ID_EX.instr)) this.flushedPCs.push(this.ID_EX.instr.pc);
          
          this.IF_ID = { instr: this.nopInstr, pc:0, predictedFromPC:null, predictedTaken:false };
          this.ID_EX = { instr: this.nopInstr };
          this.pc = targetPC;
        } else {
          this.branchCorrect++;
        }
      }
    }
    this.EX_MEM = { instr: instr, aluResult: aluResult, rd: instr.rd, rs2Val: stage.rs2Val };
  }

  doMEM() {
    const stage = this.EX_MEM;
    if (!stage || !stage.instr) {
      this.MEM_WB = { instr: this.nopInstr };
      return;
    }
    const instr = stage.instr;
    let memData = undefined;

    if (instr.opcode === "lw") {
      const addr = stage.aluResult;
      const res = this.cacheD.read(addr, this.memory);
      if (!res.hit) {
        this.stallCycles = res.latency;
        this.stallsCache += res.latency;
        this.isCacheStall = true;
        return;
      }
      memData = res.value;
    } else if (instr.opcode === "sw") {
      const addr = stage.aluResult;
      const valueToStore = this.getOperandValue(instr.rs2, stage.rs2Val);
      const res = this.cacheD.write(addr, valueToStore, this.memory);
      if (!res.hit) {
        this.stallCycles = res.latency;
        this.stallsCache += res.latency;
        this.isCacheStall = true;
        return;
      }
    }
    this.MEM_WB = { instr: instr, aluResult: stage.aluResult, memData: memData, rd: stage.rd };
  }

  doWB() {
    const stage = this.MEM_WB;
    this.lastCommittedInstr = stage.instr; // Salva para a UI
    
    if (!stage || !stage.instr || this.isNOP(stage.instr)) {
        this.MEM_WB = { instr: this.nopInstr };
        return;
    }
    
    const instr = stage.instr;
    switch (instr.opcode) {
      case "add": case "sub": case "and": case "or": case "xor": case "slt": case "addi":
        this.regFile.write(instr.rd, stage.aluResult); this.instructionsCommitted++; break;
      case "lw":
        this.regFile.write(instr.rd, stage.memData); this.instructionsCommitted++; break;
      case "jal": case "jalr":
        this.regFile.write(instr.rd, stage.aluResult); this.instructionsCommitted++; break;
      case "sw": 
      case "beq": 
      case "bne":
        this.instructionsCommitted++; 
        break;
      default:
        // nop não conta
        break;
    }
    this.MEM_WB = { instr: this.nopInstr };
  }

  // =============================================
  // ========= FUNÇÃO tick() CORRIGIDA =========
  // =============================================
  tick() {
    if (this.finished) return;
    this.cycle++;

    // Limpa flags de UI
    this.lastCommittedInstr = null;
    this.flushedPCs = [];
    this.isCacheStall = false;
    this.injectedStall = false;
    
    this.doWB(); // Sempre roda

    // Se houver um stall de cache
    if (this.stallCycles > 0) {
      this.stallCycles--;
      this.isCacheStall = true; // Sinaliza para a UI
      // ===== CORREÇÃO =====
      // REMOVEMOS O 'return;' DAQUI.
      // Isso permite que 'doMEM' e 'doEX' executem.
      // 'doID' e 'doIF' já têm suas próprias verificações para 'stallCycles' e vão parar.
    }

    this.doMEM();
    this.doEX();
    
    // Detecta stall de load-use APÓS EX (onde o lw foi processado)
    if (this.detectLoadUseHazard()) {
      this.stall = true; // 'stall' congela IF e ID
    }
    
    this.doID(); // Esta função já verifica 'this.stall' e 'this.stallCycles'
    this.doIF(); // Esta função já verifica 'this.stall' e 'this.stallCycles'

    const pipelineEmpty = this.isNOP(this.IF_ID.instr) && this.isNOP(this.ID_EX.instr) && this.isNOP(this.EX_MEM.instr) && this.isNOP(this.MEM_WB.instr) && this.isNOP(this.lastCommittedInstr);
    const noMoreInstructions = (this.pc >= this.program.length);
    if (pipelineEmpty && noMoreInstructions) this.finished = true;
  }

  exportMetricsCSV() {
    const header = [
        "cycles","instructionsCommitted","CPI","stallsData","stallsCache","flushes",
        "branchPredictions","branchCorrect","branchAccuracy",
        "L1I_hits","L1I_misses", "L1I_hitRate", "MPKI-I", "AMAT-I",
        "L1D_hits","L1D_misses", "L1D_hitRate", "MPKI-D", "AMAT-D"
    ];
    
    const cycles = this.cycle;
    const instr = this.instructionsCommitted || 0;
    const cpi = instr ? (cycles / instr).toFixed(4) : "0";
    const branchAcc = this.branchPredictions ? (this.branchCorrect / this.branchPredictions).toFixed(4) : "0";
    const kiloInstructions = instr / 1000;

    const statsI = this.cacheI.stats();
    const missRateI = 1.0 - statsI.hitRate;
    const amat_i = (this.cacheI.hitTime + (missRateI * this.cacheI.missPenalty)).toFixed(4);
    const mpki_i = kiloInstructions > 0 ? (this.cacheI.misses / kiloInstructions).toFixed(4) : "0";
    
    const statsD = this.cacheD.stats();
    const missRateD = 1.0 - statsD.hitRate;
    const amat_d = (this.cacheD.hitTime + (missRateD * this.cacheD.missPenalty)).toFixed(4);
    const mpki_d = kiloInstructions > 0 ? (this.cacheD.misses / kiloInstructions).toFixed(4) : "0";

    const values = [
      cycles, instr, cpi,
      this.stallsData, this.stallsCache, this.flushes,
      this.branchPredictions, this.branchCorrect, branchAcc,
      this.cacheI.hits, this.cacheI.misses, statsI.hitRate.toFixed(4), mpki_i, amat_i,
      this.cacheD.hits, this.cacheD.misses, statsD.hitRate.toFixed(4), mpki_d, amat_d
    ];
    
    const csv = header.join(";") + "\n" + values.join(";");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "metrics.csv"; a.click();
    URL.revokeObjectURL(url);
  }
}
