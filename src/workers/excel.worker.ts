// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { parseExcelDate, formatDateToBR } from '../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING, PROJECT_MAPPING, VALID_PROJECT_CODES } from '../config/constants';

const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

// Normalização estrita de projeto
const normalizeProject = (raw: any, row: any): string | null => {
    let p = String(raw || "").trim().toUpperCase();
    if (!p) return null;

    // Tenta mapear ou usa o próprio
    let mapped = PROJECT_MAPPING[p] || p;

    // Lógica Era Verde
    if (mapped === 'EVD' || p.startsWith('ERA VERDE')) {
        const uf = String(row["UF"] || row["Estado"] || "").trim().toUpperCase();
        mapped = uf === 'MG' ? 'EMG' : 'ESP';
    }

    // Validação final
    return VALID_PROJECT_CODES.includes(mapped) ? mapped : null;
};

self.onmessage = async (e: MessageEvent) => {
    const { action, fileBuffer, fileName, manualCode, cutoffDate, targetProject } = e.data;

    try {
        const workbook = XLSX.read(fileBuffer, { type: 'array' });

        // --- MODO 1: ANÁLISE DE ESTRUTURA ---
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

        // --- MODO 2: PROCESSAMENTO COMPLETO ---
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

                if (!hasProjectCol && (!manualCode || manualCode.trim() === "")) {
                    throw new Error("Coluna PROJETO ausente e sigla manual não informada.");
                }

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    // 1. Obter Projeto
                    let rawProj = "";
                    if (hasProjectCol) rawProj = row["Projeto"] || row["PROJETO"];
                    if (!rawProj) rawProj = manualCode;

                    // 2. Normalizar e Validar Projeto
                    const finalProj = normalizeProject(rawProj, row);
                    if (!finalProj) return;
                    if (targetProject && finalProj !== targetProject) return;

                    // 3. Normalização de Colunas (EGS Mapping)
                    const normalizedRow: any = { ...row };
                    Object.entries(EGS_MAPPING).forEach(([orig, dest]) => { if (row[orig] !== undefined) normalizedRow[dest] = row[orig]; });

                    // 4. Filtro de Status Específico (EGS e Geral)
                    let status = String(normalizedRow["Status"] || "").trim();
                    const statusLower = status.toLowerCase();

                    // Regras de exclusão solicitadas:
                    // Ignora "Cancelado" e "Não faturado"
                    if (statusLower.includes("cancelad") || statusLower.includes("não faturado") || statusLower.includes("nao faturado")) {
                        return;
                    }

                    // Regras de Transformação:
                    // "Acordo" -> "Negociado"
                    if (statusLower.includes("acordo")) {
                        status = "Negociado";
                    }
                    // Mantém "Pago" e "Atrasado" (ou "Atraso")
                    // Se passar daqui, o status é válido ou será tratado abaixo

                    // Filtro de Data
                    const rawRefDate = normalizedRow["Mês de Referência"] || normalizedRow["Referência"];
                    const refDate = parseExcelDate(rawRefDate);
                    const skipCheck = shouldSkipRow(refDate, cutoffDate, status);
                    if (skipCheck.shouldSkip) return;

                    // 5. Construção da Nova Linha
                    const newRow: Record<string, any> = {};
                    newRow["PROJETO"] = finalProj;

                    FINAL_HEADERS.forEach(key => {
                        if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
                    });

                    // Aplica o Status filtrado/transformado
                    newRow["Status"] = status;

                    // Normalizações Específicas Solicitadas
                    if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
                    if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

                    // Formatação de Datas (DD/MM/AAAA)
                    if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);

                    const dataEmissao = parseExcelDate(newRow["Data de Emissão"]);
                    if (dataEmissao) newRow["Data de Emissão"] = formatDateToBR(dataEmissao);

                    const dataVencimento = parseExcelDate(newRow["Vencimento"]); // Campo normalizado "Vencimento"
                    if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

                    // Validação de Integridade
                    if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return;

                    // Desconto e Valores
                    if (finalProj === 'EGS') newRow["Desconto contrato (%)"] = 0.25;
                    else if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;

                    const cSem = parseCurrency(newRow["Custo sem GD R$"]);
                    const cCom = parseCurrency(newRow["Custo com GD R$"]);
                    newRow["Custo sem GD R$"] = cSem;
                    newRow["Custo com GD R$"] = cCom;

                    // Cálculo de Economia (Preenche se vazio)
                    const eco = newRow["Economia R$"];
                    if (eco && String(eco).trim() !== "") {
                        newRow["Economia R$"] = String(eco).replace("R$", "").trim();
                    } else {
                        // Economia = Sem Desconto - Com Desconto
                        newRow["Economia R$"] = calculateEconomySafe(cCom, cSem);
                    }

                    if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);

                    // Risco e Atraso
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