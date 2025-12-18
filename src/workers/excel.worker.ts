// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { EGSStrategy } from './strategies/EGSStrategy';
import { EraVerdeStrategy } from './strategies/EraVerdeStrategy';
import { StandardStrategy } from './strategies/StandardStrategy';
import { IProjectStrategy, ProcessingContext } from './strategies/IProjectStrategy';

// Configurações básicas de leitura
const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

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

        // --- AÇÃO: ANALISAR ---
        if (action === 'analyze') {
            const projectCounts: Record<string, number> = {};

            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

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

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                // Contagem total - passamos undefined para forçar detecção automática
                sheetData.forEach(row => {
                    for (const strategy of strategies) {
                        if (strategy.matches(row, undefined)) {
                            // Processamento "dry-run" sem cutoffDate para não filtrar
                            const result = strategy.process(row, { manualCode: undefined, fileName });

                            if (result && result.PROJETO) {
                                const proj = result.PROJETO;
                                projectCounts[proj] = (projectCounts[proj] || 0) + 1;
                                break;
                            }
                        }
                    }
                });
            });

            // Retorna contagem e lista de projetos para compatibilidade
            const projects = Object.keys(projectCounts);
            self.postMessage({ success: true, projects, projectCounts });
            return;
        }

        // --- AÇÃO: PROCESSAR ---
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

            console.log(`[WORKER] Iniciando processamento: ${fileName} | ManualCode: ${manualCode}`);

            const context: ProcessingContext = {
                manualCode,
                cutoffDate,
                fileName
            };

            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

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

                sheetData.forEach(row => {
                    stats.total++;

                    const strategy = strategies.find(s => s.matches(row, manualCode));

                    if (!strategy) {
                        stats.skippedEmpty++;
                        return;
                    }

                    const result = strategy.process(row, context);

                    if (!result) {
                        stats.skippedStatus++;
                        return;
                    }

                    // Se resultado veio "A Definir" mas temos manualCode, sobrescreve
                    if (result.PROJETO === 'A Definir' && manualCode) {
                        result.PROJETO = manualCode;
                    }

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