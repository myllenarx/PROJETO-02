let sim = null;
let running = false;
let pipelineHistory = []; // [ { pc: 0, cycles: ["IF", "ID", "EX"] }, ... ]

const benchmarks = {
    alu1: [
        "addi x1, x0, 10", // pc 0
        "addi x2, x0, 0",  // pc 1
        "addi x5, x0, 1",  // pc 2
    "loop:",
        "add x2, x2, x1",  // pc 3
        "sub x1, x1, x5",  // pc 4
        "bne x1, x0, -2",  // pc 5. Pula para pc 3 (5 + -2 = 3)
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
        "bne x1, x0, -1", // pc 3. Pula para pc 2 (3 + -1 = 2)
        "nop"              // pc 4
    ],
    ctrl2: [
        "addi x1, x0, 0",
        "addi x2, x0, 1",
        "beq x1, x2, 2", // Not-Taken (pc 2 -> pc 3)
        "addi x3, x0, 5", // pc 3
        "bne x1, x2, -3", // Taken (pc 4 -> pc 1) (Flush!)
        "nop"              // pc 5
    ]
};

document.getElementById('benchmark-select').addEventListener('change', e => {
    const val = e.target.value;
    if (benchmarks[val]) {
        document.getElementById('program-input').value = benchmarks[val].join("\n");
    }
});

const regsTable = document.getElementById('registers');
for (let i = 0; i < 32; i++) {
    const row = regsTable.insertRow();
    row.insertCell().innerText = 'x' + i;
    row.insertCell().id = 'reg-' + i;
    row.cells[1].innerText = '0';
}

document.getElementById('btn-load').addEventListener('click', () => {
    const programText = document.getElementById('program-input').value.trim();
     const program = programText.split('\n').map(line => line.trim()).filter(line => line !== '' && !line.startsWith('//'));

    const config = {
        predictorMode: "onebit",
        predictorSize: 32,
        L1ISizeWords: 64, L1ILineWords: 4, L1IAssoc: 2, L1IHit: 1, L1IMissPenalty: 8,
        L1DSizeWords: 64, L1DLineWords: 4, L1DAssoc: 2, L1DHit: 1, L1DMissPenalty: 12
    };

    sim = new PipelineSimulator(program, config);

    pipelineHistory = [];
    const diagramBody = document.getElementById('pipeline-diagram-body');
    const diagramHeader = document.getElementById('pipeline-diagram-header');

    diagramBody.innerHTML = "";
    diagramHeader.innerHTML = "<th>Instrução</th>";
    diagramHeader.insertCell().innerText = "C 0";

    sim.program.forEach((instr, index) => {
        if (instr.opcode === 'nop' || instr.raw.includes(':')) return;

        const row = diagramBody.insertRow();
        row.id = `instr-row-${index}`;

        const nameCell = row.insertCell();
        nameCell.innerText = `(${index}) ${instr.raw}`;

        const cycleCell = row.insertCell();
        cycleCell.innerText = " ";
        cycleCell.className = "stage- ";

        pipelineHistory.push({
            pc: index,
            row: row,
            cycles: [" "]
        });
    });

    updateUI();
});

document.getElementById('btn-step').addEventListener('click', () => {
    if (!sim || sim.finished) return;
    sim.tick();
    updateUI();
    updatePipelineDiagram();
});

document.getElementById('btn-run').addEventListener('click', async () => {
    if (!sim) return;
    running = true;
    while(running && !sim.finished && sim.cycle < 500) {
        sim.tick();
        updateUI();
        updatePipelineDiagram();
        await new Promise(r => setTimeout(r, 100));
    }
    running = false;
    if (sim.cycle >= 500) {
         alert("Limite de 500 ciclos atingido. Interrompendo.");
    }
});

document.getElementById('btn-reset').addEventListener('click', () => {
    running = false;
    sim = null;

    document.querySelectorAll('#pipeline td').forEach(td => td.innerText = '-');
    for (let i = 0; i < 32; i++) document.getElementById('reg-' + i).innerText = '0';
    document.querySelectorAll('#metrics td').forEach(td => td.innerText = '0');

    document.getElementById('pipeline-diagram-body').innerHTML = "";
    document.getElementById('pipeline-diagram-header').innerHTML = "<th>Instrução</th>";
    pipelineHistory = [];
});

document.getElementById('btn-export').addEventListener('click', () => {
    if (!sim) { alert("Nenhuma simulação carregada!"); return; }
    sim.exportMetricsCSV();
    alert("Arquivo CSV exportado com sucesso!");
});


// =============================================
// === FUNÇÃO updatePipelineDiagram CORRIGIDA ===
// =============================================
function updatePipelineDiagram() {
    if (!sim) return;
    const cycle = sim.cycle;

    document.getElementById('pipeline-diagram-header').insertCell().innerText = `C ${cycle}`;

    const stageMap = new Map();
    if (!sim.isNOP(sim.IF_ID.instr)) stageMap.set(sim.IF_ID.instr.pc, "IF");
    if (!sim.isNOP(sim.ID_EX.instr)) stageMap.set(sim.ID_EX.instr.pc, "ID");
    if (!sim.isNOP(sim.EX_MEM.instr)) stageMap.set(sim.EX_MEM.instr.pc, "EX");
    if (!sim.isNOP(sim.MEM_WB.instr)) stageMap.set(sim.MEM_WB.instr.pc, "MEM");
    if (!sim.isNOP(sim.lastCommittedInstr)) stageMap.set(sim.lastCommittedInstr.pc, "WB");

    pipelineHistory.forEach(hist => {
        const pc = hist.pc;
        const lastCycleStage = hist.cycles[hist.cycles.length - 1];
        let currentStage = " "; // Default

        // ***** LÓGICA REORDENADA *****
        // 1. PRIORIDADE MÁXIMA: Se já terminou ou foi flushada, continua assim.
        if (lastCycleStage === "WB" || lastCycleStage === "." || lastCycleStage === "FLUSH") {
            currentStage = (lastCycleStage === "FLUSH") ? "FLUSH" : ".";
        }
        // 2. Se não terminou, verifica se está ATIVA em algum estágio neste ciclo.
        else if (stageMap.has(pc)) {
            currentStage = stageMap.get(pc);
        }
        // 3. Se não está ativa e não terminou, verifica se é um STALL ou FLUSH.
        else if (sim.flushedPCs.includes(pc)) {
             // Foi flushada NESTE ciclo (não estava no mapa, mas está na lista de flush)
            currentStage = "FLUSH";
        } else if (sim.injectedStall && lastCycleStage === "ID") {
             // Estava em ID, bolha foi injetada -> STALL visual em EX
            currentStage = "STALL";
        } else if (sim.isCacheStall && lastCycleStage !== " ") {
             // Stall de Cache ou Load-Use em IF -> repete último estágio ativo (IF/ID/EX/MEM)
            currentStage = lastCycleStage;
        }
        // Se nenhuma das condições acima for atendida, continua como " " (vazio).

        const cell = hist.row.insertCell();
        cell.innerText = currentStage;
        // Usa 'dot' como classe CSS para o caractere '.'
        cell.className = `stage-${currentStage.toLowerCase().replace('.', 'dot')}`;

        hist.cycles.push(currentStage);
    });

    const container = document.getElementById('pipeline-diagram-container');
    container.scrollLeft = container.scrollWidth;
}

function updateUI() {
    if (!sim) return;

    document.getElementById('stage-if').innerText = sim.IF_ID.instr.raw || 'nop';
    document.getElementById('stage-id').innerText = sim.ID_EX.instr.raw || 'nop';
    document.getElementById('stage-ex').innerText = sim.EX_MEM.instr.raw || 'nop';
    document.getElementById('stage-mem').innerText = sim.MEM_WB.instr.raw || 'nop';
    // A tabela de estado atual mostra o que acabou de SAIR do WB, ou o que está no reg MEM_WB se nada saiu
    document.getElementById('stage-wb').innerText = sim.lastCommittedInstr ? sim.lastCommittedInstr.raw : (sim.MEM_WB.instr.raw || 'nop');


    sim.regFile.regs.forEach((val, i) => {
        document.getElementById('reg-' + i).innerText = val;
    });

    document.getElementById('metrics-cycles').innerText = sim.cycle;
    const CPI = sim.instructionsCommitted > 0 ? (sim.cycle / sim.instructionsCommitted).toFixed(2) : 0;
    document.getElementById('metrics-cpi').innerText = CPI;
    document.getElementById('metrics-stalls').innerText = sim.stallsData + sim.stallsCache;
    document.getElementById('metrics-flushes').innerText = sim.flushes;
    document.getElementById('metrics-branch').innerText = sim.branchPredictions ? `${sim.branchCorrect}/${sim.predictions}` : "0/0";

    const kiloInstructions = sim.instructionsCommitted / 1000;

    const statsI = sim.cacheI.stats();
    const missRateI = 1.0 - statsI.hitRate;
    const amat_i = sim.cacheI.hitTime + (missRateI * sim.cacheI.missPenalty);
    const mpki_i = kiloInstructions > 0 ? (sim.cacheI.misses / kiloInstructions).toFixed(2) : 0;

    document.getElementById('metrics-ci').innerText = (statsI.hitRate * 100).toFixed(1);
    document.getElementById('metrics-mpki-i').innerText = mpki_i;
    document.getElementById('metrics-amat-i').innerText = amat_i.toFixed(2);

    const statsD = sim.cacheD.stats();
    const missRateD = 1.0 - statsD.hitRate;
    const amat_d = sim.cacheD.hitTime + (missRateD * sim.cacheD.missPenalty);
    const mpki_d = kiloInstructions > 0 ? (sim.cacheD.misses / kiloInstructions).toFixed(2) : "0";

    document.getElementById('metrics-cd').innerText = (statsD.hitRate * 100).toFixed(1);
    document.getElementById('metrics-mpki-d').innerText = mpki_d;
    document.getElementById('metrics-amat-d').innerText = amat_d.toFixed(2);
}
