// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { parseExcelDate, formatDateToBR } from '../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING, PROJECT_MAPPING, VALID_PROJECT_CODES } from '../config/constants';

const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

// 1. Normalização estrita de projeto
const normalizeProject = (raw: any, row: any): string | null => {
    let p = String(raw || "").trim().toUpperCase();
    if (!p) return null;

    let mapped = PROJECT_MAPPING[p] || p;

    if (mapped === 'EVD' || p.startsWith('ERA VERDE')) {
        const uf = String(row["UF"] || row["Estado"] || "").trim().toUpperCase();
        mapped = uf === 'MG' ? 'EMG' : 'ESP';
    }

    return VALID_PROJECT_CODES.includes(mapped) ? mapped : null;
};

// 2. Helper Robusto: Encontra coluna ignorando maiúsculas/minúsculas e espaços extras
// (Isso resolve o problema das colunas em branco)
const findValueInRow = (rowObj: any, keyName: string) => {
    if (rowObj[keyName] !== undefined) return rowObj[keyName];

    const cleanKey = String(keyName).trim().toLowerCase();
    const actualKey = Object.keys(rowObj).find(k => String(k).trim().toLowerCase() === cleanKey);

    return actualKey ? rowObj[actualKey] : undefined;
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
                let headerRowIndex = -1;
                let bestMatchCount = 0;
                for (let i = 0; i < Math.min(rawData.length, 50); i++) {
                    const row = rawData[i];
                    if (!row || row.length === 0) continue;
                    const rowStr = row.map(c => String(c).toLowerCase());
                    const hasId = rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)));
                    const matches = rowStr.filter(cell => FINANCIAL_TERMS.some(term => cell.includes(term))).length;
                    if (hasId && matches >= 2 && matches > bestMatchCount) {
                        bestMatchCount = matches;
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

            const currentProjCode = targetProject || (manualCode ? normalizeProject(manualCode, {}) : null);
            const isEGSContext = currentProjCode === 'EGS';

            workbook.SheetNames.forEach(sheetName => {
                // Filtro de Aba EGS
                if (isEGSContext && !sheetName.toLowerCase().includes('faturamento')) {
                    return;
                }

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

                if (!hasProjectCol && (!manualCode || manualCode.trim() === "")) {
                    throw new Error("Coluna PROJETO ausente e sigla manual não informada.");
                }

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    let rawProj = "";
                    if (hasProjectCol) rawProj = row["Projeto"] || row["PROJETO"];
                    if (!rawProj) rawProj = manualCode;

                    const finalProj = normalizeProject(rawProj, row);
                    if (!finalProj) return;
                    if (targetProject && finalProj !== targetProject) return;

                    // 3. Normalização Robusta (Usa findValueInRow)
                    const normalizedRow: any = { ...row };
                    Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
                        const val = findValueInRow(row, orig);
                        if (val !== undefined) normalizedRow[dest] = val;
                    });

                    // 4. Tratamento de Status (CORRIGIDO PARA INCLUIR QUITADO)
                    let status = String(normalizedRow["Status"] || "").trim();
                    const statusLower = status.toLowerCase();

                    if (finalProj === 'EGS') {
                        if (statusLower.includes('quitado parc')) {
                            status = 'Negociado';
                        } else if (statusLower === 'pago' || statusLower === 'quitado') {
                            status = 'PAGO';
                        } else if (statusLower.includes('atrasado') || statusLower.includes('atraso')) {
                            status = 'ATRASADO';
                        } else if (statusLower.includes('acordo') || statusLower.includes('negociado')) {
                            status = 'Negociado';
                        } else {
                            // Filtra tudo o resto (Pendente, Cancelado, etc)
                            return;
                        }
                    } else {
                        if (statusLower.includes("cancelad")) return;
                    }

                    const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
                    const skipCheck = shouldSkipRow(refDate, cutoffDate, status);
                    if (skipCheck.shouldSkip) return;

                    const newRow: Record<string, any> = {};
                    newRow["PROJETO"] = finalProj;

                    FINAL_HEADERS.forEach(key => {
                        if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
                    });

                    newRow["Status"] = status;

                    if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
                    if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

                    if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);

                    const dataEmissao = parseExcelDate(newRow["Data de Emissão"]);
                    if (dataEmissao) newRow["Data de Emissão"] = formatDateToBR(dataEmissao);

                    const dataVencimento = parseExcelDate(newRow["Vencimento"]);
                    if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

                    if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return;

                    if (finalProj === 'EGS') newRow["Desconto contrato (%)"] = 0.25;
                    else if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;

                    // 5. Cálculos Financeiros (Garante uso dos valores normalizados)
                    const cSem = parseCurrency(newRow["Custo sem GD R$"]);
                    const cCom = parseCurrency(newRow["Custo com GD R$"]);
                    newRow["Custo sem GD R$"] = cSem;
                    newRow["Custo com GD R$"] = cCom;

                    if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);

                    let ecoVal = newRow["Economia R$"];
                    if (ecoVal && String(ecoVal).trim() !== "") {
                        newRow["Economia R$"] = String(ecoVal).replace("R$", "").trim();
                    } else {
                        newRow["Economia R$"] = calculateEconomySafe(cCom, cSem);
                    }

                    let dias = newRow["Dias Atrasados"] ? Number(newRow["Dias Atrasados"]) : calculateDaysLate(dataVencimento);
                    if (isNaN(dias)) dias = calculateDaysLate(dataVencimento);
                    newRow["Dias Atrasados"] = dias;

                    if (!newRow["Risco"]) newRow["Risco"] = determineRisk(status, dias);

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