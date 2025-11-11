// main.js – controlador da UI (CORRIGIDO)
let sim = null;
let running = false;
const MAX_DIAGRAM_COLS = 500; // CORRIGIDO: Aumentado de 200 para 500
let autoScroll = true;

// Popula tabela de registradores
const regsTbody = document.querySelector("#registers tbody");
if (regsTbody) {
  for (let i = 0; i < 32; i++) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.innerText = "x" + i;
    const tdVal = document.createElement("td");
    tdVal.id = "reg-" + i;
    tdVal.innerText = "0";
    tr.appendChild(tdName);
    tr.appendChild(tdVal);
    regsTbody.appendChild(tr);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function programFromTextarea() {
  const textarea = document.getElementById("program-input");
  if (!textarea) {
    console.error("Textarea de programa não encontrada");
    return [];
  }
  const raw = textarea.value;
  return raw.split(/\r?\n/).map(l => l.trim()).filter(l => l !== "" && !l.startsWith("//"));
}

// ----- DIAGRAMA -----
function resetDiagram(program) {
  const header = document.getElementById("pipeline-diagram-header");
  const body = document.getElementById("pipeline-diagram-body");
  
  if (!header || !body) {
    console.warn("Elementos do diagrama não encontrados");
    return;
  }

  header.innerHTML = "<th>Instrução</th>";
  body.innerHTML = "";
  
  program.forEach((line) => {
    const row = document.createElement("tr");
    const instrCell = document.createElement("td");
    instrCell.textContent = line;
    row.appendChild(instrCell);
    body.appendChild(row);
  });
  
  addCycleToDiagram({ cycle: 0, program: program.map((l, idx) => ({ raw: l, pc: idx })) });
}

function addCycleToDiagram(simInstance) {
  const header = document.getElementById("pipeline-diagram-header");
  const body = document.getElementById("pipeline-diagram-body");
  const diagramContainer = document.querySelector("#pipeline-diagram-container .content");

  if (!header || !body) return;

  // CORRIGIDO: Cap de colunas aumentado e com aviso ao usuário
  const currentCols = header.querySelectorAll("th").length - 1;
  if (currentCols >= MAX_DIAGRAM_COLS) {
    if (currentCols === MAX_DIAGRAM_COLS) {
      console.warn(`⚠️ Limite de ${MAX_DIAGRAM_COLS} colunas no diagrama atingido`);
    }
    return;
  }

  const th = document.createElement("th");
  th.textContent = "C" + simInstance.cycle;
  header.appendChild(th);

  const rows = body.querySelectorAll("tr");
  rows.forEach((row, idx) => {
    const td = document.createElement("td");
    let stage = "";
    
    // Mostrar apenas o estágio ATUAL (ordem de prioridade: WB > MEM > EX > ID > IF)
    if (simInstance.lastCommittedInstr && simInstance.lastCommittedInstr.pc === idx && simInstance.lastCommittedInstr.opcode !== "nop") {
      stage = "WB";
    } else if (simInstance.MEM_WB && simInstance.MEM_WB.instr && simInstance.MEM_WB.instr.pc === idx) {
      stage = "MEM";
    } else if (simInstance.EX_MEM && simInstance.EX_MEM.instr && simInstance.EX_MEM.instr.pc === idx) {
      stage = "EX";
    } else if (simInstance.ID_EX && simInstance.ID_EX.instr && simInstance.ID_EX.instr.pc === idx) {
      stage = "ID";
    } else if (simInstance.IF_ID && simInstance.IF_ID.instr && simInstance.IF_ID.instr.pc === idx) {
      stage = "IF";
    }

    td.textContent = stage;
    if (stage) {
      td.classList.add("stage");
      td.classList.add("stage-" + stage); // Adiciona classe específica para cor
    }
    row.appendChild(td);
  });

  // Auto scroll para a direita
  if (autoScroll && diagramContainer) {
    setTimeout(() => {
      try {
        diagramContainer.scrollLeft = diagramContainer.scrollWidth;
      } catch (e) {
        console.warn("Erro ao fazer scroll no diagrama:", e);
      }
    }, 10);
  }
}

// ----- Botões / controles -----
const btnLoad = document.getElementById("btn-load");
if (btnLoad) {
  btnLoad.addEventListener("click", () => {
    try {
      const program = programFromTextarea();
      if (program.length === 0) {
        alert("❌ Cole ou selecione um programa antes de carregar.");
        return;
      }

      // CORRIGIDO: Validação da existência de dependências
      if (typeof PipelineSimulator === 'undefined') {
        alert("❌ Módulo PipelineSimulator não carregado. Recarregue a página.");
        console.error("PipelineSimulator não definido");
        return;
      }

      sim = new PipelineSimulator(program, { predictorSize: 32, maxCycles: 2000 });

      resetDiagram(program);
      updateUI();
      alert("✅ Programa carregado. Use 'Próximo Ciclo' ou 'Executar Tudo'.");
    } catch (error) {
      console.error("Erro ao carregar programa:", error);
      alert(`❌ Erro ao carregar programa: ${error.message}`);
    }
  });
}

const btnStep = document.getElementById("btn-step");
if (btnStep) {
  btnStep.addEventListener("click", () => {
    if (!sim) {
      alert("❌ Carregue um programa primeiro.");
      return;
    }
    
    try {
      sim.tick();
      addCycleToDiagram(sim);
      updateUI();
      
      if (sim.finished) {
        alert("✅ Simulação finalizada.");
      }
    } catch (error) {
      console.error("Erro ao executar ciclo:", error);
      alert(`❌ Erro ao executar ciclo: ${error.message}`);
    }
  });
}

const btnRun = document.getElementById("btn-run");
if (btnRun) {
  btnRun.addEventListener("click", async () => {
    if (!sim) {
      alert("❌ Carregue um programa primeiro.");
      return;
    }
    
    try {
      running = true;
      let loops = 0;
      const maxLoops = 2000; // CORRIGIDO: Limite de segurança
      
      while (!sim.finished && running && loops < maxLoops) {
        sim.tick();
        addCycleToDiagram(sim);
        updateUI();
        await sleep(40); // Animação mais fluida
        loops++;
      }
      
      running = false;
      
      if (loops >= maxLoops && !sim.finished) {
        alert(`⚠️ Simulação interrompida após ${maxLoops} iterações.`);
      } else if (sim && sim.finished) {
        alert("✅ Simulação finalizada.");
      }
    } catch (error) {
      running = false;
      console.error("Erro durante execução:", error);
      alert(`❌ Erro durante execução: ${error.message}`);
    }
  });
}

const btnReset = document.getElementById('btn-reset');
if (btnReset) {
  btnReset.addEventListener('click', () => {
    try {
      running = false;
      sim = null;

      // Reset de elementos da UI
      const stageElements = ['stage-if', 'stage-id', 'stage-ex', 'stage-mem', 'stage-wb'];
      stageElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = '-';
      });

      // Reset registradores
      for (let i = 0; i < 32; i++) {
        const el = document.getElementById('reg-' + i);
        if (el) el.innerText = '0';
      }

      // Reset métricas
      const metricsElements = {
        'metrics-cycles': '0',
        'metrics-cpi': '0',
        'metrics-stalls': '0',
        'metrics-flushes': '0',
        'metrics-branch': '0/0'
      };
      
      Object.entries(metricsElements).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
      });

      // Reset cache stats
      ['l1i', 'l1d', 'l2', 'l3'].forEach(l => {
        ['hits', 'misses', 'rate'].forEach(metric => {
          const el = document.getElementById(`cache-${l}-${metric}`);
          if (el) el.innerText = '0';
        });
      });

      // Reset diagrama
      const header = document.getElementById("pipeline-diagram-header");
      const body = document.getElementById("pipeline-diagram-body");
      if (header) header.innerHTML = "<th>Instrução</th>";
      if (body) body.innerHTML = "";

      console.log("🔄 SISTEMA COMPLETAMENTE RESETADO");
    } catch (error) {
      console.error("Erro ao resetar:", error);
      alert(`❌ Erro ao resetar: ${error.message}`);
    }
  });
}

const btnExport = document.getElementById('btn-export');
if (btnExport) {
  btnExport.addEventListener('click', () => {
    if (!sim) {
      alert("❌ Nenhuma simulação em execução ou carregada.");
      return;
    }
    
    try {
      const cycles = sim.cycle || 0;
      const instr = sim.instructionsCommitted || 0;
      const cpi = instr ? (cycles / instr).toFixed(4) : "0";
      const branchAcc = sim.branchPredictions ? ((sim.branchCorrect / sim.branchPredictions) * 100).toFixed(2) : "0";

      // CORRIGIDO: Validação da hierarquia de memória
      const stats = (sim.memoryHierarchy && typeof sim.memoryHierarchy.stats === 'function') 
        ? sim.memoryHierarchy.stats() 
        : [];
      
      const [L1I, L1D, L2, L3] = stats;

      const header = [
        "Benchmark", "cycles", "instructionsCommitted", "CPI", "stallsData", "stallsCache", "flushes",
        "branchPredictions", "branchCorrect", "branchAccuracy",
        "L1I_hits", "L1I_misses", "L1D_hits", "L1D_misses", "L2_hits", "L2_misses", "L3_hits", "L3_misses"
      ];

      const benchSelect = document.getElementById("benchmark-select");
      const benchName = benchSelect ? (benchSelect.options[benchSelect.selectedIndex]?.text || benchSelect.value || "custom") : "custom";

      const values = [
        benchName,
        cycles,
        instr,
        cpi,
        sim.stallsData || 0,
        sim.stallsCache || 0,
        sim.flushes || 0,
        sim.branchPredictions || 0,
        sim.branchCorrect || 0,
        branchAcc,
        (L1I ? L1I.hits : 0),
        (L1I ? L1I.misses : 0),
        (L1D ? L1D.hits : 0),
        (L1D ? L1D.misses : 0),
        (L2 ? L2.hits : 0),
        (L2 ? L2.misses : 0),
        (L3 ? L3.hits : 0),
        (L3 ? L3.misses : 0)
      ].map(v => {
        if (v === undefined || Number.isNaN(v) || v === null) return 0;
        return v;
      });

      const csv = header.join(";") + "\n" + values.join(";");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const filename = `${benchName.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.csv`;
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
      
      console.log(`✅ CSV exportado: ${filename}`);
      alert("✅ CSV exportado com sucesso!");
    } catch (error) {
      console.error("Erro ao exportar CSV:", error);
      alert(`❌ Erro ao gerar CSV: ${error.message}`);
    }
  });
}

const btnGraphs = document.getElementById("btn-graphs");
if (btnGraphs) {
  btnGraphs.addEventListener("click", () => {
    window.location.href = "graficos.html";
  });
}

const btnHelp = document.getElementById("btn-help");
if (btnHelp) {
  btnHelp.addEventListener("click", () => {
    alert(`📖 AJUDA RÁPIDA

🔹 PASSOS BÁSICOS:
1. Selecione um benchmark ou digite código assembly
2. Clique em "Carregar Programa"
3. Use "Próximo Ciclo" para execução passo a passo
4. Use "Executar Tudo" para execução completa
5. Exporte métricas em CSV para análise

🔹 INSTRUÇÕES SUPORTADAS:
• ALU: add, sub, and, or, xor, slt, addi
• Memória: lw, sw
• Controle: beq, bne, jal, jalr
• Outros: nop

🔹 FORMATO:
• add x1, x2, x3    # Registradores: x0-x31
• lw x1, 0(x2)      # offset(base)
• beq x1, x2, 4     # offset em instruções

🔹 MÉTRICAS:
• CPI: Ciclos por instrução
• Stalls: Paradas por hazards
• Flushes: Previsões incorretas
• Cache: Taxa de acerto L1I/L1D/L2/L3`);
  });
}

// Toggle auto scroll
const autoScrollToggle = document.getElementById("auto-scroll-toggle");
if (autoScrollToggle) {
  autoScrollToggle.addEventListener("click", function() {
    autoScroll = !autoScroll;
    this.textContent = `Auto Scroll: ${autoScroll ? 'ON' : 'OFF'}`;
    this.classList.toggle("active", autoScroll);
  });
}

// Evento para carregar benchmark do dropdown
const benchmarkSelect = document.getElementById("benchmark-select");
if (benchmarkSelect) {
  benchmarkSelect.addEventListener("change", function() {
    const value = this.value;
    if (!value) return;
    
    const examples = {
      alu1: `addi x1, x0, 1
addi x2, x0, 2
add x3, x1, x2
add x4, x3, x1
nop`,
      alu2: `addi x1, x0, 5
addi x2, x0, 6
add x3, x1, x2
add x4, x3, x3
nop`,
      mem1: `addi x1, x0, 0
lw x2, 0(x1)
addi x1, x1, 1
lw x3, 0(x1)
nop`,
      mem2: `addi x1, x0, 0
addi x2, x0, 7
sw x2, 0(x1)
addi x1, x1, 1
sw x2, 0(x1)
nop`,
      ctrl1: `addi x1, x0, 5
addi x2, x0, 0
beq x2, x1, 2
addi x2, x2, 1
beq x0, x0, -2
nop`,
      ctrl2: `addi x1, x0, 0
addi x2, x0, 1
beq x1, x2, 2
addi x1, x1, 1
addi x2, x2, 1
nop`
    };
    
    const programInput = document.getElementById("program-input");
    if (examples[value] && programInput) {
      programInput.value = examples[value];
    }
  });
}

// Botões rápidos de benchmark
document.querySelectorAll(".bench").forEach(btn => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.prog;
    const examples = {
      alu1: `addi x1, x0, 1
addi x2, x0, 2
add x3, x1, x2
add x4, x3, x1
nop`,
      alu2: `addi x1, x0, 5
addi x2, x0, 6
add x3, x1, x2
add x4, x3, x3
nop`,
      mem1: `addi x1, x0, 0
lw x2, 0(x1)
addi x1, x1, 1
lw x3, 0(x1)
nop`,
      mem2: `addi x1, x0, 0
addi x2, x0, 7
sw x2, 0(x1)
addi x1, x1, 1
sw x2, 0(x1)
nop`,
      ctrl1: `addi x1, x0, 5
addi x2, x0, 0
beq x2, x1, 2
addi x2, x2, 1
beq x0, x0, -2
nop`,
      ctrl2: `addi x1, x0, 0
addi x2, x0, 1
beq x1, x2, 2
addi x1, x1, 1
addi x2, x2, 1
nop`
    };
    
    const programInput = document.getElementById("program-input");
    const benchSelect = document.getElementById("benchmark-select");
    
    if (programInput) programInput.value = examples[id] || "";
    if (benchSelect) benchSelect.value = id;
  });
});

// CORRIGIDO: Função de atualização da UI mais robusta
function updateUI() {
  if (!sim) return;

  try {
    // Mapear registradores de pipeline para estágios mostrados
    const stages = {
      'stage-if': sim.IF_ID?.instr?.opcode || 'nop',
      'stage-id': sim.ID_EX?.instr?.opcode || 'nop',
      'stage-ex': sim.EX_MEM?.instr?.opcode || 'nop',
      'stage-mem': sim.MEM_WB?.instr?.opcode || 'nop',
      'stage-wb': sim.lastCommittedInstr?.opcode || 'nop'
    };

    Object.entries(stages).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.innerText = value;
    });

    // Atualizar registradores
    if (sim.regFile && sim.regFile.regs) {
      sim.regFile.regs.forEach((val, i) => {
        const el = document.getElementById('reg-' + i);
        if (el) el.innerText = val;
      });
    }

    // Atualizar métricas
    const CPI = sim.instructionsCommitted > 0 ? (sim.cycle / sim.instructionsCommitted).toFixed(2) : 0;
    const metricsData = {
      'metrics-cycles': sim.cycle || 0,
      'metrics-cpi': CPI,
      'metrics-stalls': (sim.stallsData || 0) + (sim.stallsCache || 0),
      'metrics-flushes': sim.flushes || 0,
      'metrics-branch': `${sim.branchCorrect || 0}/${sim.branchPredictions || 0}`
    };

    Object.entries(metricsData).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.innerText = value;
    });

    // Atualizar estatísticas de cache
    if (sim.memoryHierarchy && typeof sim.memoryHierarchy.stats === 'function') {
      const stats = sim.memoryHierarchy.stats();
      const [L1I, L1D, L2, L3] = stats;
      
      const cacheStats = [
        { prefix: 'l1i', data: L1I },
        { prefix: 'l1d', data: L1D },
        { prefix: 'l2', data: L2 },
        { prefix: 'l3', data: L3 }
      ];

      cacheStats.forEach(({ prefix, data }) => {
        if (data) {
          const hitsEl = document.getElementById(`cache-${prefix}-hits`);
          const missesEl = document.getElementById(`cache-${prefix}-misses`);
          const rateEl = document.getElementById(`cache-${prefix}-rate`);
          
          if (hitsEl) hitsEl.innerText = data.hits || 0;
          if (missesEl) missesEl.innerText = data.misses || 0;
          if (rateEl) {
            const rate = data.accesses ? ((data.hits / data.accesses) * 100).toFixed(2) : "0.00";
            rateEl.innerText = rate;
          }
        }
      });
    }
  } catch (error) {
    console.error("Erro ao atualizar UI:", error);
  }
}

// Inicialização com verificação
document.addEventListener('DOMContentLoaded', () => {
  console.log("🚀 Simulador de Pipeline iniciado");
  
  // Verificações de dependências
  if (typeof PipelineSimulator === 'undefined') {
    console.error("❌ PipelineSimulator não carregado");
  }
  if (typeof MemoryHierarchy === 'undefined') {
    console.error("❌ MemoryHierarchy não carregado");
  }
  
  console.log("✅ Módulos carregados com sucesso");
});