// ============================================================
// pipeline.js – Simulador de pipeline com hierarquia de memória
// ============================================================

// ===================== UTILITÁRIOS / PARSER =====================
function isRegisterToken(tok) { return tok && tok.startsWith("x"); }
function regNum(tok) { return parseInt(tok.substring(1)); }

function parseInstruction(line, index) {
  const baseInstr = { opcode: "nop", pc: index, raw: line || "nop" };
  if (!line) return baseInstr;
  let s = line.trim();
  if (s === "" || s.startsWith("#")) return baseInstr;

  const labelMatch = s.match(/^(\w+):/);
  if (labelMatch) {
    s = s.substring(labelMatch[0].length).trim();
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
        return { ...baseInstr, opcode: op, rd: regNum(t[1]), imm: parseInt(t[2]) };
      case "jalr": {
        const match = t[2].match(/(-?\d+)\(x(\d+)\)/);
        return { ...baseInstr, opcode: op, rd: regNum(t[1]), rs1: parseInt(match[2]), imm: parseInt(match[1]) };
      }
      default:
        return { ...baseInstr, opcode: "nop" };
    }
  } catch (e) {
    console.warn("Erro no parse:", line, e);
    return { ...baseInstr, opcode: "nop" };
  }
}

// ===================== REGISTRADORES E MEMÓRIA =====================
class RegisterFile {
  constructor() { this.regs = Array(32).fill(0); }
  read(n) { return n === 0 ? 0 : this.regs[n]; }
  write(n, v) { if (n !== 0) this.regs[n] = v; }
}

// ===================== PREDITOR DE DESVIO 1-BIT =====================
class OneBitPredictor {
  constructor(size = 64) { this.size = size; this.table = new Uint8Array(size); }
  index(pc) { return pc & (this.size - 1); }
  predict(pc) { return this.table[this.index(pc)] === 1; }
  update(pc, taken) { this.table[this.index(pc)] = taken ? 1 : 0; }
}

// ============================================================
// CLASSE PRINCIPAL – PipelineSimulator
// ============================================================
class PipelineSimulator {
  constructor(programLines = [], config = {}) {
    this.program = programLines.map((line, i) => parseInstruction(line, i));
    this.pc = 0;
    this.nopInstr = parseInstruction("nop", -1);

    this.regFile = new RegisterFile();
    this.memoryHierarchy = new MemoryHierarchy();
    this.predictor = new OneBitPredictor(config.predictorSize || 32);

    // Registradores de pipeline
    this.IF_ID = { instr: this.nopInstr };
    this.ID_EX = { instr: this.nopInstr };
    this.EX_MEM = { instr: this.nopInstr };
    this.MEM_WB = { instr: this.nopInstr };

    // Controle de estado
    this.lastCommittedInstr = null;
    this.flushedPCs = [];
    this.stall = false;
    this.stallCycles = 0;
    this.jumpPending = false;

    // Métricas
    this.cycle = 0;
    this.instructionsCommitted = 0;
    this.flushes = 0;
    this.stallsData = 0;
    this.stallsCache = 0;
    this.branchPredictions = 0;
    this.branchCorrect = 0;
    this.finished = false;
  }

  isNOP(i) { return !i || i.opcode === "nop"; }

  // ============================================================
  // IF – Busca
  // ============================================================
  doIF() {
    if (this.stallCycles > 0 || this.stall) return;
    if (this.jumpPending) { this.jumpPending = false; return; }

    const pc = this.pc;
    if (pc >= this.program.length) return;

    // ✅ Acesso à cache de instruções (L1I)
    const res = this.memoryHierarchy.readInstr(pc);
    if (!res.hit) { this.stallCycles = res.latency; this.stallsCache += res.latency; return; }

    const instr = this.program[pc];
    this.IF_ID = { instr, pc };
    this.pc = pc + 1;
  }

  // ============================================================
  // ID – Decodificação
  // ============================================================
  doID() {
    if (this.stallCycles > 0) return;
    const instr = this.IF_ID.instr;
    if (this.isNOP(instr)) { this.ID_EX = { instr: this.nopInstr }; return; }

    this.ID_EX = {
      instr,
      pc: this.IF_ID.pc,
      rs1Val: instr.rs1 !== undefined ? this.regFile.read(instr.rs1) : 0,
      rs2Val: instr.rs2 !== undefined ? this.regFile.read(instr.rs2) : 0
    };
  }

  // ============================================================
  // EX – Execução
  // ============================================================
  doEX() {
    const instr = this.ID_EX.instr;
    if (this.isNOP(instr)) { this.EX_MEM = { instr: this.nopInstr }; return; }

    let op1 = instr.rs1 !== undefined ? this.regFile.read(instr.rs1) : 0;
    let op2 = instr.rs2 !== undefined ? this.regFile.read(instr.rs2) : 0;
    let alu = 0, takeBranch = false, targetPC = this.pc;

    switch (instr.opcode) {
      case "add": alu = op1 + op2; break;
      case "sub": alu = op1 - op2; break;
      case "and": alu = op1 & op2; break;
      case "or": alu = op1 | op2; break;
      case "xor": alu = op1 ^ op2; break;
      case "addi": alu = op1 + instr.imm; break;
      case "lw": case "sw": alu = op1 + instr.imm; break;
      case "beq": takeBranch = (op1 === op2); targetPC = this.ID_EX.pc + instr.imm; break;
      case "bne": takeBranch = (op1 !== op2); targetPC = this.ID_EX.pc + instr.imm; break;
      case "jal": takeBranch = true; alu = this.ID_EX.pc + 1; targetPC = this.ID_EX.pc + instr.imm; break;
      case "jalr": takeBranch = true; alu = this.ID_EX.pc + 1; targetPC = (op1 + instr.imm) & ~1; break;
    }

    // Preditor 1-bit
    if (["beq", "bne", "jal", "jalr"].includes(instr.opcode)) {
      const actual = takeBranch;
      const pcIndex = this.ID_EX.pc;
      const predicted = this.predictor.predict(pcIndex);
      this.branchPredictions++;

      if (predicted !== actual) {
        this.flushes++;
        this.IF_ID = { instr: this.nopInstr };
        this.ID_EX = { instr: this.nopInstr };
        this.pc = actual ? targetPC : (pcIndex + 1);
        this.jumpPending = true;
      } else this.branchCorrect++;

      this.predictor.update(pcIndex, actual);
    }

    this.EX_MEM = { instr, aluResult: alu, rd: instr.rd, rs2Val: this.ID_EX.rs2Val };
  }

  // ============================================================
  // MEM – Acesso à memória
  // ============================================================
  doMEM() {
    const instr = this.EX_MEM.instr;
    if (this.isNOP(instr)) { this.MEM_WB = { instr: this.nopInstr }; return; }

    let memData = null;
    if (instr.opcode === "lw") {
      const res = this.memoryHierarchy.readData(this.EX_MEM.aluResult);
      if (!res.hit) { this.stallCycles = res.latency; this.stallsCache += res.latency; return; }
      memData = res.value;
    } else if (instr.opcode === "sw") {
      const res = this.memoryHierarchy.writeData(this.EX_MEM.aluResult, this.EX_MEM.rs2Val);
      if (!res.hit) { this.stallCycles = res.latency; this.stallsCache += res.latency; return; }
    }

    this.MEM_WB = { instr, aluResult: this.EX_MEM.aluResult, memData, rd: instr.rd };
  }

  // ============================================================
  // WB – Write Back
  // ============================================================
  doWB() {
    const instr = this.MEM_WB.instr;
    this.lastCommittedInstr = instr;
    if (this.isNOP(instr)) return;

    switch (instr.opcode) {
      case "add": case "sub": case "and": case "or": case "xor":
      case "addi": case "jal": case "jalr":
        this.regFile.write(instr.rd, this.MEM_WB.aluResult); break;
      case "lw":
        this.regFile.write(instr.rd, this.MEM_WB.memData); break;
    }
    this.instructionsCommitted++;
  }

  // ============================================================
  // Estatísticas gerais
  // ============================================================
  getStats() {
    return {
      cycles: this.cycle,
      instructions: this.instructionsCommitted,
      CPI: this.instructionsCommitted ? this.cycle / this.instructionsCommitted : 0,
      flushes: this.flushes,
      stallsData: this.stallsData,
      stallsCache: this.stallsCache,
      branchPredictions: this.branchPredictions,
      branchCorrect: this.branchCorrect,
      caches: this.memoryHierarchy.stats()
    };
  }

  // ============================================================
  // Tick (um ciclo)
  // ============================================================
  tick() {
    if (this.finished) return;
    this.cycle++;
    this.lastCommittedInstr = null;
    this.flushedPCs = [];

    this.doWB();
    if (this.stallCycles > 0) { this.stallCycles--; return; }

    this.doMEM();
    this.doEX();
    this.doID();
    this.doIF();

    const empty = [this.IF_ID, this.ID_EX, this.EX_MEM, this.MEM_WB].every(s => this.isNOP(s.instr));
    if (empty && this.pc >= this.program.length) this.finished = true;
  }
}

// ============================================================
// Exporta globalmenteFF
// ============================================================
window.PipelineSimulator = PipelineSimulator;
