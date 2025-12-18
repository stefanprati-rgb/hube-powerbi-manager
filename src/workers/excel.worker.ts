// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { EGSStrategy } from './strategies/EGSStrategy';
import { EraVerdeStrategy } from './strategies/EraVerdeStrategy';
import { StandardStrategy } from './strategies/StandardStrategy';
import { IProjectStrategy, ProcessingContext } from './strategies/IProjectStrategy';

// Configurações básicas de leitura
const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

// Instancia as estratégias na ordem de prioridade
const getStrategies = (): IProjectStrategy[] => [
    new EGSStrategy(),
    new EraVerdeStrategy(),
    new StandardStrategy()
];

self.onmessage = async (e: MessageEvent) => {
    const { action, fileBuffer, fileName, manualCode, cutoffDate } = e.data;

    try {
        const workbook = XLSX.read(fileBuffer, { type: 'array' });
        const strategies = getStrategies();

        // --- AÇÃO: ANALISAR (CONTAGEM POR PROJETO) ---
        if (action === 'analyze') {
            const projectCounts: Record<string, number> = {};

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
                        headerRowIndex = i;
                        break;
                    }
                }

                if (headerRowIndex === -1) return;

                // 2. Ler TODAS as linhas para contagem exata
                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    for (const strategy of strategies) {
                        if (strategy.matches(row, manualCode)) {
                            // Executa processamento leve para identificar o projeto exato (ex: EMG vs ESP)
                            const result = strategy.process(row, { manualCode, fileName });
                            if (result && result.PROJETO) {
                                const proj = result.PROJETO;
                                projectCounts[proj] = (projectCounts[proj] || 0) + 1;
                                break; // Encontrou estratégia, passa para próxima linha
                            }
                        }
                    }
                });
            });

            // Retorna o objeto de contagem e lista de projetos para compatibilidade
            const projects = Object.keys(projectCounts);
            self.postMessage({ success: true, projects, projectCounts });
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

            console.log(`[WORKER] Iniciando processamento: ${fileName}`);

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
                        const matches = rowStr.filter(cell => FINANCIAL_TERMS.some(term => cell.includes(term))).length;
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
                        stats.skippedEmpty++;
                        return;
                    }

                    // B) Processa
                    const result = strategy.process(row, context);

                    if (!result) {
                        stats.skippedStatus++;
                        return;
                    }

                    // C) Se a estratégia validou e retornou um projeto, nós aceitamos.
                    // Isso permite arquivos mistos (LNV+MTX ou EMG+ESP) sem perder dados.
                    processedRows.push(result);
                    stats.processed++;
                });
            });

            console.log(`[WORKER] Concluído (${fileName}):`, stats);
            self.postMessage({ success: true, rows: processedRows, stats });
        }

    } catch (error: any) {
        console.error("Worker Error:", error);
        self.postMessage({ success: false, error: error.message });
    }
};