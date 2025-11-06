// charts.js — versão estável e visual aprimorada

const input = document.getElementById("file-input");
const btnLoad = document.getElementById("btn-load-csv");
const btnBack = document.getElementById("btn-back");
btnBack.addEventListener("click", () => window.location.href = "index.html");

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l !== "");
    if (lines.length < 2) return null;
    const header = lines[0].split(/;+/).map(h => h.trim());
    const values = lines[1].split(/;+/).map(v => v.trim());
    const obj = {};
    header.forEach((h, i) => {
        obj[h] = isNaN(values[i]) ? values[i] : Number(values[i]);
    });
    return obj;
}

function computeHitRate(h, m) {
    const hits = Number(h) || 0;
    const misses = Number(m) || 0;
    const total = hits + misses;
    return total > 0 ? (hits / total) * 100 : 100;
}

async function readFiles(files) {
    const results = [];
    for (let f of files) {
        const text = await f.text();
        const parsed = parseCSV(text);
        if (parsed) {
            parsed._benchName = parsed.Benchmark || f.name.replace(/\.csv$/i, "");
            results.push(parsed);
        }
    }
    return results;
}

function buildDatasets(data) {
    const labels = data.map(p => p._benchName);
    const cpi = data.map(p => p.CPI || 0);
    const stalls = data.map(p => (p.stallsData || 0) + (p.stallsCache || 0));
    const flushes = data.map(p => p.flushes || 0);
    const branchAcc = data.map(p =>
        p.branchPredictions
            ? (p.branchCorrect / p.branchPredictions) * 100
            : (p.branchAccuracy || 0) * 100
    );
    const l1i = data.map(p => computeHitRate(p.L1I_hits, p.L1I_misses));
    const l1d = data.map(p => computeHitRate(p.L1D_hits, p.L1D_misses));
    return { labels, cpi, stalls, flushes, branchAcc, l1i, l1d };
}

function makeChart(id, label, data, color, options = {}) {
    const ctx = document.getElementById(id).getContext("2d");
    return new Chart(ctx, {
        type: "bar",
        data: {
            labels: data.labels,
            datasets: [
                {
                    label,
                    data: data[label.toLowerCase()],
                    backgroundColor: color,
                    borderColor: "rgba(255,255,255,0.2)",
                    borderWidth: 1,
                },
            ],
        },
        options: Object.assign(
            {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                },
                scales: {
                    x: { ticks: { color: "#cfd8ff" } },
                    y: {
                        ticks: { color: "#cfd8ff" },
                        beginAtZero: true,
                        max: label.includes("%") ? 100 : undefined,
                    },
                },
            },
            options
        ),
    });
}

let charts = [];

btnLoad.addEventListener("click", async () => {
    const files = input.files;
    if (!files.length) return alert("Selecione ao menos um CSV exportado do simulador.");
    const parsed = await readFiles(files);
    if (!parsed.length) return alert("Nenhum arquivo CSV válido encontrado.");

    const d = buildDatasets(parsed);
    charts.forEach(c => c.destroy());
    charts = [];

    charts.push(makeChart("chart-cpi", "CPI", d, "rgba(100,120,255,0.9)"));
    charts.push(makeChart("chart-stalls", "Stalls", d, "rgba(60,90,200,0.85)"));
    charts.push(makeChart("chart-flushes", "Flushes", d, "rgba(80,160,255,0.85)"));

    const cacheCtx = document.getElementById("chart-cache").getContext("2d");
    charts.push(
        new Chart(cacheCtx, {
            type: "bar",
            data: {
                labels: d.labels,
                datasets: [
                    { label: "L1I (%)", data: d.l1i, backgroundColor: "rgba(100,120,255,0.9)" },
                    { label: "L1D (%)", data: d.l1d, backgroundColor: "rgba(64,160,255,0.7)" },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: "#cfd8ff" } } },
                scales: {
                    y: { beginAtZero: true, max: 100, ticks: { color: "#cfd8ff" } },
                    x: { ticks: { color: "#cfd8ff" } },
                },
            },
        })
    );

    charts.push(makeChart("chart-branch", "BranchAcc", d, "rgba(140,180,255,0.95)"));

    document.getElementById("charts").scrollIntoView({ behavior: "smooth" });
});
