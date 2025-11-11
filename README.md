# 🚀 Projeto 02: Simulador de Pipeline RISC-V com Hierarquia de Memória

**Disciplina:** Arquitetura de Computadores II  
**Professor:** Maurício Rodrigues Lima

**Integrantes:**
* Arthur Cardoso
* Henrique de Sousa Paixão
* Lais Vitoria
* Myllena Rodrigues Oliveira
* Samara Solis Sanches
* Maria Rita Verissimo

---

## 📋 Índice

1. [Objetivo do Projeto](#-1-objetivo-do-projeto)
2. [Funcionalidades Implementadas](#%EF%B8%8F-2-funcionalidades-implementadas)
3. [Arquitetura do Sistema](#-3-arquitetura-do-sistema)
4. [Interface Gráfica](#%EF%B8%8F-4-interface-gráfica-e-interatividade)
5. [Métricas de Desempenho](#-5-métricas-e-análise-de-desempenho)
6. [Hierarquia de Memória](#-6-hierarquia-de-memória)
7. [Como Usar](#-7-como-usar)
8. [Tecnologias](#%EF%B8%8F-8-tecnologias-utilizadas)
9. [Benchmarks](#-9-benchmarks-incluídos)

---

## 🎯 1. Objetivo do Projeto

O objetivo deste projeto foi construir um **simulador ciclo-a-ciclo** de um pipeline de 5 estágios (IF, ID, EX, MEM, WB) com uma hierarquia completa de memória integrada.

Para atender a este requisito, desenvolvemos um **simulador interativo e educacional de pipeline RISC-V**, implementado em JavaScript puro, HTML5 e CSS3. A ferramenta permite:

- ✅ Visualizar o funcionamento ciclo a ciclo do processador
- ✅ Observar o tratamento de hazards em tempo real
- ✅ Acompanhar forwarding e resolução de dependências
- ✅ Analisar predição de desvios com feedback visual
- ✅ Estudar o impacto da hierarquia de cache (4 níveis)
- ✅ Exportar métricas detalhadas para análise comparativa

---

## ⚙️ 2. Funcionalidades Implementadas

### 2.1 Pipeline de 5 Estágios (RV32I)

O simulador implementa completamente os 5 estágios do pipeline RISC-V:

| Estágio | Nome | Função | Cor Visual |
|---------|------|--------|------------|
| **IF** | Instruction Fetch | Busca instrução da memória (L1I) | 🔵 Azul |
| **ID** | Instruction Decode | Decodifica e lê registradores | 🟢 Verde |
| **EX** | Execute | Executa operação na ALU | 🟡 Amarelo |
| **MEM** | Memory Access | Acessa memória de dados (L1D) | 🔴 Vermelho |
| **WB** | Write Back | Escreve resultado em registrador | 🟣 Roxo |

**Instruções Suportadas:**
- **ALU:** `add`, `sub`, `and`, `or`, `xor`, `slt`, `addi`
- **Memória:** `lw`, `sw`
- **Controle:** `beq`, `bne`, `jal`, `jalr`
- **Outros:** `nop`

### 2.2 Tratamento de Hazards de Dados

#### Forwarding (Data Bypassing)
- ✅ **EX/MEM → EX:** Forwarding do resultado da ALU
- ✅ **MEM/WB → EX:** Forwarding de dados da memória ou ALU
- ✅ **Priorização correta:** EX/MEM tem prioridade sobre MEM/WB
- ✅ **Verificação de escrita:** Apenas instruções que escrevem em registrador fazem forwarding

#### Stalls Obrigatórios
- ✅ **Load-Use Hazard:** Stall de 1 ciclo quando `lw` é seguido imediatamente por uso do registrador carregado
- ✅ **Detecção em ID:** Hazards detectados no estágio de decodificação
- ✅ **Inserção de bolhas:** NOPs automáticos inseridos no pipeline

### 2.3 Tratamento de Hazards de Controle

#### Preditor de Desvios
- ✅ **Tipo:** Preditor dinâmico de 1-bit
- ✅ **Tamanho:** 32 entradas (configurável)
- ✅ **Indexação:** Por endereço PC
- ✅ **Política:** Atualização após resolução no estágio EX

#### Flush de Pipeline
- ✅ **Detecção de misprediction** no estágio EX
- ✅ **Flush completo:** Descarta IF, ID e EX/MEM
- ✅ **Correção de PC:** Atualiza para endereço correto
- ✅ **Sincronização:** Flag de controle evita corrupção de estado

### 2.4 Conformidade RISC-V

- ✅ **JALR:** Zera o bit menos significativo do endereço alvo (conforme spec)
- ✅ **Overflow:** Simula corretamente aritmética de 32 bits
- ✅ **x0 = 0:** Registrador zero sempre retorna 0
- ✅ **Validação:** Registradores limitados a [0, 31]

---

## 🏗️ 3. Arquitetura do Sistema

### 3.1 Estrutura de Arquivos

```
simulador-pipeline/
├── index.html           # Interface principal do simulador
├── graficos.html        # Página de visualização de gráficos
├── style.css            # Estilos e tema visual
├── cache.js             # Implementação da hierarquia de memória
├── pipeline.js          # Lógica do pipeline e hazards
├── main.js              # Controlador da UI e eventos
├── charts.js            # Geração de gráficos comparativos
└── docs/
    ├── RELATORIO_CORRECOES.md
    ├── MELHORIAS_VISUAIS.md
    ├── GUIA_VISUAL.html
    ├── ROTEIRO_APRESENTACAO.md
    ├── CARTOES_REFERENCIA.md
    └── RESUMO_EXECUTIVO.md
```

### 3.2 Módulos Principais

#### `pipeline.js` - Núcleo do Simulador
- Classe `PipelineSimulator`: Gerencia estado do pipeline
- Função `parseInstruction()`: Parser de assembly RISC-V
- Classe `RegisterFile`: Banco de 32 registradores
- Classe `OneBitPredictor`: Preditor de desvios
- Métodos `doIF()`, `doID()`, `doEX()`, `doMEM()`, `doWB()`: Lógica de cada estágio

#### `cache.js` - Hierarquia de Memória
- Classe `AssociativeCache`: Cache associativa genérica
- Classe `MainMemory`: Memória DRAM simulada
- Classe `MemoryHierarchy`: Coordena os 4 níveis de cache
- Implementa: LRU, Write-Back, Write-Allocate, busca de linha completa

#### `main.js` - Interface e Controle
- Gerenciamento de eventos de botões
- Atualização de visualizações em tempo real
- Exportação de métricas para CSV
- Sistema de cores do diagrama de pipeline

#### `charts.js` - Análise Comparativa
- Leitura e parsing de arquivos CSV
- Geração de gráficos com Chart.js
- Comparação de múltiplos benchmarks
- Visualizações: CPI, stalls, flushes, cache hit rates, branch accuracy

---

## 🖥️ 4. Interface Gráfica e Interatividade

### 4.1 Painel de Controle

**Editor de Código:**
- Caixa de texto para código assembly RISC-V
- Syntax highlighting básico
- Seletor de benchmarks pré-configurados

**Botões de Controle:**
- 🔄 **Carregar Programa:** Compila e carrega o código
- ⏭️ **Próximo Ciclo:** Executa um ciclo (debug)
- ▶️ **Executar Tudo:** Roda até completar (com animação)
- 🔁 **Resetar:** Limpa tudo e recomeça
- 💾 **Exportar CSV:** Salva métricas em arquivo

### 4.2 Visualizações em Tempo Real

#### Tabela do Pipeline
Mostra o conteúdo de cada estágio a cada ciclo:
```
| IF    | ID    | EX    | MEM   | WB    |
|-------|-------|-------|-------|-------|
| addi  | add   | lw    | nop   | nop   |
```

#### Banco de Registradores
Exibe os 32 registradores RISC-V (x0-x31) com valores atualizados em tempo real:
```
x0  = 0          x8  = 0          x16 = 0          x24 = 0
x1  = 5          x9  = 0          x17 = 0          x25 = 0
x2  = 10         x10 = 0          x18 = 0          x26 = 0
...
```

#### Diagrama de Pipeline Colorido 🎨

**Características:**
- ✅ **Cores por estágio:** Cada estágio tem cor única (IF=azul, ID=verde, EX=amarelo, MEM=vermelho, WB=roxo)
- ✅ **Coluna fixa:** Instruções permanecem visíveis ao rolar horizontalmente
- ✅ **Legenda integrada:** Mostra o significado de cada cor
- ✅ **Identificação visual:**
  - Stalls aparecem como células vazias
  - Flushes são visíveis quando cores desaparecem
  - Forwarding bem-sucedido mostra fluxo contínuo

**Exemplo Visual:**
```
Instrução        | C1 | C2 | C3 | C4 | C5 |
-----------------|----|----|----|----|----|
addi x1, x0, 1   | IF | ID | EX |MEM | WB |
addi x2, x0, 2   |    | IF | ID | EX |MEM |
add x3, x1, x2   |    |    | IF | ID | EX |
```

#### Painel de Métricas
```
┌─────────────────────────────────────────────────┐
│ Ciclos: 25    CPI: 1.25    Stalls: 5           │
│ Flushes: 2    Branch: 8/10    CacheI: 95%     │
└─────────────────────────────────────────────────┘
```

#### Estatísticas de Cache
```
┌────────┬───────┬─────────┬────────────┐
│ Cache  │ Hits  │ Misses  │ Hit Rate % │
├────────┼───────┼─────────┼────────────┤
│ L1I    │  250  │   10    │   96.15    │
│ L1D    │  180  │   45    │   80.00    │
│ L2     │   35  │   20    │   63.64    │
│ L3     │   15  │    5    │   75.00    │
└────────┴───────┴─────────┴────────────┘
```

---

## 📊 5. Métricas e Análise de Desempenho

### 5.1 Métricas Coletadas

O simulador coleta automaticamente as seguintes métricas:

#### Performance Geral
- **Ciclos Totais:** Número total de ciclos de clock executados
- **Instruções Committed:** Instruções que completaram execução (WB)
- **CPI (Cycles Per Instruction):** `ciclos / instruções`
  - Ideal: CPI = 1.0 (uma instrução por ciclo)
  - Típico: CPI = 1.2 - 1.6 (código realista)

#### Stalls
- **Stalls de Dados:** Causados por hazards RAW não resolvidos por forwarding
- **Stalls de Cache:** Latência acumulada de cache misses
- **Distribuição:** Separação por categoria para identificar gargalos

#### Preditor de Branch
- **Total de Predições:** Quantos branches/jumps foram executados
- **Acertos:** Predições corretas
- **Flushes:** Predições incorretas que causaram flush
- **Taxa de Acerto:** `(acertos / total) × 100%`

#### Cache (por nível)
- **Acessos:** Total de requisições
- **Hits:** Acessos bem-sucedidos
- **Misses:** Acessos que falharam
- **Taxa de Acerto:** `(hits / acessos) × 100%`
- **Taxa de Miss:** `(misses / acessos) × 100%`

### 5.2 Exportação de Dados

**Formato CSV:**
```csv
Benchmark;cycles;instructionsCommitted;CPI;stallsData;stallsCache;flushes;branchPredictions;branchCorrect;branchAccuracy;L1I_hits;L1I_misses;L1D_hits;L1D_misses;L2_hits;L2_misses;L3_hits;L3_misses
ALU_1;25;20;1.25;0;5;0;0;0;0;20;0;0;0;0;0;0;0
```

**Uso:**
1. Execute o benchmark desejado
2. Clique em "Exportar CSV"
3. Arquivo `.csv` é baixado automaticamente
4. Carregue múltiplos CSVs em `graficos.html` para comparação

### 5.3 Gráficos Comparativos

A página `graficos.html` permite visualização comparativa:

- **Gráfico de CPI:** Compare eficiência entre benchmarks
- **Gráfico de Stalls:** Veja distribuição entre dados e cache
- **Gráfico de Flushes:** Identifique programas com branches problemáticos
- **Gráfico de Cache:** Compare L1I vs L1D side-by-side
- **Gráfico de Branch:** Avalie precisão do preditor

---

## 🗄️ 6. Hierarquia de Memória

### 6.1 Arquitetura de 4 Níveis

```
        CPU
         ↓
    ┌────────┬────────┐
    │  L1I   │  L1D   │  ← Caches separadas (Harvard)
    └────┬───┴───┬────┘
         │       │
         └───┬───┘
             ↓
          ┌──────┐
          │  L2  │        ← Cache unificada
          └──┬───┘
             ↓
          ┌──────┐
          │  L3  │        ← Cache unificada
          └──┬───┘
             ↓
          ┌──────┐
          │ DRAM │        ← Memória principal
          └──────┘
```

### 6.2 Especificações Técnicas

| Nível | Tipo | Tamanho | Associatividade | Linha | Hit Time | Miss Penalty | Política |
|-------|------|---------|-----------------|-------|----------|--------------|----------|
| **L1I** | Instrução | 64 palavras | 2-way | 4 palavras | 1 ciclo | 2 ciclos | WT |
| **L1D** | Dados | 64 palavras | 2-way | 4 palavras | 1 ciclo | 2 ciclos | WB/WA |
| **L2** | Unificada | 256 palavras | 4-way | 4 palavras | 2 ciclos | 5 ciclos | WB/WA |
| **L3** | Unificada | 512 palavras | 8-way | 8 palavras | 8 ciclos | 10 ciclos | WB/WA |
| **DRAM** | Principal | Ilimitada | - | - | 50 ciclos | - | - |

**Legenda:**
- **WT:** Write-Through
- **WB:** Write-Back
- **WA:** Write-Allocate

### 6.3 Implementação

#### Decodificação de Endereços
```
Endereço de 32 bits:
┌──────────────┬──────────┬─────────┐
│     Tag      │  Index   │ Offset  │
└──────────────┴──────────┴─────────┘
     bits          bits       bits
  superiores     médios   inferiores
```

Para L1 (64 palavras, 2-way, linhas de 4 palavras):
- **Offset:** 2 bits (4 palavras)
- **Index:** 4 bits (16 conjuntos)
- **Tag:** 26 bits (restante)

#### Política LRU
- Contador global incrementado a cada acesso
- Cada linha tem timestamp `lastAccess`
- Eviction: escolhe linha com menor `lastAccess`
- Preciso e eficiente (sem colisões de timestamp)

#### Write-Back
- Escritas apenas atualizam a cache
- Linha marcada como `dirty`
- Writeback para nível inferior apenas na eviction
- Reduz drasticamente tráfego de memória

#### Busca de Linha Completa
```javascript
// Ao buscar endereço X em miss:
1. Calcula endereço base da linha
2. Busca linha completa do próximo nível
3. Contabiliza latência apenas do primeiro acesso
4. Armazena linha completa no conjunto
```

---

## 📖 7. Como Usar

### 7.1 Execução Local

1. **Clone ou baixe os arquivos**
   ```bash
   # Estrutura necessária:
   simulador/
   ├── index.html
   ├── graficos.html
   ├── *.js
   └── *.css
   ```

2. **Abra no navegador**
   - Opção 1: Duplo-clique em `index.html`
   - Opção 2: Use Live Server (VS Code)
   - Opção 3: Servidor HTTP local (`python -m http.server`)

3. **Requisitos**
   - Navegador moderno (Chrome, Firefox, Safari, Edge)
   - JavaScript habilitado
   - Conexão à internet (apenas para Chart.js)

### 7.2 Tutorial Passo a Passo

#### Usando Benchmarks Pré-configurados

1. No seletor dropdown, escolha um benchmark (ex: "ALU 1")
2. O código assembly aparece automaticamente no editor
3. Clique em **"Carregar Programa"**
4. Execute de duas formas:
   - **"Próximo Ciclo":** Passo a passo para debug
   - **"Executar Tudo":** Completa automaticamente

#### Escrevendo Código Próprio

```assembly
# Exemplo de código assembly RISC-V
addi x1, x0, 10      # x1 = 10
addi x2, x0, 20      # x2 = 20
add x3, x1, x2       # x3 = x1 + x2 = 30
sw x3, 0(x0)         # mem[0] = x3
lw x4, 0(x0)         # x4 = mem[0]
nop                  # no operation
```

**Formato de Instruções:**
- `add rd, rs1, rs2` - Registradores separados por vírgula
- `lw rd, offset(base)` - Load: offset em decimal
- `sw rs2, offset(base)` - Store: offset em decimal
- `beq rs1, rs2, offset` - Branch: offset relativo
- Comentários: `#` ou `//`

#### Analisando Resultados

1. **Durante execução:** Observe as visualizações em tempo real
2. **Após conclusão:** Analise as métricas finais
3. **Exportação:** Clique em "Exportar CSV" para salvar dados
4. **Comparação:** Carregue CSVs em `graficos.html`

### 7.3 Dicas de Uso

✅ **Para estudar hazards:**
```assembly
# Cria load-use hazard intencional
lw x1, 0(x0)
add x2, x1, x1    # Causa stall de 1 ciclo
```

✅ **Para testar preditor:**
```assembly
# Loop com branch previsível
addi x1, x0, 5
loop:
  addi x1, x1, -1
  bne x1, x0, loop  # Preditor aprende o padrão
```

✅ **Para analisar cache:**
```assembly
# Acesso sequencial (boa taxa de acerto)
addi x1, x0, 0
lw x2, 0(x1)
addi x1, x1, 1
lw x3, 0(x1)
addi x1, x1, 1
lw x4, 0(x1)
```

---

## 🛠️ 8. Tecnologias Utilizadas

### 8.1 Stack Tecnológica

- **Frontend:**
  - HTML5 (estrutura semântica)
  - CSS3 (grid, flexbox, variáveis CSS, sticky positioning)
  - JavaScript ES6+ (classes, modules, async/await)

- **Bibliotecas:**
  - Chart.js 4.x (gráficos comparativos)
  - Nenhuma outra dependência externa

- **Ferramentas de Desenvolvimento:**
  - Visual Studio Code
  - Live Server extension
  - Git (controle de versão)

### 8.2 Padrões de Código

- **Modularização:** Separação clara de responsabilidades
- **OOP:** Classes para componentes principais (Cache, Pipeline, etc)
- **Documentação:** Comentários JSDoc style
- **Nomenclatura:** camelCase para variáveis, PascalCase para classes
- **Validação:** Try-catch extensivo, validação de entradas

---

## 🎮 9. Benchmarks Incluídos

O simulador inclui 6 benchmarks pré-configurados para teste e análise:

### ALU 1 - Operações Aritméticas Simples
```assembly
addi x1, x0, 1
addi x2, x0, 2
add x3, x1, x2
add x4, x3, x1
nop
```
**Objetivo:** Testar pipeline básico sem hazards  
**CPI esperado:** ~1.0  
**Características:** Zero stalls, zero flushes, alta taxa de cache

### ALU 2 - Operações Encadeadas
```assembly
addi x1, x0, 5
addi x2, x0, 6
add x3, x1, x2
add x4, x3, x3
nop
```
**Objetivo:** Testar forwarding EX/MEM  
**CPI esperado:** ~1.0-1.1  
**Características:** Forwarding bem-sucedido, poucos stalls

### MEM 1 - Leitura Sequencial
```assembly
addi x1, x0, 0
lw x2, 0(x1)
addi x1, x1, 1
lw x3, 0(x1)
nop
```
**Objetivo:** Testar comportamento de cache com leituras  
**CPI esperado:** ~1.3-1.5  
**Características:** Alguns cache misses, boa localidade espacial

### MEM 2 - Escrita Sequencial
```assembly
addi x1, x0, 0
addi x2, x0, 7
sw x2, 0(x1)
addi x1, x1, 1
sw x2, 0(x1)
nop
```
**Objetivo:** Testar política write-back  
**CPI esperado:** ~1.2-1.4  
**Características:** Writes na cache, writeback em evictions

### CTRL 1 - Loop Simples (Branch Taken)
```assembly
addi x1, x0, 5
addi x2, x0, 0
beq x2, x1, 2
addi x2, x2, 1
beq x0, x0, -2
nop
```
**Objetivo:** Testar preditor com padrão consistente  
**CPI esperado:** ~1.1-1.3  
**Características:** Preditor aprende rápido, poucos flushes

### CTRL 2 - Branch Alternado (Taken/Not-Taken)
```assembly
addi x1, x0, 0
addi x2, x0, 1
beq x1, x2, 2
addi x1, x1, 1
addi x2, x2, 1
nop
```
---

**Fim do README.md**