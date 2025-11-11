// charts.js – robusto e corrigido
const input = document.getElementById("file-input");
const btnLoad = document.getElementById("btn-load-csv");
const btnBack = document.getElementById("btn-back");

if (btnBack) {
  btnBack.addEventListener("click", () => window.location.href = "index.html");
}

// CORRIGIDO: Função mais robusta para aguardar Chart.js com retry
function waitForChart() {
  return new Promise((resolve, reject) => {
    if (typeof Chart !== 'undefined') {
      resolve();
      return;
    }
    
    let attempts = 0;
    const maxAttempts = 100; // 10 segundos
    const interval = setInterval(() => {
      attempts++;
      if (typeof Chart !== 'undefined') {
        clearInterval(interval);
        console.log("✅ Chart.js carregado com sucesso");
        resolve();
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        reject(new Error('Chart.js não foi carregado após 10 segundos'));
      }
    }, 100);
  });
}

function splitRow(row) {
  // Detecta delimitador de forma mais robusta
  const testRow = row.replace(/"[^"]*"/g, ''); // Remove campos entre aspas
  const semiCount = (testRow.match(/;/g) || []).length;
  const commaCount = (testRow.match(/,/g) || []).length;
  
  const delimiter = semiCount > commaCount ? ";" : ",";
  
  // Split considerando campos entre aspas
  const regex = new RegExp(`${delimiter}(?=(?:[^"]*"[^"]*")*[^"]*$)`);
  return row.split(regex).map(s => s.trim().replace(/^"|"$/g, ''));
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l !== "");
  
  if (lines.length < 2) {
    console.warn("CSV vazio ou inválido");
    return [];
  }
  
  const header = splitRow(lines[0]);
  const out = [];
  
  for (let li = 1; li < lines.length; li++) {
    const values = splitRow(lines[li]);
    
    // Aceita linhas com menos colunas, preenchendo com valores padrão
    const obj = {};
    header.forEach((h, i) => {
      const val = values[i] || "";
      const num = parseFloat(val);
      
      // Converte para número apenas se for um número válido
      obj[h] = (!isNaN(num) && val !== "" && isFinite(num)) ? num : val;
    });
    out.push(obj);
  }
  
  return out;
}

function computeHitRate(h, m) {
  const hits = parseFloat(h);
  const misses = parseFloat(m);
  
  // Validação explícita
  if (!isFinite(hits) || !isFinite(misses) || hits < 0 || misses < 0) {
    return 0;
  }
  
  const total = hits + misses;
  return total > 0 ? (hits / total) * 100 : 0;
}

async function readFiles(files) {
  const results = [];
  
  for (let f of files) {
    try {
      const text = await f.text();
      const parsedRows = parseCSV(text);
      
      if (parsedRows.length === 0) {
        console.warn(`Arquivo ${f.name} não contém dados válidos`);
        continue;
      }
      
      for (const obj of parsedRows) {
        obj._benchName = obj.Benchmark || f.name.replace(/\.csv$/i, "");
        results.push(obj);
      }
    } catch (e) {
      console.error(`Erro ao ler arquivo ${f.name}:`, e);
      alert(`Erro ao processar ${f.name}: ${e.message}`);
    }
  }
  
  return results;
}

function buildDatasets(data) {
  const labels = data.map(p => p._benchName || "Unknown");
  
  // CPI com validação
  const cpi = data.map(p => {
    const val = parseFloat(p.CPI);
    return (isFinite(val) && val >= 0) ? val : 0;
  });
  
  // Stalls com validação
  const stalls = data.map(p => {
    const dataStalls = parseFloat(p.stallsData) || 0;
    const cacheStalls = parseFloat(p.stallsCache) || 0;
    return (isFinite(dataStalls) ? dataStalls : 0) + (isFinite(cacheStalls) ? cacheStalls : 0);
  });
  
  // Flushes com validação
  const flushes = data.map(p => {
    const val = parseFloat(p.flushes);
    return (isFinite(val) && val >= 0) ? val : 0;
  });

  // Branch accuracy com múltiplas fontes
  const branchAcc = data.map(p => {
    const predictions = parseFloat(p.branchPredictions) || 0;
    const correct = parseFloat(p.branchCorrect) || 0;
    
    if (predictions > 0 && isFinite(correct)) {
      return Math.min(100, (correct / predictions) * 100);
    }
    
    const acc = parseFloat(p.branchAccuracy);
    if (isFinite(acc)) {
      return acc <= 1 ? acc * 100 : Math.min(100, acc);
    }
    
    return 0;
  });

  // Cache hit rates
  const l1i = data.map(p => computeHitRate(p.L1I_hits, p.L1I_misses));
  const l1d = data.map(p => computeHitRate(p.L1D_hits, p.L1D_misses));
  const l2 = data.map(p => computeHitRate(p.L2_hits, p.L2_misses));
  const l3 = data.map(p => computeHitRate(p.L3_hits, p.L3_misses));

  return { labels, cpi, stalls, flushes, branchAcc, l1i, l1d, l2, l3 };
}

// CORRIGIDO: Função mais robusta para criar gráficos
function makeChart(id, datasetKey, label, options = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) {
    console.warn(`Elemento canvas com id '${id}' não encontrado`);
    return null;
  }
  
  const canvas = ctx.getContext("2d");
  if (!canvas) {
    console.warn(`Contexto 2D não disponível para canvas '${id}'`);
    return null;
  }
  
  const d = window.__DATASETS__;
  if (!d || !d[datasetKey]) {
    console.warn(`Dataset '${datasetKey}' não encontrado`);
    return null;
  }

  // Validação adicional dos dados
  if (!Array.isArray(d[datasetKey]) || d[datasetKey].length === 0) {
    console.warn(`Dataset '${datasetKey}' está vazio`);
    return null;
  }

  // Configuração padrão melhorada
  const defaultOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { 
      legend: { 
        display: false,
        labels: { color: "#cfd8ff" }
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 36, 0.95)',
        titleColor: '#fff',
        bodyColor: '#cfd8ff',
        borderColor: 'rgba(100, 120, 255, 0.5)',
        borderWidth: 1
      }
    },
    scales: {
      x: { 
        ticks: { color: "#cfd8ff" },
        grid: { color: 'rgba(255, 255, 255, 0.05)' }
      },
      y: { 
        ticks: { color: "#cfd8ff" },
        grid: { color: 'rgba(255, 255, 255, 0.08)' },
        beginAtZero: true,
        max: label.includes("%") ? 100 : undefined
      }
    }
  };

  try {
    return new Chart(canvas, {
      type: "bar",
      data: {
        labels: d.labels,
        datasets: [{
          label,
          data: d[datasetKey],
          borderColor: "rgba(255,255,255,0.2)",
          backgroundColor: "rgba(100,120,255,0.85)",
          borderWidth: 1,
          borderRadius: 4,
        }]
      },
      options: Object.assign({}, defaultOptions, options)
    });
  } catch (error) {
    console.error(`Erro ao criar gráfico ${id}:`, error);
    return null;
  }
}

let charts = [];

if (btnLoad) {
  btnLoad.addEventListener("click", async () => {
    try {
      // Verifica se arquivos foram selecionados
      const files = input.files;
      if (!files || !files.length) {
        alert("⚠️ Selecione ao menos um arquivo CSV exportado do simulador.");
        return;
      }

      // CORRIGIDO: Aguarda Chart.js estar disponível com tratamento de erro
      try {
        await waitForChart();
      } catch (e) {
        alert("❌ Erro ao carregar biblioteca de gráficos. Recarregue a página e tente novamente.");
        console.error("Erro ao carregar Chart.js:", e);
        return;
      }

      // Lê e processa arquivos
      const parsed = await readFiles(files);
      if (!parsed.length) {
        alert("❌ Nenhum arquivo CSV válido encontrado.");
        return;
      }

      // Constrói datasets
      window.__DATASETS__ = buildDatasets(parsed);

      // Destroi gráficos anteriores de forma segura
      charts.forEach(c => {
        if (c && typeof c.destroy === 'function') {
          try {
            c.destroy();
          } catch (e) {
            console.warn("Erro ao destruir gráfico:", e);
          }
        }
      });
      charts = [];

      // Cria novos gráficos com validação
      const cpiChart = makeChart("chart-cpi", "cpi", "CPI");
      if (cpiChart) charts.push(cpiChart);

      const stallsChart = makeChart("chart-stalls", "stalls", "Stalls");
      if (stallsChart) charts.push(stallsChart);

      const flushesChart = makeChart("chart-flushes", "flushes", "Flushes");
      if (flushesChart) charts.push(flushesChart);

      // Gráfico de cache com múltiplas barras
      const cacheCtx = document.getElementById("chart-cache");
      if (cacheCtx && window.__DATASETS__) {
        try {
          const cacheCanvas = cacheCtx.getContext("2d");
          if (cacheCanvas) {
            const cacheChart = new Chart(cacheCanvas, {
              type: "bar",
              data: {
                labels: window.__DATASETS__.labels,
                datasets: [
                  { 
                    label: "L1I (%)", 
                    data: window.__DATASETS__.l1i, 
                    backgroundColor: "rgba(100,120,255,0.85)",
                    borderRadius: 4
                  },
                  { 
                    label: "L1D (%)", 
                    data: window.__DATASETS__.l1d, 
                    backgroundColor: "rgba(64,160,255,0.75)",
                    borderRadius: 4
                  }
                ]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                  legend: { 
                    labels: { color: "#cfd8ff" },
                    display: true
                  }
                },
                scales: {
                  y: { 
                    beginAtZero: true, 
                    max: 100, 
                    ticks: { color: "#cfd8ff" },
                    grid: { color: 'rgba(255, 255, 255, 0.08)' }
                  },
                  x: { 
                    ticks: { color: "#cfd8ff" },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                  }
                }
              }
            });
            charts.push(cacheChart);
          }
        } catch (error) {
          console.error("Erro ao criar gráfico de cache:", error);
        }
      }

      const branchChart = makeChart("chart-branch", "branchAcc", "Precisão do Preditor (%)");
      if (branchChart) charts.push(branchChart);

      // CORRIGIDO: Validação antes de scroll
      const chartsContainer = document.getElementById("charts");
      if (chartsContainer) {
        setTimeout(() => {
          try {
            chartsContainer.scrollIntoView({ behavior: "smooth", block: "start" });
          } catch (e) {
            console.warn("Erro ao fazer scroll:", e);
          }
        }, 100);
      }

      // Feedback ao usuário
      if (charts.length > 0) {
        console.log(`✅ ${charts.length} gráficos gerados com sucesso!`);
        alert(`✅ ${charts.length} gráficos gerados com sucesso!`);
      } else {
        console.warn("⚠️ Nenhum gráfico foi gerado");
        alert("⚠️ Houve um problema ao gerar os gráficos. Verifique o console.");
      }
      
    } catch (error) {
      console.error("Erro crítico ao gerar gráficos:", error);
      alert(`❌ Erro ao gerar gráficos: ${error.message}\n\nVerifique o console para mais detalhes.`);
    }
  });
}

// CORRIGIDO: Inicialização com verificação
document.addEventListener('DOMContentLoaded', () => {
  console.log("📊 Módulo de gráficos carregado");
  
  // Verifica se todos os elementos necessários existem
  const requiredElements = ['file-input', 'btn-load-csv', 'btn-back'];
  const missingElements = requiredElements.filter(id => !document.getElementById(id));
  
  if (missingElements.length > 0) {
    console.warn(`⚠️ Elementos ausentes: ${missingElements.join(', ')}`);
  }
});