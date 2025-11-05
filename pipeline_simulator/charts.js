// charts.js
// Lê múltiplos CSVs (separador ';') e gera gráficos comparativos

const input = document.getElementById("file-input");
const btnLoad = document.getElementById("btn-load-csv");
const btnBack = document.getElementById("btn-back");
btnBack.addEventListener("click", () => window.location.href = "index.html");

function parseCSV(text) {
    // split linhas e separar por ; (considera CRLF)
    const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l !== "");
    if (lines.length < 2) return null;
    // header
    const header = lines[0].split(/;+/).map(h => h.trim());
    // primeira linha de dados (assumimos export único por arquivo)
    const values = lines[1].split(/;+/).map(v => v.trim());
    const obj = {};
    header.forEach((h, i) => {
        obj[h] = isNaN(values[i]) ? values[i] : Number(values[i]);
    });
    return obj;
}

function computeHitRate(hits, misses) {
    const h = Number(hits) || 0;
    const m = Number(misses) || 0;
    const total = h + m;
    if (total === 0) return 100.0;
    return (h / total) * 100.0;
}

async function readFiles(files) {
    const results = [];
    for (let f of files) {
        const text = await f.text();
        const parsed = parseCSV(text);
        if (parsed) {
            // try to determine name from file or header "Benchmark"
            const benchName = parsed.Benchmark || f.name.replace(/\.csv$/i, '');
            parsed._fileName = f.name;
            parsed._benchName = benchName;
            results.push(parsed);
        }
    }
    return results;
}

function buildDatasets(parsedList) {
    // ensure consistent order by filename or benchName
    const labels = parsedList.map(p => p._benchName);
    // CPI
    const cpi = parsedList.map(p => Number(p.CPI) || Number(p.cpi) || 0);
    // stalls total = stallsData + stallsCache (if fields exist)
    const stalls = parsedList.map(p => (Number(p.stallsData) || 0) + (Number(p.stallsCache) || 0));
    const flushes = parsedList.map(p => Number(p.flushes) || 0);
    // branch accuracy: if branchPredictions present
    const branchAcc = parsedList.map(p => {
        if (p.branchPredictions && p.branchPredictions > 0) {
            return (Number(p.branchCorrect) / Number(p.branchPredictions)) * 100.0;
        }
        // maybe file has branchAccuracy field:
        if (p.branchAccuracy) return Number(p.branchAccuracy) * 100;
        return 0;
    });
    // cache hit rates
    const l1i = parsedList.map(p => computeHitRate(p.L1I_hits || p.L1I_h, p.L1I_misses || p.L1I_m));
    const l1d = parsedList.map(p => computeHitRate(p.L1D_hits || p.L1D_h, p.L1D_misses || p.L1D_m));
    return { labels, cpi, stalls, flushes, branchAcc, l1i, l1d };
}

function makeChart(ctx, type, data, options = {}) {
    return new Chart(ctx, {
        type: type,
        data: data,
        options: Object.assign({
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, labels: { color: '#cfd8ff' } },
                title: { display: false }
            },
            scales: {
                x: { ticks: { color: '#cfd8ff' } },
                y: { ticks: { color: '#cfd8ff' } }
            }
        }, options)
    });
}

let chartCPI, chartStalls, chartFlushes, chartCache, chartBranch;

btnLoad.addEventListener("click", async () => {
    const files = input.files;
    if (!files || files.length === 0) return alert("Selecione os CSVs (um por benchmark).");
    const parsed = await readFiles(files);
    if (!parsed.length) return alert("Nenhum CSV válido encontrado.");
    const d = buildDatasets(parsed);

    // destroy previous charts if exist
    if (chartCPI) chartCPI.destroy();
    if (chartStalls) chartStalls.destroy();
    if (chartFlushes) chartFlushes.destroy();
    if (chartCache) chartCache.destroy();
    if (chartBranch) chartBranch.destroy();

    // CPI
    const cpiCtx = document.getElementById("chart-cpi").getContext("2d");
    chartCPI = makeChart(cpiCtx, 'bar', {
        labels: d.labels,
        datasets: [{ label: 'CPI', data: d.cpi, backgroundColor: d.labels.map(() => 'rgba(100,120,255,0.9)'), borderColor: 'rgba(44,62,80,0.9)', borderWidth: 1 }]
    });

    // Stalls
    const stallsCtx = document.getElementById("chart-stalls").getContext("2d");
    chartStalls = makeChart(stallsCtx, 'bar', {
        labels: d.labels,
        datasets: [{ label: 'Stalls (total)', data: d.stalls, backgroundColor: d.labels.map(() => 'rgba(60,90,200,0.85)') }]
    });

    // Flushes
    const flushCtx = document.getElementById("chart-flushes").getContext("2d");
    chartFlushes = makeChart(flushCtx, 'bar', {
        labels: d.labels,
        datasets: [{ label: 'Flushes', data: d.flushes, backgroundColor: d.labels.map(() => 'rgba(80,160,255,0.85)') }]
    });

    // Cache hit rates
    const cacheCtx = document.getElementById("chart-cache").getContext("2d");
    chartCache = makeChart(cacheCtx, 'bar', {
        labels: d.labels,
        datasets: [
            { label: 'L1I (%)', data: d.l1i, backgroundColor: d.labels.map(() => 'rgba(100,120,255,0.9)') },
            { label: 'L1D (%)', data: d.l1d, backgroundColor: d.labels.map(() => 'rgba(64,160,255,0.7)') }
        ]
    }, {
        scales: { y: { min: 0, max: 100 } }
    });

    // Branch accuracy
    const branchCtx = document.getElementById("chart-branch").getContext("2d");
    chartBranch = makeChart(branchCtx, 'bar', {
        labels: d.labels,
        datasets: [{ label: 'Branch Accuracy (%)', data: d.branchAcc, backgroundColor: d.labels.map(() => 'rgba(140,180,255,0.95)') }]
    }, { scales: { y: { min: 0, max: 100 } } });

    // scroll to charts
    document.getElementById("charts").scrollIntoView({ behavior: 'smooth' });
});
