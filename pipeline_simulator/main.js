// ==============================
// main.js – UI do simulador
// ==============================

let sim = null;
let running = false;

// Histórico por instrução (uma linha por PC do programa “visível”)
// Cada entrada: { pc, row, cycles: [" ", "IF", "ID", ...] }
let pipelineHistory = [];

// ------------------------------
// Benchmarks (iguais aos que você já usava)
// ------------------------------
const benchmarks = {
  alu1: [
    "addi x1, x0, 10", // pc 0
    "addi x2, x0, 0",  // pc 1
    "addi x5, x0, 1",  // pc 2
    "loop:",
    "add x2, x2, x1",  // pc 3
    "sub x1, x1, x5",  // pc 4
    "bne x1, x0, -2",  // pc 5 -> volta para pc 3
    "nop"              // pc 6
  ],
  alu2: [
    "addi x1, x0, 5",
    "addi x2, x0, 2",
    "add x3, x1, x2",
    "sub x4, x3, x1",
    "xor x5, x3, x4",
    "or x6, x5, x2",
    "and x7, x6, x1",
    "nop"
  ],
  mem1: [
    "addi x1, x0, 0",
    "lw x2, 0(x1)",
    "add x3, x2, x2", // Stall (Load-Use)
    "lw x4, 1(x1)",
    "add x5, x4, x4", // Stall (Load-Use)
    "nop"
  ],
  mem2: [
    "addi x1, x0, 0",
    "addi x2, x0, 5",
    "sw x2, 0(x1)",
    "sw x2, 1(x1)",
    "sw x2, 2(x1)",
    "sw x2, 3(x1)",
    "nop"
  ],
  ctrl1: [
    "addi x1, x0, 3", // Loop 3 vezes
    "addi x5, x0, 1",
    "loop_ctrl:",
    "sub x1, x1, x5", // pc 2
    "bne x1, x0, -1", // pc 3 -> volta para pc 2
    "nop"
  ],
  ctrl2: [
    "addi x1, x0, 0",
    "addi x2, x0, 1",
    "beq x1, x2, 2", // Not-taken
    "addi x3, x0, 5",
    "bne x1, x2, -3", // Taken (flush)
    "nop"
  ]
};

// ------------------------------
// Utilitários DOM seguros (não quebram se id não existir)
// ------------------------------
function $(id) { return document.getElementById(id); }
function setText(id, value) { const el = $(id); if (el) el.innerText = value; }
function appendHeaderCycle(cycle) {
  const hdr = $("pipeline-diagram-header");
  if (!hdr) return;
  const th = hdr.insertCell();
  th.innerText = `C ${cycle}`;
}
function resetDiagram() {
  const body = $("pipeline-diagram-body");
  const header = $("pipeline-diagram-header");
  if (body) body.innerHTML = "";
  if (header) { header.innerHTML = "<th>Instrução</th>"; appendHeaderCycle(0); }
  pipelineHistory = [];
}

// ------------------------------
// Monta a tabela de registradores
// ------------------------------
(function buildRegs() {
  const tbl = $("registers");
  if (!tbl) return;
  // Evita duplicar ao recarregar a página
  if (tbl.rows.length > 0) return;

  for (let i = 0; i < 32; i++) {
    const row = tbl.insertRow();
    const c0 = row.insertCell(); c0.innerText = `x${i}`;
    const c1 = row.insertCell(); c1.id = `reg-${i}`; c1.innerText = "0";
  }
})();

// ------------------------------
// Eventos básicos
// ------------------------------
const sel = $("benchmark-select");
if (sel) {
  sel.addEventListener("change", e => {
    const key = e.target.value;
    const prog = benchmarks[key];
    if (prog && $("program-input")) $("program-input").value = prog.join("\n");
  });
}

const btnLoad = $("btn-load");
if (btnLoad) btnLoad.addEventListener("click", onLoadProgram);

const btnStep = $("btn-step");
if (btnStep) btnStep.addEventListener("click", onStep);

const btnRun = $("btn-run");
if (btnRun) btnRun.addEventListener("click", onRun);

const btnReset = $("btn-reset");
if (btnReset) btnReset.addEventListener("click", onReset);

const btnExport = $("btn-export");
if (btnExport) btnExport.addEventListener("click", onExport);

// ------------------------------
// Ações
// ------------------------------
function onLoadProgram() {
  const ta = $("program-input");
  if (!ta) return;
  const program = ta.value
    .split("\n")
    .map(s => s.trim())
    .filter(s => s !== "" && !s.startsWith("//") && !s.startsWith("#"));

  // Config simples (pipeline.js usa predictorSize)
  const config = { predictorSize: 32 };

  // PipelineSimulator vem do pipeline.js (global)
  sim = new window.PipelineSimulator(program, config);

  // Monta linhas do diagrama (uma por instrução “de verdade” no programa)
  resetDiagram();
  const body = $("pipeline-diagram-body");
  if (!body) return;

  sim.program.forEach((instr, index) => {
    // pula labels (nop cujo raw tem ':') e nops explícitos
    if (!instr || instr.opcode === "nop" || (instr.raw && instr.raw.includes(":"))) return;

    const row = body.insertRow();
    row.id = `instr-row-${index}`;
    const nameCell = row.insertCell();
    nameCell.innerText = `(${index}) ${instr.raw}`;

    // primeira célula “C 0”
    const first = row.insertCell();
    first.innerText = " ";
    first.className = "stage- ";

    pipelineHistory.push({ pc: index, row, cycles: [" "] });
  });

  updateUI(); // Atualiza registradores/metrics iniciais
}

function onStep() {
  if (!sim || sim.finished) return;
  sim.tick();
  updateUI();
  updatePipelineDiagram();
}

async function onRun() {
  if (!sim) return;
  running = true;
  // Limite de segurança para não travar UI
  const LIMIT = 2000;
  while (running && !sim.finished && sim.cycle < LIMIT) {
    sim.tick();
    updateUI();
    updatePipelineDiagram();
    // pequeno delay para ver o diagrama “andar”
    await new Promise(r => setTimeout(r, 60));
  }
  running = false;
  if (sim && sim.cycle >= LIMIT) alert("Limite de ciclos atingido.");
}

function onReset() {
  running = false;
  sim = null;

  // limpa tabela de pipeline corrente (IF..WB)
  ["stage-if","stage-id","stage-ex","stage-mem","stage-wb"].forEach(id => setText(id, "-"));

  // zera registradores
  for (let i = 0; i < 32; i++) setText(`reg-${i}`, "0");

  // zera métricas
  setText("metrics-cycles", "0");
  setText("metrics-cpi", "0");
  setText("metrics-stalls", "0");
  setText("metrics-flushes", "0");
  setText("metrics-branch", "0/0");

  // caches
  ["l1i","l1d","l2","l3"].forEach(level => {
    setText(`metrics-${level}-hit`, "0");
    setText(`metrics-${level}-miss`, "0");
    setText(`metrics-${level}-hitrate`, "0");
  });

  // limpa diagrama
  resetDiagram();
}

function onExport() {
  if (!sim) { alert("Nenhuma simulação carregada!"); return; }
  const csv = buildMetricsCSV(sim);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "metrics.csv"; a.click();
  URL.revokeObjectURL(url);
  alert("CSV exportado.");
}

// ------------------------------
// Diagrama de pipeline por ciclo
// ------------------------------
function updatePipelineDiagram() {
  if (!sim) return;

  // adiciona coluna de cabeçalho para o ciclo atual
  appendHeaderCycle(sim.cycle);

  // captura “PC -> estágio” no ciclo atual
  const stageNow = new Map();
  if (sim.IF_ID && !sim.isNOP(sim.IF_ID.instr))      stageNow.set(sim.IF_ID.instr.pc,        "IF");
  if (sim.ID_EX && !sim.isNOP(sim.ID_EX.instr))      stageNow.set(sim.ID_EX.instr.pc,        "ID");
  if (sim.EX_MEM && !sim.isNOP(sim.EX_MEM.instr))    stageNow.set(sim.EX_MEM.instr.pc,       "EX");
  if (sim.MEM_WB && !sim.isNOP(sim.MEM_WB.instr))    stageNow.set(sim.MEM_WB.instr.pc,       "MEM");
  if (sim.lastCommittedInstr && !sim.isNOP(sim.lastCommittedInstr))
    stageNow.set(sim.lastCommittedInstr.pc, "WB");

  // Atualiza cada linha (PC “original” do programa)
  pipelineHistory.forEach(entry => {
    const td = entry.row.insertCell();
    const last = entry.cycles[entry.cycles.length - 1] || " ";
    let cur = " ";

    // 1) estágio ativo neste ciclo
    if (stageNow.has(entry.pc)) {
      cur = stageNow.get(entry.pc);
    }
    // 2) flush de branch/jump resolvido no EX (pipeline.js controla sim.flushedPCs)
    else if (Array.isArray(sim.flushedPCs) && sim.flushedPCs.includes(entry.pc)) {
      cur = "FLUSH";
    }
    // 3) bolha de dependência (load-use) – pipeline.js marca this.stall e injeta NOP em ID na rodada
    else if (sim.stall && last === "ID") {
      cur = "STALL";
    }
    // 4) “persistência” de estágio em caso de stall de cache – pipeline.js usa stallCycles internamente
    //    Aqui, se não houve estágio novo, mantemos estágio “ativo” (IF/ID/EX/MEM) do último ciclo
    else if (last === "IF" || last === "ID" || last === "EX" || last === "MEM") {
      // repete o estágio quando o pipeline “congelou” (visual)
      cur = last;
    }
    // 5) após WB, transforma numa marca “.” no próximo ciclo (não bloqueia reaparecer em loops)
    else if (last === "WB" || last === ".") {
      cur = ".";
    }
    // 6) senão, permanece vazio

    td.innerText = cur;
    td.className = ""; // limpa classes anteriores para minimizar acúmulo
    if      (cur === "IF")    td.classList.add("stage-if");
    else if (cur === "ID")    td.classList.add("stage-id");
    else if (cur === "EX")    td.classList.add("stage-ex");
    else if (cur === "MEM")   td.classList.add("stage-mem");
    else if (cur === "WB")    td.classList.add("stage-wb");
    else if (cur === "STALL") td.classList.add("stage-stall");
    else if (cur === "FLUSH") td.classList.add("stage-flush");
    else if (cur === ".")     td.classList.add("stage-dot");

    entry.cycles.push(cur);
  });

  // auto-scroll para a última coluna
  const container = $("pipeline-diagram-container");
  if (container) container.scrollLeft = container.scrollWidth;
}

// ------------------------------
// UI: estágios, registradores e métricas
// ------------------------------
function updateUI() {
  if (!sim) return;

  // estágios atuais
  setText("stage-if",  sim.IF_ID?.instr?.raw || "nop");
  setText("stage-id",  sim.ID_EX?.instr?.raw || "nop");
  setText("stage-ex",  sim.EX_MEM?.instr?.raw || "nop");
  setText("stage-mem", sim.MEM_WB?.instr?.raw || "nop");
  setText("stage-wb",  sim.lastCommittedInstr ? sim.lastCommittedInstr.raw : (sim.MEM_WB?.instr?.raw || "nop"));

  // registradores
  if (sim.regFile && Array.isArray(sim.regFile.regs)) {
    sim.regFile.regs.forEach((v, i) => setText(`reg-${i}`, String(v)));
  }

  // métricas básicas
  setText("metrics-cycles", String(sim.cycle));
  const CPI = sim.instructionsCommitted > 0 ? (sim.cycle / sim.instructionsCommitted).toFixed(2) : "0";
  setText("metrics-cpi", CPI);
  setText("metrics-stalls", String(sim.stallsData + sim.stallsCache));
  setText("metrics-flushes", String(sim.flushes));
  setText("metrics-branch", `${sim.branchCorrect}/${sim.branchPredictions}`);

  // estatísticas de cache (L1I, L1D, L2, L3)
  const stats = sim.memoryHierarchy?.stats?.() || [];
  const byName = {};
  stats.forEach(s => { byName[s.name] = s; });

  updateCacheMetrics("l1i", byName["L1I"]);
  updateCacheMetrics("l1d", byName["L1D"]);
  updateCacheMetrics("l2",  byName["L2"]);
  updateCacheMetrics("l3",  byName["L3"]);

    // ==================== ATUALIZAÇÃO DA HIERARQUIA DE MEMÓRIA ====================
  if (sim.memoryHierarchy) {
    const levels = sim.memoryHierarchy.stats();
    levels.forEach(lvl => {
      const idPrefix = lvl.name || lvl.level; // compatibilidade L1I/L1D/L2/L3
      const hitsEl = document.getElementById(`${idPrefix}-hits`);
      const missesEl = document.getElementById(`${idPrefix}-misses`);
      const rateEl = document.getElementById(`${idPrefix}-hitRate`);
      if (hitsEl) hitsEl.textContent = lvl.hits ?? 0;
      if (missesEl) missesEl.textContent = lvl.misses ?? 0;
      if (rateEl) rateEl.textContent = ((lvl.hitRate || 0) * 100).toFixed(1) + "%";
    });
  }

}

function updateCacheMetrics(prefix, s) {
  if (!s) {
    setText(`metrics-${prefix}-hit`, "0");
    setText(`metrics-${prefix}-miss`, "0");
    setText(`metrics-${prefix}-hitrate`, "0");
    return;
  }
  setText(`metrics-${prefix}-hit`, String(s.hits));
  setText(`metrics-${prefix}-miss`, String(s.misses));
  setText(`metrics-${prefix}-hitrate`, (s.hitRate * 100).toFixed(1) + "%");
}

// ------------------------------
// Export CSV
// ------------------------------
function buildMetricsCSV(sim) {
  const header = [
    "cycles","instructionsCommitted","CPI","stallsData","stallsCache","flushes",
    "branchPredictions","branchCorrect",
    "L1I_hits","L1I_misses","L1I_hitRate",
    "L1D_hits","L1D_misses","L1D_hitRate",
    "L2_hits","L2_misses","L2_hitRate",
    "L3_hits","L3_misses","L3_hitRate"
  ];

  const CPI = sim.instructionsCommitted ? (sim.cycle / sim.instructionsCommitted) : 0;

  const stats = sim.memoryHierarchy?.stats?.() || [];
  const by = {}; stats.forEach(s => by[s.name] = s);

  function safe(v, f = x => x) { return v != null ? f(v) : 0; }

  const row = [
    sim.cycle,
    sim.instructionsCommitted,
    CPI.toFixed(4),
    sim.stallsData,
    sim.stallsCache,
    sim.flushes,
    sim.branchPredictions,
    sim.branchCorrect,
    safe(by["L1I"]?.hits),  safe(by["L1I"]?.misses),  (safe(by["L1I"]?.hitRate, x=>x*100)).toFixed(2),
    safe(by["L1D"]?.hits),  safe(by["L1D"]?.misses),  (safe(by["L1D"]?.hitRate, x=>x*100)).toFixed(2),
    safe(by["L2"]?.hits),   safe(by["L2"]?.misses),   (safe(by["L2"]?.hitRate,  x=>x*100)).toFixed(2),
    safe(by["L3"]?.hits),   safe(by["L3"]?.misses),   (safe(by["L3"]?.hitRate,  x=>x*100)).toFixed(2)
  ];

  return header.join(";") + "\n" + row.join(";");
}
