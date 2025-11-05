// main.js — controlador da UI
let sim = null;
let running = false;

// popula tabela de registradores
const regsTbody = document.querySelector("#registers tbody");
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function programFromTextarea() {
  const raw = document.getElementById("program-input").value;
  return raw.split(/\r?\n/).map(l => l.trim()).filter(l => l !== "" && !l.startsWith("//"));
}

// ----- DIAGRAMA -----
function resetDiagram(program) {
  const header = document.getElementById("pipeline-diagram-header");
  const body = document.getElementById("pipeline-diagram-body");
  header.innerHTML = "<th>Instrução</th>";
  body.innerHTML = "";
  // cria linhas
  program.forEach((line, i) => {
    const row = document.createElement("tr");
    const instrCell = document.createElement("td");
    instrCell.textContent = line;
    row.appendChild(instrCell);
    body.appendChild(row);
  });
  // adiciona coluna C0
  addCycleToDiagram({ cycle: 0, program: program.map((l, idx) => ({ raw: l, pc: idx })) });
}

function addCycleToDiagram(simInstance) {
  // cabeçalho
  const header = document.getElementById("pipeline-diagram-header");
  const body = document.getElementById("pipeline-diagram-body");
  const th = document.createElement("th");
  th.textContent = "C" + simInstance.cycle;
  header.appendChild(th);

  const rows = body.querySelectorAll("tr");
  rows.forEach((row, idx) => {
    const td = document.createElement("td");
    let stage = "";
    // tenta identificar em qual estágio a instrução de pc == idx está
    const instrAtIdx = sim && sim.program && sim.program[idx] ? sim.program[idx] : null;
    if (sim && sim.IF_ID && sim.IF_ID.instr && sim.IF_ID.instr.pc === idx) stage = "IF";
    else if (sim && sim.ID_EX && sim.ID_EX.instr && sim.ID_EX.instr.pc === idx) stage = "ID";
    else if (sim && sim.EX_MEM && sim.EX_MEM.instr && sim.EX_MEM.instr.pc === idx) stage = "EX";
    else if (sim && sim.MEM_WB && sim.MEM_WB.instr && sim.MEM_WB.instr.pc === idx) stage = "MEM/WB";
    td.textContent = stage || "";
    if (stage) td.classList.add("stage");
    row.appendChild(td);
  });
}

// ----- Botões / controles -----
document.getElementById("btn-load").addEventListener("click", () => {
  const program = programFromTextarea();
  if (program.length === 0) return alert("Cole ou selecione um programa antes de carregar.");

  // cria instância do simulador
  sim = new PipelineSimulator(program, {
    predictorSize: 32
  });

  // reseta diagrama e UI
  resetDiagram(program);
  updateUI();
  alert("Programa carregado. Use 'Próximo Ciclo' ou 'Executar Tudo'.");
});

document.getElementById("btn-step").addEventListener("click", () => {
  if (!sim) return alert("Carregue um programa primeiro.");
  sim.tick();
  addCycleToDiagram(sim);
  updateUI();
  if (sim.finished) alert("Simulação finalizada.");
});

document.getElementById("btn-run").addEventListener("click", async () => {
  if (!sim) return alert("Carregue um programa primeiro.");
  running = true;
  for (let i = 0; i < 500 && !sim.finished && running; i++) {
    sim.tick();
    addCycleToDiagram(sim);
    updateUI();
    await sleep(120);
  }
  running = false;
  if (sim && sim.finished) alert("Simulação finalizada.");
});

document.getElementById('btn-reset').addEventListener('click', () => {
  running = false;
  if (sim) sim = null;

  // visual reset (mantém o conteúdo do textarea)
  document.querySelectorAll('#pipeline td').forEach(td => td.innerText = '-');
  for (let i = 0; i < 32; i++) document.getElementById('reg-' + i).innerText = '0';
  document.querySelectorAll('#metrics td').forEach(td => td.innerText = '0');

  // limpa caches e diagrama
  document.querySelectorAll('#cache-table td').forEach(td => td.innerText = '0');
  const header = document.getElementById("pipeline-diagram-header");
  const body = document.getElementById("pipeline-diagram-body");
  if (header && body) { header.innerHTML = "<th>Instrução</th>"; body.innerHTML = ""; }
});

document.getElementById('btn-export').addEventListener('click', () => {
  if (!sim) {
    alert("❌ Nenhuma simulação em execução ou carregada.");
    return;
  }

  try {
    // monta objeto de métricas
    const cycles = sim.cycle;
    const instr = sim.instructionsCommitted || 0;
    const cpi = instr ? (cycles / instr).toFixed(4) : "";
    const branchAcc = sim.branchPredictions ? (sim.branchCorrect / sim.branchPredictions).toFixed(4) : "";

    // caches
    const stats = sim.memoryHierarchy ? sim.memoryHierarchy.stats() : [];
    // stats order: L1I, L1D, L2, L3 (conforme cache.js)
    const [L1I, L1D, L2, L3] = stats;

    const header = [
      "Benchmark",
      "cycles",
      "instructionsCommitted",
      "CPI",
      "stallsData",
      "stallsCache",
      "flushes",
      "branchPredictions",
      "branchCorrect",
      "branchAccuracy",
      "L1I_hits",
      "L1I_misses",
      "L1D_hits",
      "L1D_misses",
      "L2_hits",
      "L2_misses",
      "L3_hits",
      "L3_misses"
    ];

    const benchSelect = document.getElementById("benchmark-select");
    const benchName = benchSelect ? (benchSelect.options[benchSelect.selectedIndex].text || benchSelect.value) : "custom";

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
      branchAcc || "",
      (L1I ? L1I.hits : 0),
      (L1I ? L1I.misses : 0),
      (L1D ? L1D.hits : 0),
      (L1D ? L1D.misses : 0),
      (L2 ? L2.hits : 0),
      (L2 ? L2.misses : 0),
      (L3 ? L3.hits : 0),
      (L3 ? L3.misses : 0)
    ];

    let csv = header.join(";") + "\n" + values.join(";");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = (benchName || "metrics") + ".csv";
    link.click();
    URL.revokeObjectURL(link.href);
    alert("✅ CSV exportado com sucesso!");
  } catch (error) {
    console.error("Erro ao exportar CSV:", error);
    alert("❌ Ocorreu um erro ao gerar o CSV. Veja o console.");
  }
});

// botão para abrir gráficos
document.getElementById("btn-graphs").addEventListener("click", () => {
  window.location.href = "graficos.html";
});

// quick benches
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
    document.getElementById("program-input").value = examples[id] || "";
    // marca select pra controle visual
    document.getElementById("benchmark-select").value = id;
  });
});

// Atualiza UI a partir do estado do simulador
function updateUI() {
  if (!sim) return;

  document.getElementById('stage-if').innerText = sim.IF_ID && sim.IF_ID.instr ? sim.IF_ID.instr.opcode : 'nop';
  document.getElementById('stage-id').innerText = sim.ID_EX && sim.ID_EX.instr ? sim.ID_EX.instr.opcode : 'nop';
  document.getElementById('stage-ex').innerText = sim.EX_MEM && sim.EX_MEM.instr ? sim.EX_MEM.instr.opcode : 'nop';
  document.getElementById('stage-mem').innerText = sim.MEM_WB && sim.MEM_WB.instr ? (sim.MEM_WB.instr.opcode) : 'nop';
  document.getElementById('stage-wb').innerText = sim.MEM_WB && sim.MEM_WB.instr ? sim.MEM_WB.instr.opcode : 'nop';

  // registradores
  if (sim.regFile && sim.regFile.regs) {
    sim.regFile.regs.forEach((val, i) => {
      const el = document.getElementById('reg-' + i);
      if (el) el.innerText = val;
    });
  }

  // métricas
  document.getElementById('metrics-cycles').innerText = sim.cycle;
  const CPI = sim.instructionsCommitted > 0 ? (sim.cycle / sim.instructionsCommitted).toFixed(2) : 0;
  document.getElementById('metrics-cpi').innerText = CPI;
  document.getElementById('metrics-stalls').innerText = (sim.stallsData || 0) + (sim.stallsCache || 0);
  document.getElementById('metrics-flushes').innerText = sim.flushes || 0;
  document.getElementById('metrics-branch').innerText = `${sim.branchCorrect || 0}/${sim.branchPredictions || 0}`;

  // caches (usa memoryHierarchy.stats())
  if (sim.memoryHierarchy) {
    const stats = sim.memoryHierarchy.stats();
    const [L1I, L1D, L2, L3] = stats;
    if (L1I) {
      document.getElementById('cache-l1i-hits').innerText = L1I.hits;
      document.getElementById('cache-l1i-misses').innerText = L1I.misses;
      document.getElementById('cache-l1i-rate').innerText = ((L1I.hits / Math.max(1, L1I.accesses)) * 100).toFixed(2);
    }
    if (L1D) {
      document.getElementById('cache-l1d-hits').innerText = L1D.hits;
      document.getElementById('cache-l1d-misses').innerText = L1D.misses;
      document.getElementById('cache-l1d-rate').innerText = ((L1D.hits / Math.max(1, L1D.accesses)) * 100).toFixed(2);
    }
    if (L2) {
      document.getElementById('cache-l2-hits').innerText = L2.hits;
      document.getElementById('cache-l2-misses').innerText = L2.misses;
      document.getElementById('cache-l2-rate').innerText = ((L2.hits / Math.max(1, L2.accesses)) * 100).toFixed(2);
    }
    if (L3) {
      document.getElementById('cache-l3-hits').innerText = L3.hits;
      document.getElementById('cache-l3-misses').innerText = L3.misses;
      document.getElementById('cache-l3-rate').innerText = ((L3.hits / Math.max(1, L3.accesses)) * 100).toFixed(2);
    }
  }
}