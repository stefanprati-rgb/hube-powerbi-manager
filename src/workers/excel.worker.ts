// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { EGSStrategy } from './strategies/EGSStrategy';
import { EraVerdeStrategy } from './strategies/EraVerdeStrategy';
import { StandardStrategy } from './strategies/StandardStrategy';
import { IProjectStrategy, ProcessingContext } from './strategies/IProjectStrategy';

// Configurações básicas de leitura
const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

// Helper básico apenas para encontrar o cabeçalho no arquivo bruto
const findValueInRow = (rowObj: any, keyName: string) => {
    if (rowObj[keyName] !== undefined) return rowObj[keyName];
    const cleanKey = String(keyName).trim().toLowerCase();
    const actualKey = Object.keys(rowObj).find(k => String(k).trim().toLowerCase() === cleanKey);
    return actualKey ? rowObj[actualKey] : undefined;
};

// Instancia as estratégias na ordem de prioridade
// 1. EGS (Regras muito específicas de colunas)
// 2. Era Verde (Regras específicas de distribuidora)
// 3. Standard (Padrão para o resto)
const getStrategies = (): IProjectStrategy[] => [
    new EGSStrategy(),
    new EraVerdeStrategy(),
    new StandardStrategy()
];

self.onmessage = async (e: MessageEvent) => {
    const { action, fileBuffer, fileName, manualCode, cutoffDate, targetProject } = e.data;

    try {
        const workbook = XLSX.read(fileBuffer, { type: 'array' });
        const strategies = getStrategies();

        // --- AÇÃO: ANALISAR (DETECTAR PROJETOS) ---
        if (action === 'analyze') {
            const detectedProjects = new Set<string>();

            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                // 1. Encontrar cabeçalho
                let headerRowIndex = -1;
                for (let i = 0; i < Math.min(rawData.length, 100); i++) {
                    const row = rawData[i];
                    if (!row || row.length === 0) continue;
                    const rowStr = row.map(c => String(c).toLowerCase());
                    if (rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)))) {
                        headerRowIndex = i; break;
                    }
                }
                if (headerRowIndex === -1) return;

                // 2. Ler amostra de dados
                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                // Analisa as primeiras 20 linhas para descobrir o projeto
                sheetData.slice(0, 20).forEach(row => {
                    for (const strategy of strategies) {
                        if (strategy.matches(row, manualCode)) {
                            // Executa processamento "fake" para saber qual PROJETO a estratégia define
                            // (Ex: EraVerdeStrategy pode retornar EMG ou ESP dependendo da linha)
                            const result = strategy.process(row, { manualCode, fileName });
                            if (result && result.PROJETO) {
                                detectedProjects.add(result.PROJETO);
                                // Se achou uma estratégia que processa, não precisa testar as outras para esta linha
                                break;
                            }
                        }
                    }
                });
            });

            self.postMessage({ success: true, projects: Array.from(detectedProjects) });
            return;
        }

        // --- AÇÃO: PROCESSAR (GERAR DADOS) ---
        if (action === 'process') {
            const processedRows: any[] = [];
            const stats = {
                total: 0,
                processed: 0,
                skippedOld: 0,
                skippedCancelled: 0,
                skippedEmpty: 0,
                skippedStatus: 0
            };

            console.log(`[WORKER] Iniciando processamento modular: ${fileName}`);

            const context: ProcessingContext = {
                manualCode,
                cutoffDate,
                fileName
            };

            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                // 1. Encontrar cabeçalho
                let headerRowIndex = -1;
                for (let i = 0; i < Math.min(rawData.length, 50); i++) {
                    const row = rawData[i];
                    if (!row || row.length === 0) continue;
                    const rowStr = row.map(c => String(c).toLowerCase());
                    if (rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)))) {
                        // Verifica termos financeiros para evitar abas de cadastro (exceto EGS que é especial)
                        const matches = rowStr.filter(cell => FINANCIAL_TERMS.some(term => cell.includes(term))).length;
                        // Relaxamos a regra para 1 match se parecer muito com cabeçalho
                        if (matches >= 1) { headerRowIndex = i; break; }
                    }
                }

                if (headerRowIndex === -1) return;

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                // 2. Processar linhas
                sheetData.forEach(row => {
                    stats.total++;

                    // A) Encontra a estratégia correta
                    const strategy = strategies.find(s => s.matches(row, manualCode));

                    if (!strategy) {
                        stats.skippedEmpty++; // Nenhuma estratégia aceitou a linha
                        return;
                    }

                    // B) Processa
                    const result = strategy.process(row, context);

                    if (!result) {
                        // Se retornou null, foi filtrado (status, data, etc). 
                        // Simplificação: contamos como skippedStatus ou genericamente
                        stats.skippedStatus++;
                        return;
                    }

                    // C) Filtro de Projeto Alvo (Caso estejamos processando apenas um dos projetos detectados)
                    if (targetProject && result.PROJETO !== targetProject) {
                        stats.skippedEmpty++;
                        return;
                    }

                    processedRows.push(result);
                    stats.processed++;
                });
            });

            console.log(`[WORKER] Relatório Final (${fileName}):`, stats);
            self.postMessage({ success: true, rows: processedRows, stats });
        }

    } catch (error: any) {
        console.error("Worker Error:", error);
        self.postMessage({ success: false, error: error.message });
    }
};