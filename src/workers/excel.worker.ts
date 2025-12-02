// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { parseExcelDate, formatDateToBR } from '../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING, PROJECT_MAPPING, VALID_PROJECT_CODES } from '../config/constants';

const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

// Helper para encontrar valor na linha ignorando maiúsculas/minúsculas
const findValueInRow = (rowObj: any, keyName: string) => {
    if (rowObj[keyName] !== undefined) return rowObj[keyName];
    const cleanKey = String(keyName).trim().toLowerCase();
    const actualKey = Object.keys(rowObj).find(k => String(k).trim().toLowerCase() === cleanKey);
    return actualKey ? rowObj[actualKey] : undefined;
};

// Helper para formatar números com vírgula (Padrão BR)
const formatNumberToBR = (value: number | string | null | undefined): string => {
    if (value === undefined || value === null || value === '') return "";
    if (typeof value === 'string' && value.includes(',')) return value;
    return String(value).replace('.', ',');
};

// Normalização estrita de projeto
const normalizeProject = (raw: any, row: any): string | null => {
    let p = String(raw || "").trim().toUpperCase();

    // 1. AUTO-DETECÇÃO (para quando não há seleção manual ou coluna Projeto)
    if (!p) {
        // A) Era Verde: Verifica Tipo Contrato
        const tipoContrato = String(findValueInRow(row, "Tipo Contrato") || "").toLowerCase();
        if (tipoContrato.includes("eraverde")) {
            p = "EVD";
        }

        // B) EGS: Verifica colunas exclusivas
        if (findValueInRow(row, "CUSTO_S_GD") !== undefined || findValueInRow(row, "Obs Planilha Rubia") !== undefined) {
            p = "EGS";
        }
    }

    if (!p) return null;

    let mapped = PROJECT_MAPPING[p] || p;

    // 2. Regra Específica: Era Verde (EVD, EMG, ESP)
    if (mapped === 'EVD' || mapped === 'EMG' || mapped === 'ESP' || p.startsWith('ERA VERDE')) {
        const distRaw = String(findValueInRow(row, "Distribuidora") || "").toLowerCase().trim();

        // Lógica Soberana da Distribuidora
        if (distRaw.includes('cemig')) {
            mapped = 'EMG';
        } else if (distRaw.includes('cpfl') || distRaw.includes('paulista')) {
            mapped = 'ESP';
        } else {
            // Fallback: Tenta definir pela UF se a distribuidora não for clara
            const uf = String(findValueInRow(row, "UF") || findValueInRow(row, "Estado") || "").trim().toUpperCase();
            if (uf === 'MG') mapped = 'EMG';
            else mapped = 'ESP'; // Padrão SP se não for MG
        }
    }

    return VALID_PROJECT_CODES.includes(mapped) ? mapped : null;
};

// --- LÓGICA DE STATUS (ESTRITA) ---
const mapStatusStrict = (statusRaw: string): string | null => {
    const s = statusRaw.toLowerCase().trim();

    if (!s) return null;

    // 1. Acordos
    if (s.includes('quitado parc') || s.includes('negociado') || s.includes('acordo')) {
        return 'Negociado';
    }

    // 2. Pagos
    if (s.includes('pago') || s.includes('quitado')) {
        return 'Pago';
    }

    // 3. Atrasados
    if (s.includes('atrasado') || s.includes('atraso')) {
        return 'Atrasado';
    }

    return null;
};

self.onmessage = async (e: MessageEvent) => {
    const { action, fileBuffer, fileName, manualCode, cutoffDate, targetProject } = e.data;

    try {
        const workbook = XLSX.read(fileBuffer, { type: 'array' });

        if (action === 'analyze') {
            const detectedProjects = new Set<string>();
            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
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

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    // FIX: Usa findValueInRow para garantir leitura robusta da coluna Projeto
                    const rawProj = findValueInRow(row, "Projeto") || findValueInRow(row, "PROJETO");
                    const norm = normalizeProject(rawProj, row);
                    if (norm) detectedProjects.add(norm);
                });
            });

            self.postMessage({ success: true, projects: Array.from(detectedProjects) });
            return;
        }

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

            const manualCodeNormalized = manualCode ? normalizeProject(manualCode, {}) : null;
            const currentProjCode = targetProject || manualCodeNormalized;
            const isEGSContext = currentProjCode === 'EGS';

            console.log(`[WORKER] Iniciando processamento: ${fileName} (Alvo: ${currentProjCode || 'N/A'})`);

            workbook.SheetNames.forEach(sheetName => {
                if (isEGSContext) {
                    const lowerName = sheetName.toLowerCase();
                    if (!lowerName.includes('faturamento') && !lowerName.includes('financeiro')) return;
                }

                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                let headerRowIndex = -1;
                for (let i = 0; i < Math.min(rawData.length, 50); i++) {
                    const row = rawData[i];
                    if (!row || row.length === 0) continue;
                    const rowStr = row.map(c => String(c).toLowerCase());
                    if (rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)))) {
                        const matches = rowStr.filter(cell => FINANCIAL_TERMS.some(term => cell.includes(term))).length;
                        if (matches >= 2) { headerRowIndex = i; break; }
                    }
                }

                if (headerRowIndex === -1) return;

                const headerRow = rawData[headerRowIndex].map(c => String(c).toUpperCase().trim());
                // Verifica duplicidade ou variações comuns
                const hasProjectCol = headerRow.includes('PROJETO') || headerRow.includes('PROJETO ');

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    stats.total++;

                    let rawProj = "";
                    if (hasProjectCol) {
                        // FIX: Usa findValueInRow para leitura robusta (resolve o bug de "PROJETO " com espaço)
                        rawProj = findValueInRow(row, "Projeto");
                    }

                    // Só usa o manualCode se realmente não encontrou nada na linha
                    if (!rawProj && manualCode) rawProj = manualCode;

                    // Normaliza e corrige EMG/ESP baseado na distribuidora da linha
                    const finalProj = normalizeProject(rawProj, row);

                    if (!finalProj || (targetProject && finalProj !== targetProject)) {
                        stats.skippedEmpty++;
                        return;
                    }

                    if (finalProj === 'EGS') {
                        const statusFat = String(findValueInRow(row, "Status Faturamento") || "").toLowerCase().trim();
                        if (statusFat !== 'aprovado') {
                            stats.skippedStatus++;
                            return;
                        }

                        const statusPag = String(findValueInRow(row, "Status Pagamento") || "").toLowerCase().trim();
                        if (statusPag === 'não faturado' || statusPag.includes('cancelado')) {
                            stats.skippedCancelled++;
                            return;
                        }
                    }

                    const normalizedRow: any = { ...row };
                    Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
                        const val = findValueInRow(row, orig);
                        if (val !== undefined) normalizedRow[dest] = val;
                    });

                    let statusRaw = "";
                    if (finalProj === 'EGS') {
                        statusRaw = String(findValueInRow(row, "Status Pagamento") || "").trim();
                    } else {
                        statusRaw = String(
                            normalizedRow["Status"] ||
                            normalizedRow["Status Faturamento"] ||
                            normalizedRow["Status Pagamento"] ||
                            ""
                        ).trim();
                    }

                    const finalStatus = mapStatusStrict(statusRaw);

                    if (!finalStatus) {
                        stats.skippedStatus++;
                        return;
                    }

                    const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
                    const skipCheck = shouldSkipRow(refDate, cutoffDate, finalStatus);

                    if (skipCheck.shouldSkip) {
                        if (skipCheck.reason === 'old_date') stats.skippedOld++;
                        else if (skipCheck.reason === 'cancelled') stats.skippedCancelled++;
                        return;
                    }

                    const newRow: Record<string, any> = {};
                    newRow["PROJETO"] = finalProj;

                    FINAL_HEADERS.forEach(key => {
                        if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
                    });

                    newRow["Status"] = finalStatus;

                    if (finalProj === 'EGS') {
                        newRow["Cancelada"] = "Não";
                    }

                    if (finalProj === 'EGS' && String(newRow["Juros e Multa"]).trim() === '-') {
                        newRow["Juros e Multa"] = "";
                    }

                    const dataEmissaoRaw = normalizedRow["Data de Emissão"] || normalizedRow["Data emissão"];
                    const dataEmissaoParsed = parseExcelDate(dataEmissaoRaw);

                    if (!dataEmissaoParsed || isNaN(dataEmissaoParsed.getTime())) {
                        stats.skippedEmpty++;
                        return;
                    }

                    if (normalizedRow["Crédito kWh"]) newRow["Crédito kWh"] = formatNumberToBR(parseCurrency(normalizedRow["Crédito kWh"]));
                    if (normalizedRow["ID Boleto/Pix"]) newRow["ID Boleto/Pix"] = String(normalizedRow["ID Boleto/Pix"]).trim();

                    if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
                    if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

                    if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);
                    if (dataEmissaoParsed) newRow["Data de Emissão"] = formatDateToBR(dataEmissaoParsed);

                    const dataVencimento = parseExcelDate(newRow["Vencimento"]);
                    if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

                    if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) {
                        stats.skippedEmpty++;
                        return;
                    }

                    if (finalProj === 'EGS') newRow["Desconto contrato (%)"] = 0.25;
                    else if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;

                    newRow["Desconto contrato (%)"] = formatNumberToBR(newRow["Desconto contrato (%)"]);

                    const cSem = parseCurrency(newRow["Custo sem GD R$"]);
                    const cCom = parseCurrency(newRow["Custo com GD R$"]);

                    newRow["Custo sem GD R$"] = formatNumberToBR(cSem);
                    newRow["Custo com GD R$"] = formatNumberToBR(cCom);

                    if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = formatNumberToBR(parseCurrency(newRow["Valor Final R$"]));

                    let ecoVal = newRow["Economia R$"];
                    if (ecoVal && String(ecoVal).trim() !== "") {
                        newRow["Economia R$"] = formatNumberToBR(parseCurrency(ecoVal));
                    } else {
                        newRow["Economia R$"] = formatNumberToBR(calculateEconomySafe(cCom, cSem));
                    }

                    if (newRow["Valor Bruto R$"]) newRow["Valor Bruto R$"] = formatNumberToBR(parseCurrency(newRow["Valor Bruto R$"]));
                    if (newRow["Tarifa aplicada R$"]) newRow["Tarifa aplicada R$"] = formatNumberToBR(parseCurrency(newRow["Tarifa aplicada R$"]));
                    if (newRow["Ajuste retroativo R$"]) newRow["Ajuste retroativo R$"] = formatNumberToBR(parseCurrency(newRow["Ajuste retroativo R$"]));
                    if (newRow["Desconto extra"]) newRow["Desconto extra"] = formatNumberToBR(parseCurrency(newRow["Desconto extra"]));
                    if (newRow["Valor da cobrança R$"]) newRow["Valor da cobrança R$"] = formatNumberToBR(parseCurrency(newRow["Valor da cobrança R$"]));
                    if (newRow["Valor Pago"]) newRow["Valor Pago"] = formatNumberToBR(parseCurrency(newRow["Valor Pago"]));
                    if (newRow["Valor creditado R$"]) newRow["Valor creditado R$"] = formatNumberToBR(parseCurrency(newRow["Valor creditado R$"]));

                    let dias = 0;
                    const statusPago = finalStatus === 'Pago';

                    if (!statusPago) {
                        dias = newRow["Dias Atrasados"] ? Number(newRow["Dias Atrasados"]) : calculateDaysLate(dataVencimento);
                        if (isNaN(dias)) dias = calculateDaysLate(dataVencimento);
                    }
                    newRow["Dias Atrasados"] = dias > 0 ? dias : 0;

                    if (!newRow["Risco"]) {
                        newRow["Risco"] = determineRisk(null, newRow["Dias Atrasados"]);
                    }

                    processedRows.push(newRow);
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