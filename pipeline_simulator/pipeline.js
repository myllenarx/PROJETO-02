// ============================================================
// pipeline.js – Simulador de pipeline com hierarquia de memória (CORRIGIDO)
// ============================================================

function isRegisterToken(tok) { return tok && tok.startsWith("x"); }
function regNum(tok) { 
  const num = parseInt(tok.substring(1)); 
  // CORRIGIDO: Validação de registrador
  if (isNaN(num) || num < 0 || num > 31) {
    console.warn(`Registrador inválido: ${tok}`);
    return 0;
  }
  return num;
}

function parseInstruction(line, index) {
  const baseInstr = { opcode: "nop", pc: index, raw: line || "nop" };
  if (!line) return baseInstr;
  let s = line.trim();
  if (s === "" || s.startsWith("//") || s.startsWith("#")) return baseInstr;

  const labelMatch = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
  let label = null;
  if (labelMatch) {
    label = labelMatch[1];
    s = labelMatch[2].trim();
    if (s === "") return { ...baseInstr, label };
  }

  const t = s.replace(/,/g, ' ').split(/\s+/).filter(tok => tok !== '');
  if (t.length === 0) return baseInstr;

  const op = t[0];
  try {
    switch (op) {
      case "add": case "sub": case "and": case "or": case "xor": case "slt":
        if (t.length < 4) throw new Error("Operandos insuficientes");
        return { ...baseInstr, opcode: op, rd: regNum(t[1]), rs1: regNum(t[2]), rs2: regNum(t[3]), label };

      case "addi":
        if (t.length < 4) throw new Error("Operandos insuficientes");
        return { ...baseInstr, opcode: op, rd: regNum(t[1]), rs1: regNum(t[2]), imm: parseInt(t[3]), label };

      case "lw": case "sw": {
        if (t.length < 3) throw new Error("Operandos insuficientes");
        const match = t[2].match(/(-?\d+)\(x(\d+)\)/);
        if (!match) throw new Error("Formato de offset inválido");
        if (op === "lw") {
          return { ...baseInstr, opcode: op, rd: regNum(t[1]), rs1: parseInt(match[2]), imm: parseInt(match[1]), label };
        } else {
          return { ...baseInstr, opcode: op, rs2: regNum(t[1]), rs1: parseInt(match[2]), imm: parseInt(match[1]), label };
        }
      }

      case "beq": case "bne":
        if (t.length < 4) throw new Error("Operandos insuficientes");
        return { ...baseInstr, opcode: op, rs1: regNum(t[1]), rs2: regNum(t[2]), imm: parseInt(t[3]), label, isBranch: true };

      case "jal":
        if (t.length < 3) throw new Error("Operandos insuficientes");
        return { ...baseInstr, opcode: op, rd: regNum(t[1]), imm: parseInt(t[2]), label, isJump: true };

      case "jalr": {
        if (t.length < 3) throw new Error("Operandos insuficientes");
        const match = t[2].match(/(-?\d+)\(x(\d+)\)/);
        if (!match) throw new Error("Formato de offset inválido");
        return { ...baseInstr, opcode: op, rd: regNum(t[1]), rs1: parseInt(match[2]), imm: parseInt(match[1]), label, isJump: true };
      }

      case "nop":
        return baseInstr;

      default:
        console.warn(`Instrução não reconhecida: ${op}`);
        return { ...baseInstr, opcode: "nop", label };
    }
  } catch (e) {
    console.warn(`Erro no parse: "${line}" - ${e.message}`);
    return { ...baseInstr, opcode: "nop", label };
  }
}

class RegisterFile {
  constructor() { this.regs = Array(32).fill(0); }
  read(n) { return n === 0 ? 0 : this.regs[n]; }
  write(n, v) { 
    if (n !== 0) {
      // CORRIGIDO: Simular overflow de 32 bits
      this.regs[n] = v | 0; // Força conversão para int32
    }
  }
}

class OneBitPredictor {
  constructor(size = 64) { 
    this.size = size; 
    this.table = new Uint8Array(size); 
  }
  index(pc) { return pc & (this.size - 1); }
  predict(pc) { return this.table[this.index(pc)] === 1; }
  update(pc, taken) { this.table[this.index(pc)] = taken ? 1 : 0; }
}

class PipelineSimulator {
  constructor(programLines = [], config = {}) {
    this.program = programLines.map((line, i) => parseInstruction(line, i));
    this.pc = 0;
    this.nopInstr = parseInstruction("nop", -1);

    this.regFile = new RegisterFile();
    this.memoryHierarchy = new MemoryHierarchy();
    this.predictor = new OneBitPredictor(config.predictorSize || 32);

    this.IF_ID = { instr: this.nopInstr };
    this.ID_EX = { instr: this.nopInstr };
    this.EX_MEM = { instr: this.nopInstr };
    this.MEM_WB = { instr: this.nopInstr };

    this.lastCommittedInstr = null;
    this.flushedPCs = [];
    this.stall = false;
    this.stallCycles = 0;
    this.jumpPending = false;
    this.flushInProgress = false; // CORRIGIDO: Flag para controlar flush

    this.cycle = 0;
    this.instructionsCommitted = 0;
    this.flushes = 0;
    this.stallsData = 0;
    this.stallsCache = 0;
    this.branchPredictions = 0;
    this.branchCorrect = 0;
    this.finished = false;

    this.maxCycles = config.maxCycles || 2000;
  }

  isNOP(i) { return !i || i.opcode === "nop"; }

  // CORRIGIDO: Verificar se instrução escreve em registrador
  _writesToRegister(instr) {
    if (!instr || this.isNOP(instr)) return false;
    return ["add", "sub", "and", "or", "xor", "slt", "addi", "lw", "jal", "jalr"].includes(instr.opcode);
  }

  // ---------------- IF ----------------
  doIF(prev) {
    if (this.stallCycles > 0 || this.stall || this.flushInProgress) return;
    if (this.jumpPending) { 
      this.jumpPending = false; 
      return; 
    }

    const pc = this.pc;
    if (pc >= this.program.length) return;

    const res = this.memoryHierarchy.readInstr(pc);
    if (!res.hit) { 
      this.stallCycles = res.latency; 
      this.stallsCache += res.latency; 
      return; 
    }

    const instr = this.program[pc];
    this.IF_ID = { instr, pc };
    this.pc = pc + 1;
  }

  // ---------------- ID ----------------
  doID(prev) {
    if (this.stallCycles > 0 || this.flushInProgress) return;
    const instr = prev.IF_ID.instr;
    if (this.isNOP(instr)) { 
      this.ID_EX = { instr: this.nopInstr }; 
      return; 
    }

    let hasHazard = false;
    
    // CORRIGIDO: Detecção mais completa de hazards
    // Verifica load-use hazards com qualquer instrução que escreve em registrador
    const checkHazard = (laterInstr, rd) => {
      if (rd === undefined || rd === 0) return false;
      if (instr.rs1 !== undefined && instr.rs1 === rd) return true;
      if (instr.rs2 !== undefined && instr.rs2 === rd) return true;
      return false;
    };

    // Load no estágio EX (load-use hazard crítico)
    if (prev.ID_EX.instr && prev.ID_EX.instr.opcode === "lw") {
      if (checkHazard(instr, prev.ID_EX.instr.rd)) hasHazard = true;
    }

    // Load no estágio MEM
    if (prev.EX_MEM.instr && prev.EX_MEM.instr.opcode === "lw") {
      if (checkHazard(instr, prev.EX_MEM.instr.rd)) hasHazard = true;
    }

    if (hasHazard) {
      this.ID_EX = { instr: this.nopInstr };
      this.stallCycles = 1;
      this.stallsData++;
      return;
    }

    this.ID_EX = {
      instr,
      pc: prev.IF_ID.pc,
      rs1Val: instr.rs1 !== undefined ? this.regFile.read(instr.rs1) : 0,
      rs2Val: instr.rs2 !== undefined ? this.regFile.read(instr.rs2) : 0
    };
  }

  // ---------------- EX ----------------
  doEX(prev) {
    if (this.flushInProgress) {
      this.EX_MEM = { instr: this.nopInstr };
      return;
    }

    const instr = prev.ID_EX.instr;
    if (this.isNOP(instr)) { 
      this.EX_MEM = { instr: this.nopInstr }; 
      return; 
    }

    // Valores base vindos do ID
    let op1 = prev.ID_EX.rs1Val;
    let op2 = prev.ID_EX.rs2Val;

    // CORRIGIDO: Forwarding completo e correto
    // Forwarding de EX/MEM (prioridade maior - mais recente)
    if (prev.EX_MEM.instr && this._writesToRegister(prev.EX_MEM.instr)) {
      const rd = prev.EX_MEM.instr.rd;
      if (rd !== undefined && rd !== 0) {
        const fwdValue = prev.EX_MEM.aluResult;
        if (instr.rs1 !== undefined && instr.rs1 === rd) {
          op1 = fwdValue;
        }
        if (instr.rs2 !== undefined && instr.rs2 === rd) {
          op2 = fwdValue;
        }
      }
    }
    
    // Forwarding de MEM/WB (prioridade menor)
    if (prev.MEM_WB.instr && this._writesToRegister(prev.MEM_WB.instr)) {
      const rd = prev.MEM_WB.instr.rd;
      if (rd !== undefined && rd !== 0) {
        // Para LW, usar memData; para outras, usar aluResult
        const wbValue = (prev.MEM_WB.instr.opcode === "lw" && prev.MEM_WB.memData !== null && prev.MEM_WB.memData !== undefined)
          ? prev.MEM_WB.memData 
          : prev.MEM_WB.aluResult;
        
        // Só faz forwarding se EX/MEM não forneceu o mesmo registrador
        if (instr.rs1 !== undefined && instr.rs1 === rd) {
          if (!prev.EX_MEM.instr || prev.EX_MEM.instr.rd !== rd) {
            op1 = wbValue;
          }
        }
        if (instr.rs2 !== undefined && instr.rs2 === rd) {
          if (!prev.EX_MEM.instr || prev.EX_MEM.instr.rd !== rd) {
            op2 = wbValue;
          }
        }
      }
    }

    let alu = 0, takeBranch = false, targetPC = this.pc;

    // CORRIGIDO: Operações ALU com overflow de 32 bits
    switch (instr.opcode) {
      case "add": alu = (op1 + op2) | 0; break;
      case "sub": alu = (op1 - op2) | 0; break;
      case "and": alu = op1 & op2; break;
      case "or":  alu = op1 | op2; break;
      case "xor": alu = op1 ^ op2; break;
      case "slt": alu = (op1 < op2) ? 1 : 0; break;
      case "addi": alu = (op1 + instr.imm) | 0; break;
      case "lw": case "sw": alu = (op1 + instr.imm) | 0; break;
      case "beq": 
        takeBranch = (op1 === op2); 
        targetPC = (prev.ID_EX.pc + instr.imm) | 0; 
        break;
      case "bne": 
        takeBranch = (op1 !== op2); 
        targetPC = (prev.ID_EX.pc + instr.imm) | 0; 
        break;
      case "jal": 
        takeBranch = true; 
        alu = (prev.ID_EX.pc + 1) | 0; 
        targetPC = (prev.ID_EX.pc + instr.imm) | 0; 
        break;
      case "jalr": 
        takeBranch = true; 
        alu = (prev.ID_EX.pc + 1) | 0; 
        // CORRIGIDO: JALR deve zerar o bit menos significativo
        targetPC = ((op1 + instr.imm) & ~1) | 0; 
        break;
    }

    // Tratamento de branches e jumps
    if (["beq", "bne", "jal", "jalr"].includes(instr.opcode)) {
      const actual = takeBranch;
      const pcIndex = prev.ID_EX.pc;
      const predicted = this.predictor.predict(pcIndex);
      this.branchPredictions++;

      if (predicted !== actual) {
        this.flushes++;
        // CORRIGIDO: Flush mais robusto com flag de controle
        this.flushInProgress = true;
        this.IF_ID = { instr: this.nopInstr };
        this.ID_EX = { instr: this.nopInstr };
        this.EX_MEM = { instr: this.nopInstr };
        this.pc = actual ? targetPC : ((pcIndex + 1) | 0);
        this.jumpPending = true;
      } else {
        this.branchCorrect++;
      }

      this.predictor.update(pcIndex, actual);
    }

    this.EX_MEM = { 
      instr, 
      aluResult: alu, 
      rd: instr.rd, 
      rs2Val: op2 // CORRIGIDO: Usar op2 após forwarding
    };
  }

  // ---------------- MEM ----------------
  doMEM(prev) {
    if (this.flushInProgress) {
      this.MEM_WB = { instr: this.nopInstr };
      this.flushInProgress = false; // Limpa flag após flush completo
      return;
    }

    const instr = prev.EX_MEM.instr;
    if (this.isNOP(instr)) { 
      this.MEM_WB = { instr: this.nopInstr }; 
      return; 
    }

    let memData = null;
    if (instr.opcode === "lw") {
      const res = this.memoryHierarchy.readData(prev.EX_MEM.aluResult);
      if (!res.hit) { 
        this.stallCycles = res.latency; 
        this.stallsCache += res.latency; 
        return; 
      }
      memData = res.value;
    } else if (instr.opcode === "sw") {
      const res = this.memoryHierarchy.writeData(prev.EX_MEM.aluResult, prev.EX_MEM.rs2Val);
      if (!res.hit) { 
        this.stallCycles = res.latency; 
        this.stallsCache += res.latency; 
        return; 
      }
    }

    this.MEM_WB = { 
      instr, 
      aluResult: prev.EX_MEM.aluResult, 
      memData, 
      rd: instr.rd 
    };
  }

  // ---------------- WB ----------------
  doWB(prev) {
    const instr = prev.MEM_WB.instr;
    this.lastCommittedInstr = instr;
    if (this.isNOP(instr)) return;

    switch (instr.opcode) {
      case "add": case "sub": case "and": case "or": case "xor": case "slt":
      case "addi": case "jal": case "jalr":
        this.regFile.write(instr.rd, prev.MEM_WB.aluResult); 
        break;
      case "lw":
        this.regFile.write(instr.rd, prev.MEM_WB.memData); 
        break;
    }
    this.instructionsCommitted++;
  }

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

  tick() {
    if (this.finished) return;
    this.cycle++;
    
    if (this.cycle > this.maxCycles) { 
      console.warn("⚠️ Limite de ciclos atingido."); 
      this.finished = true; 
      return; 
    }

    // Snapshot do estado anterior para forwarding correto
    const prev = {
      IF_ID: this.IF_ID, 
      ID_EX: this.ID_EX, 
      EX_MEM: this.EX_MEM, 
      MEM_WB: this.MEM_WB
    };

    // Ordem inversa com snapshots
    this.doWB(prev);

    if (this.stallCycles > 0) {
      this.stallCycles--;
      this.checkCompletion();
      return;
    }

    this.doMEM(prev);
    this.doEX(prev);
    this.doID(prev);
    this.doIF(prev);

    this.checkCompletion();
  }

  // CORRIGIDO: Lógica de completion mais robusta
  checkCompletion() {
    // Verifica se o pipeline está completamente vazio
    const pipelineEmpty = [this.IF_ID, this.ID_EX, this.EX_MEM, this.MEM_WB]
      .every(s => this.isNOP(s.instr));
    
    // Verifica se não há mais instruções para buscar
    const pcBeyondProgram = this.pc >= this.program.length;
    
    // Verifica se não há stalls pendentes
    const noStalls = this.stallCycles === 0 && !this.stall;
    
    // Só finaliza se todas as condições forem satisfeitas
    if (pipelineEmpty && pcBeyondProgram && noStalls && !this.flushInProgress) {
      this.finished = true;
      console.log("✅ SIMULAÇÃO FINALIZADA - Ciclos:", this.cycle, "| Instruções:", this.instructionsCommitted);
    }
  }
}

window.PipelineSimulator = PipelineSimulator;