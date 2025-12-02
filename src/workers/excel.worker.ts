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

    let mapped = PROJECT_MAPPING[p] || p;

    if (mapped === 'EVD' || p.startsWith('ERA VERDE')) {
        const uf = String(row["UF"] || row["Estado"] || "").trim().toUpperCase();
        mapped = uf === 'MG' ? 'EMG' : 'ESP';
    }

    return VALID_PROJECT_CODES.includes(mapped) ? mapped : null;
};

// Helper: Encontra valor ignorando case/espaços
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
                for (let i = 0; i < Math.min(rawData.length, 100); i++) {
                    const row = rawData[i];
                    if (!row || row.length === 0) continue;
                    const rowStr = row.map(c => String(c).toLowerCase());
                    const hasId = rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)));
                    if (hasId) {
                        headerRowIndex = i;
                        break;
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

            // Estatísticas de processamento
            const stats = {
                total: 0,
                processed: 0,
                skippedOld: 0,
                skippedCancelled: 0,
                skippedEmpty: 0,
                skippedStatus: 0
            };

            const currentProjCode = targetProject || (manualCode ? normalizeProject(manualCode, {}) : null);
            const isEGSContext = currentProjCode === 'EGS';

            console.log(`[WORKER] Iniciando: ${fileName} (${currentProjCode || 'N/A'})`);

            workbook.SheetNames.forEach(sheetName => {
                // Filtro de aba específico para EGS
                if (isEGSContext) {
                    const lowerName = sheetName.toLowerCase();
                    // Aceita 'faturamento' ou 'base' se tiver colunas financeiras (flexibilização)
                    if (!lowerName.includes('faturamento') && !lowerName.includes('financeiro')) {
                        // console.log(`[SKIP TAB] Aba "${sheetName}" ignorada.`);
                        return;
                    }
                }

                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                // Detecção inteligente de cabeçalho
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

                // Verificação de coluna de Projeto
                const headerRow = rawData[headerRowIndex].map(c => String(c).toUpperCase().trim());
                const hasProjectCol = headerRow.includes('PROJETO');

                if (!hasProjectCol && (!manualCode || manualCode.trim() === "")) {
                    throw new Error("Coluna PROJETO ausente e sigla manual não informada.");
                }

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    stats.total++;

                    let rawProj = "";
                    if (hasProjectCol) rawProj = row["Projeto"] || row["PROJETO"];
                    if (!rawProj) rawProj = manualCode;

                    const finalProj = normalizeProject(rawProj, row);

                    // Filtra linhas que não são do projeto alvo (se especificado)
                    if (!finalProj || (targetProject && finalProj !== targetProject)) {
                        stats.skippedEmpty++;
                        return;
                    }

                    // --- 1. Normalização Inicial ---
                    const normalizedRow: any = { ...row };
                    Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
                        const val = findValueInRow(row, orig);
                        if (val !== undefined) normalizedRow[dest] = val;
                    });

                    // --- 2. Tratamento de Status ---
                    let status = String(
                        normalizedRow["Status"] ||
                        normalizedRow["Status Faturamento"] ||
                        normalizedRow["Status Pagamento"] ||
                        ""
                    ).trim();

                    const statusLower = status.toLowerCase();

                    // Regras de exclusão por status
                    const isInvalidStatus =
                        status === "" ||
                        statusLower.includes('não emitido') ||
                        statusLower.includes('nao emitido') ||
                        statusLower.includes('não faturado') ||
                        statusLower.includes('nao faturado') ||
                        statusLower.includes('pendente');
                    // Removido 'aprovado' da lista de exclusão para EGS, pois pode ser uma fatura válida aguardando envio

                    if (isInvalidStatus) {
                        stats.skippedStatus++;
                        return;
                    }

                    // Normalização específica EGS
                    if (finalProj === 'EGS') {
                        if (statusLower.includes('quitado parc')) status = 'Acordo';
                        else if (statusLower.includes('pago') || statusLower.includes('quitado')) status = 'Pago';
                        else if (statusLower.includes('atrasado') || statusLower.includes('atraso')) status = 'Atrasado';
                        else if (statusLower.includes('acordo') || statusLower.includes('negociado')) status = 'Acordo';
                        else if (statusLower.includes('aprovado')) status = 'Aberto'; // Assume Aberto se aprovado
                    } else {
                        if (statusLower.includes("cancelad")) {
                            stats.skippedCancelled++;
                            return;
                        }
                    }

                    // Capitalização
                    status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

                    // --- 3. Verificação de Data (Corte) ---
                    const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
                    const skipCheck = shouldSkipRow(refDate, cutoffDate, status);

                    if (skipCheck.shouldSkip) {
                        if (skipCheck.reason === 'old_date') stats.skippedOld++;
                        else if (skipCheck.reason === 'cancelled') stats.skippedCancelled++;
                        return;
                    }

                    // --- 4. Construção da Linha Final ---
                    const newRow: Record<string, any> = {};
                    newRow["PROJETO"] = finalProj;

                    FINAL_HEADERS.forEach(key => {
                        if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
                    });

                    newRow["Status"] = status;

                    // Validação final de Data de Emissão (necessária para cálculos)
                    const dataEmissaoRaw = normalizedRow["Data de Emissão"] || normalizedRow["Data emissão"];
                    const dataEmissaoParsed = parseExcelDate(dataEmissaoRaw);

                    // Se não tem data de emissão válida, geralmente é lixo ou rodapé
                    if (!dataEmissaoParsed || isNaN(dataEmissaoParsed.getTime())) {
                        stats.skippedEmpty++;
                        return;
                    }

                    // Formatadores
                    if (normalizedRow["Telefone"]) newRow["Telefone"] = String(normalizedRow["Telefone"]).trim();
                    if (normalizedRow["E-mail"] || normalizedRow["E-MAIL DO PAGADOR"]) {
                        newRow["E-mail"] = String(normalizedRow["E-mail"] || normalizedRow["E-MAIL DO PAGADOR"]).trim();
                    }
                    if (normalizedRow["Crédito kWh"]) newRow["Crédito kWh"] = parseCurrency(normalizedRow["Crédito kWh"]);
                    if (normalizedRow["ID Boleto/Pix"]) newRow["ID Boleto/Pix"] = String(normalizedRow["ID Boleto/Pix"]).trim();

                    if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
                    if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

                    if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);
                    if (dataEmissaoParsed) newRow["Data de Emissão"] = formatDateToBR(dataEmissaoParsed);

                    const dataVencimento = parseExcelDate(newRow["Vencimento"]);
                    if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

                    // Identificação mínima obrigatória
                    if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) {
                        stats.skippedEmpty++;
                        return;
                    }

                    // Valores Financeiros e Descontos
                    if (finalProj === 'EGS') newRow["Desconto contrato (%)"] = 0.25;
                    else if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;

                    const cSem = parseCurrency(newRow["Custo sem GD R$"]);
                    const cCom = parseCurrency(newRow["Custo com GD R$"]);

                    newRow["Custo sem GD R$"] = cSem;
                    newRow["Custo com GD R$"] = cCom;

                    if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);

                    // Cálculo Economia
                    let ecoVal = newRow["Economia R$"];
                    if (ecoVal && String(ecoVal).trim() !== "") {
                        newRow["Economia R$"] = parseCurrency(ecoVal);
                    } else {
                        newRow["Economia R$"] = calculateEconomySafe(cCom, cSem);
                    }

                    // Cálculo Dias Atraso
                    let dias = 0;
                    const statusPago = ['pago', 'quitado'].some(p => status.toLowerCase().includes(p));

                    if (!statusPago) {
                        dias = newRow["Dias Atrasados"] ? Number(newRow["Dias Atrasados"]) : calculateDaysLate(dataVencimento);
                        if (isNaN(dias)) dias = calculateDaysLate(dataVencimento);
                    }
                    newRow["Dias Atrasados"] = dias > 0 ? dias : 0;

                    // Risco
                    if (!newRow["Risco"]) {
                        newRow["Risco"] = determineRisk(null, newRow["Dias Atrasados"]);
                    }

                    newRow["Arquivo Origem"] = `${fileName} [${sheetName}]`;

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