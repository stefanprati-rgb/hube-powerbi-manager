// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { parseExcelDate, formatDateToBR } from '../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING, PROJECT_MAPPING, VALID_PROJECT_CODES } from '../config/constants';

const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

// Helper para encontrar valor na linha ignorando maiúsculas/minúsculas (Uso geral)
const findValueInRow = (rowObj: any, keyName: string) => {
    if (rowObj[keyName] !== undefined) return rowObj[keyName];
    const cleanKey = String(keyName).trim().toLowerCase();
    const actualKey = Object.keys(rowObj).find(k => String(k).trim().toLowerCase() === cleanKey);
    return actualKey ? rowObj[actualKey] : undefined;
};

// Normalização estrita de projeto com regra de Distribuidora para Era Verde
const normalizeProject = (raw: any, row: any): string | null => {
    let p = String(raw || "").trim().toUpperCase();

    // 1. AUTO-DETECÇÃO: Se não tiver coluna PROJETO, tenta inferir pelo contexto
    if (!p) {
        // A) Era Verde: Verifica Tipo Contrato = tarifa-eraverde
        const tipoContrato = String(findValueInRow(row, "Tipo Contrato") || "").toLowerCase();
        if (tipoContrato.includes("eraverde")) {
            p = "EVD"; // Gatilho interno para Era Verde
        }

        // B) EGS: Verifica existência de colunas exclusivas do modelo EGS
        // Se encontrar "CUSTO_S_GD" (coluna técnica específica) ou "Obs Planilha Rubia"
        if (findValueInRow(row, "CUSTO_S_GD") !== undefined || findValueInRow(row, "Obs Planilha Rubia") !== undefined) {
            p = "EGS";
        }
    }

    if (!p) return null;

    let mapped = PROJECT_MAPPING[p] || p;

    // 2. Regra Específica: Era Verde (EVD) -> EMG ou ESP
    if (mapped === 'EVD' || p.startsWith('ERA VERDE')) {
        // Busca o valor da distribuidora usando a função auxiliar
        const distRaw = String(findValueInRow(row, "Distribuidora") || "").toLowerCase().trim();

        // Verifica os valores específicos indicados: "cemig" ou "cpfl_paulista"
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

    if (!s) return null; // (Vazias) = (ignorar)

    // Regras de Mapeamento (Ordem importa!)

    // 1. Acordos
    if (s.includes('quitado parc') || s.includes('negociado') || s.includes('acordo')) {
        return 'Acordo';
    }

    // 2. Pagos
    if (s.includes('pago') || s.includes('quitado')) {
        return 'Pago';
    }

    // 3. Atrasados
    if (s.includes('atrasado') || s.includes('atraso')) {
        return 'Atrasado';
    }

    // 4. Ignorar
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
                    const rawProj = row["Projeto"] || row["PROJETO"];
                    const norm = normalizeProject(rawProj, row);
                    if (norm) detectedProjects.add(norm);
                });
            });

            console.log(`[WORKER] Projetos detectados:`, Array.from(detectedProjects));
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
                    // Permite aba Faturamento ou Financeiro
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
                const hasProjectCol = headerRow.includes('PROJETO') || headerRow.includes('PROJETO');

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    stats.total++;

                    let rawProj = "";
                    if (hasProjectCol) {
                        rawProj = row["Projeto"] || row["PROJETO"];
                    }
                    if (!rawProj && manualCode) rawProj = manualCode;

                    const finalProj = normalizeProject(rawProj, row);

                    if (!finalProj || (targetProject && finalProj !== targetProject)) {
                        stats.skippedEmpty++;
                        return;
                    }

                    // --- NOVOS FILTROS EGS ---
                    if (finalProj === 'EGS') {
                        // 1. Filtro: Status Faturamento = "aprovado"
                        const statusFat = String(findValueInRow(row, "Status Faturamento") || "").toLowerCase().trim();
                        if (statusFat !== 'aprovado') {
                            stats.skippedStatus++; // Contamos como pulado por status
                            return;
                        }

                        // 2. Filtro: Status Pagamento != "não faturado" e != "cancelado"
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

                    // --- LÓGICA DE STATUS ---
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

                    // --- Verificação de Data (Corte) ---
                    const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
                    const skipCheck = shouldSkipRow(refDate, cutoffDate, finalStatus);

                    if (skipCheck.shouldSkip) {
                        if (skipCheck.reason === 'old_date') stats.skippedOld++;
                        else if (skipCheck.reason === 'cancelled') stats.skippedCancelled++;
                        return;
                    }

                    // --- Construção da Linha ---
                    const newRow: Record<string, any> = {};
                    newRow["PROJETO"] = finalProj;

                    FINAL_HEADERS.forEach(key => {
                        if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
                    });

                    newRow["Status"] = finalStatus;

                    // 3. Regra: Forçar Cancelada = "Não" para EGS
                    if (finalProj === 'EGS') {
                        newRow["Cancelada"] = "Não";
                    }

                    // 4. Regra: Limpar Multa/Juros se for "-"
                    if (finalProj === 'EGS' && String(newRow["Juros e Multa"]).trim() === '-') {
                        newRow["Juros e Multa"] = "";
                    }

                    // Valida Data de Emissão
                    const dataEmissaoRaw = normalizedRow["Data de Emissão"] || normalizedRow["Data emissão"];
                    const dataEmissaoParsed = parseExcelDate(dataEmissaoRaw);

                    if (!dataEmissaoParsed || isNaN(dataEmissaoParsed.getTime())) {
                        stats.skippedEmpty++;
                        return;
                    }

                    if (normalizedRow["Crédito kWh"]) newRow["Crédito kWh"] = parseCurrency(normalizedRow["Crédito kWh"]);
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

                    const cSem = parseCurrency(newRow["Custo sem GD R$"]);
                    const cCom = parseCurrency(newRow["Custo com GD R$"]);

                    newRow["Custo sem GD R$"] = cSem;
                    newRow["Custo com GD R$"] = cCom;

                    if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);

                    let ecoVal = newRow["Economia R$"];
                    if (ecoVal && String(ecoVal).trim() !== "") {
                        newRow["Economia R$"] = parseCurrency(ecoVal);
                    } else {
                        newRow["Economia R$"] = calculateEconomySafe(cCom, cSem);
                    }

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