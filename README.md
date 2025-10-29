# Projeto 02: Simulador de Pipeline com Cache Integrada

**Disciplina:** Arquitetura de Computadores II
**Professor:** Maurício Rodrigues Lima

**Integrantes:**
* Arthur Cardoso
* Henrique de Sousa Paixão
* Lais Vitoria
* Myllena Rodrigues Oliveira
* Samara Solis Sanches

---

## 🎯 1. Objetivo do Projeto

O objetivo deste projeto foi construir um simulador ciclo-a-ciclo de um pipeline de 5 estágios (IF, ID, EX, MEM, WB) com uma hierarquia de memória integrada.

Para atender a este requisito, foi desenvolvido um **simulador interativo de pipeline RISC-V**, implementado em JavaScript, HTML e CSS. A ferramenta permite visualizar o funcionamento ciclo a ciclo do processador, o tratamento de hazards, forwarding, predição de desvios e o impacto das caches L1.

## ⚙️ 2. Funcionalidades Implementadas

O simulador atende aos requisitos técnicos definidos na especificação, implementando as seguintes funcionalidades:

* **Pipeline de 5 Estágios (RV32I):**
    * Simulação completa dos estágios: IF (Busca), ID (Decodificação), EX (Execução), MEM (Memória) e WB (Write-Back).

* **Tratamento de Hazards de Dados:**
    * Implementação de **forwarding** (EX/MEM) para mitigar hazards de dados.
    * Inserção automática de **stalls** (bolhas) quando o forwarding não é suficiente (ex: dependência `lw` com uso imediato).

* **Tratamento de Hazards de Controle:**
    * Implementação de **flush** de instruções especulativas em caso de predição de desvio incorreta.
    * Inclusão de um preditor de desvio dinâmico de **1-bit** para análise de fluxo de controle, conforme uma das opções de predição sugeridas.

* **Hierarquia de Memória (Cache):**
    * **Caches L1 integradas** de Instrução (L1I) e Dados (L1D).
    * **Política de Substituição:** LRU (Least Recently Used), conforme uma das opções sugeridas.
    * **Política de Escrita:** Write-Back / Write-Allocate (WB/WA), conforme uma das opções sugeridas.

## 🖥️ 3. Interface Gráfica e Interatividade

Uma das principais características desta implementação é a interface gráfica interativa, que permite ao usuário:

* **Inserir Código:** Uma caixa de texto (`textarea`) para digitar ou colar o programa em assembly RISC-V.
* **Controle de Execução:** Botões para "Carregar Programa", "Próximo Ciclo", "Executar Tudo", "Resetar" e "Exportar CSV".
* **Visualização em Tempo Real:**
    * **Tabela do Pipeline:** Mostra qual instrução está em cada estágio (IF, ID, EX, MEM, WB) a cada ciclo.
    * **Tabela de Registradores:** Exibe os valores dos 32 registradores (x0-x31), atualizados em tempo real.

## 📊 4. Métricas e Análise de Desempenho

O simulador coleta e exibe as métricas obrigatórias do projeto em tempo real e permite a exportação dos resultados. As métricas incluem:

* Ciclos Totais
* CPI (Ciclos por Instrução)
* Total de Stalls
* Total de Flushes
* Branch Hits (Acurácia do preditor)
* Cache Hit Rates (L1I e L1D)

Os resultados podem ser exportados automaticamente para `.csv`, facilitando a análise e a criação de gráficos.

## 🛠️ 5. Tecnologias Utilizadas

O projeto foi desenvolvido inteiramente com tecnologias web:

* **Lógica do Simulador:** `Simulator.js` (Núcleo lógico da simulação, pipeline, hazards e caches).
* **Interface e Interatividade:** HTML5, CSS3 e JavaScript.
* **Ambiente de Desenvolvimento:** Visual Studio Code e Live Server.