// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { parseExcelDate } from '../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../modules/businessRules';
// IMPORTANTE: Importar as constantes centralizadas
import { FINAL_HEADERS, EGS_MAPPING, PROJECT_MAPPING, VALID_PROJECT_CODES } from '../config/constants';

const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

// Função de Normalização Estrita
const normalizeProject = (raw: any, row: any): string | null => {
    let p = String(raw || "").trim().toUpperCase();
    if (!p) return null;

    // 1. Tenta mapear pelo nome (ex: "LUA NOVA" -> "LNV")
    // Se não estiver no mapa, assume que a string já é o código (ex: "LNV")
    let mapped = PROJECT_MAPPING[p] || p;

    // 2. Lógica Especial Era Verde (Resolve EVD genérico para EMG ou ESP)
    if (mapped === 'EVD' || p.startsWith('ERA VERDE')) {
        const uf = String(row["UF"] || row["Estado"] || "").trim().toUpperCase();
        mapped = uf === 'MG' ? 'EMG' : 'ESP';
    }

    // 3. Validação Final: O código resultante existe na lista permitida?
    if (VALID_PROJECT_CODES.includes(mapped)) {
        return mapped;
    }

    // Se chegou aqui, é um código desconhecido (ex: "XYZ", "PROJETO X")
    return null;
};

self.onmessage = async (e: MessageEvent) => {
    const { action, fileBuffer, fileName, manualCode, cutoffDate, targetProject } = e.data;

    try {
        const workbook = XLSX.read(fileBuffer, { type: 'array' });

        // --- MODO 1: ANÁLISE ---
        if (action === 'analyze') {
            const detectedProjects = new Set<string>();

            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                // Scan cabeçalho
                let headerRowIndex = -1;
                let bestMatchCount = 0;
                for (let i = 0; i < Math.min(rawData.length, 50); i++) {
                    const row = rawData[i];
                    if (!row || row.length === 0) continue;
                    const rowStr = row.map(c => String(c).toLowerCase());
                    const hasId = rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)));
                    const financialMatches = rowStr.filter(cell => FINANCIAL_TERMS.some(term => cell.includes(term))).length;
                    if (hasId && financialMatches >= 2 && financialMatches > bestMatchCount) {
                        bestMatchCount = financialMatches;
                        headerRowIndex = i;
                    }
                }

                if (headerRowIndex === -1) return;

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    const rawProj = row["Projeto"] || row["PROJETO"];
                    if (rawProj) {
                        const norm = normalizeProject(rawProj, row);
                        if (norm) detectedProjects.add(norm);
                    }
                });
            });

            self.postMessage({ success: true, projects: Array.from(detectedProjects) });
            return;
        }

        // --- MODO 2: PROCESSAMENTO ---
        if (action === 'process') {
            const processedRows: any[] = [];

            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                let headerRowIndex = -1;
                let bestMatchCount = 0;
                for (let i = 0; i < Math.min(rawData.length, 50); i++) {
                    const row = rawData[i];
                    if (!row || row.length === 0) continue;
                    const rowStr = row.map(c => String(c).toLowerCase());
                    if (rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)))) {
                        const matches = rowStr.filter(cell => FINANCIAL_TERMS.some(term => cell.includes(term))).length;
                        if (matches >= 2 && matches > bestMatchCount) {
                            bestMatchCount = matches;
                            headerRowIndex = i;
                        }
                    }
                }

                if (headerRowIndex === -1) return;

                const headerRow = rawData[headerRowIndex].map(c => String(c).toUpperCase().trim());
                const hasProjectCol = headerRow.includes('PROJETO') || headerRow.includes('PROJETO');

                // Validação de entrada manual obrigatória se não houver coluna
                if (!hasProjectCol && (!manualCode || manualCode.trim() === "")) {
                    throw new Error("Coluna PROJETO ausente e sigla manual não informada.");
                }

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    // 1. Obter Projeto Bruto
                    let rawProj = "";
                    if (hasProjectCol) rawProj = row["Projeto"] || row["PROJETO"];

                    // Se a coluna estiver vazia nesta linha específica ou não existir, usa o manual
                    if (!rawProj || String(rawProj).trim() === "") {
                        rawProj = manualCode;
                    }

                    // 2. Normalizar e Validar
                    const finalProj = normalizeProject(rawProj, row);

                    // SE FOR INVÁLIDO -> PULA A LINHA (Conforme "não deve aceitar")
                    // Ou, se preferir lançar erro para parar tudo: 
                    // if (!finalProj) throw new Error(`Sigla inválida encontrada: ${rawProj}`);
                    if (!finalProj) return;

                    // 3. Filtro de Target (Se o item da fila for específico para um projeto)
                    if (targetProject && finalProj !== targetProject) return;

                    // --- Processamento Normal ---
                    const normalizedRow: any = { ...row };
                    Object.entries(EGS_MAPPING).forEach(([orig, dest]) => { if (row[orig] !== undefined) normalizedRow[dest] = row[orig]; });

                    const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
                    const skipCheck = shouldSkipRow(refDate, cutoffDate, normalizedRow["Status"] || normalizedRow["Status Faturamento"]);
                    if (skipCheck.shouldSkip) return;

                    const newRow: Record<string, any> = {};
                    newRow["PROJETO"] = finalProj;

                    FINAL_HEADERS.forEach(key => {
                        if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
                    });

                    if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return;

                    if (finalProj === 'EGS') newRow["Desconto contrato (%)"] = 0.25;
                    else if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;

                    const cSem = parseCurrency(newRow["Custo sem GD R$"]);
                    const cCom = parseCurrency(newRow["Custo com GD R$"]);
                    newRow["Custo sem GD R$"] = cSem;
                    newRow["Custo com GD R$"] = cCom;
                    if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);

                    const eco = newRow["Economia R$"];
                    if (eco && String(eco).trim() !== "") newRow["Economia R$"] = String(eco).replace("R$", "").trim();
                    else newRow["Economia R$"] = calculateEconomySafe(cCom, cSem);

                    const venci = parseExcelDate(newRow["Vencimento"]);
                    let dias = newRow["Dias Atrasados"] ? Number(newRow["Dias Atrasados"]) : calculateDaysLate(venci);
                    if (isNaN(dias)) dias = calculateDaysLate(venci);
                    newRow["Dias Atrasados"] = dias;

                    if (!newRow["Risco"]) newRow["Risco"] = determineRisk(newRow["Status"], dias);

                    newRow["Arquivo Origem"] = `${fileName} [${sheetName}]`;
                    processedRows.push(newRow);
                });
            });

            self.postMessage({ success: true, rows: processedRows });
        }

    } catch (error: any) {
        self.postMessage({ success: false, error: error.message });
    }
};