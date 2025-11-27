// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { parseExcelDate, formatDateToBR } from '../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING, PROJECT_MAPPING, VALID_PROJECT_CODES } from '../config/constants';
// Importamos a definição do mapa para garantir a tipagem correta no worker
import type { EGSFinancialMap } from '../types';

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

// 2. Helper Robusto: Encontra coluna ignorando maiúsculas/minúsculas e espaços
const findValueInRow = (rowObj: any, keyName: string) => {
    if (rowObj[keyName] !== undefined) return rowObj[keyName];
    const cleanKey = String(keyName).trim().toLowerCase();
    const actualKey = Object.keys(rowObj).find(k => String(k).trim().toLowerCase() === cleanKey);
    return actualKey ? rowObj[actualKey] : undefined;
};

// 3. Helper: Gera chave única para cruzamento (Instalação Normalizada + Mês/Ano)
const generateKey = (install: any, dateVal: any): string => {
    const cleanInstall = normalizeInstallation(install);
    const date = parseExcelDate(dateVal);
    if (!cleanInstall || !date) return "";
    // Chave ex: "123456789_2025-05"
    return `${cleanInstall}_${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

self.onmessage = async (e: MessageEvent) => {
    const { action, fileBuffer, fileName, manualCode, cutoffDate, targetProject, egsFinancials } = e.data;

    try {
        const workbook = XLSX.read(fileBuffer, { type: 'array' });

        // --- MODO 1: ANÁLISE (Descobre projetos no arquivo) ---
        if (action === 'analyze') {
            const detectedProjects = new Set<string>();
            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                let headerRowIndex = -1;
                // Aumentamos scan para 100 para pegar cabeçalhos distantes em relatórios
                for (let i = 0; i < Math.min(rawData.length, 100); i++) {
                    const row = rawData[i];
                    if (!row || row.length === 0) continue;
                    const rowStr = row.map(c => String(c).toLowerCase());
                    const hasId = rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)));
                    // Regra relaxada para detectar relatórios complementares também
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

        // --- MODO NOVO: EXTRAÇÃO DE DADOS COMPLEMENTARES (EGS) ---
        if (action === 'extract_financials') {
            const financialMap: EGSFinancialMap = {};

            workbook.SheetNames.forEach(sheetName => {
                // Procura apenas abas relevantes como "Detalhe Por UC"
                if (!sheetName.toLowerCase().includes('detalhe')) return;

                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                // Scan específico para achar o cabeçalho do relatório EGS (pode estar na linha 10+)
                let headerRowIndex = -1;
                for (let i = 0; i < Math.min(rawData.length, 50); i++) {
                    const row = rawData[i];
                    if (!row) continue;
                    const rowStr = row.map(c => String(c).trim());
                    // Procura colunas chave específicas
                    if (rowStr.includes('CUSTO_C_GD') || rowStr.some(c => c.includes('Fatura real')) || rowStr.includes('Custo com GD R$')) {
                        headerRowIndex = i;
                        break;
                    }
                }
                if (headerRowIndex === -1) return;

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    // Mapeamento dinâmico
                    const install = findValueInRow(row, 'INSTALAÇÃO') || findValueInRow(row, 'INSTALACAO');
                    // Data de referência é crucial para cruzar o mês certo
                    const refDate = findValueInRow(row, 'REFERÊNCIA') || findValueInRow(row, 'MES_REF') || findValueInRow(row, 'dataEmissao');

                    if (!install || !refDate) return;

                    const key = generateKey(install, refDate);
                    if (!key) return;

                    const custoCom = parseCurrency(
                        findValueInRow(row, 'CUSTO_C_GD') ||
                        findValueInRow(row, 'Custo com GD R$') ||
                        findValueInRow(row, 'Fatura real+Boleto Gera Padrão')
                    );

                    const custoSem = parseCurrency(
                        findValueInRow(row, 'CUSTO_S_GD') ||
                        findValueInRow(row, 'Custo sem GD R$')
                    );

                    const economia = parseCurrency(
                        findValueInRow(row, 'Ganho Total (R$) Padrão') ||
                        findValueInRow(row, 'Economia R$')
                    );

                    financialMap[key] = {
                        custoComGD: custoCom,
                        custoSemGD: custoSem,
                        economia: economia
                    };
                });
            });

            self.postMessage({ success: true, data: financialMap });
            return;
        }

        // --- MODO 2: PROCESSAMENTO (Com Cruzamento e Normalização) ---
        if (action === 'process') {
            const processedRows: any[] = [];
            const currentProjCode = targetProject || (manualCode ? normalizeProject(manualCode, {}) : null);
            const isEGSContext = currentProjCode === 'EGS';

            const externalFinancials = egsFinancials as EGSFinancialMap | undefined;

            workbook.SheetNames.forEach(sheetName => {
                // REGRA EGS: Ignorar abas que não sejam "Faturamento"
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
                    // 1. Obter Projeto
                    let rawProj = "";
                    if (hasProjectCol) rawProj = row["Projeto"] || row["PROJETO"];
                    if (!rawProj) rawProj = manualCode;

                    const finalProj = normalizeProject(rawProj, row);
                    if (!finalProj) return;
                    if (targetProject && finalProj !== targetProject) return;

                    // 2. Normalização Robusta
                    const normalizedRow: any = { ...row };
                    Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
                        const val = findValueInRow(row, orig);
                        if (val !== undefined) normalizedRow[dest] = val;
                    });

                    // 3. Tratamento de Status (Regras Estritas)
                    let status = String(normalizedRow["Status"] || "").trim();
                    const statusLower = status.toLowerCase();

                    if (finalProj === 'EGS') {
                        if (statusLower.includes('quitado parc')) status = 'Negociado';
                        else if (statusLower === 'pago' || statusLower === 'quitado') status = 'PAGO';
                        else if (statusLower.includes('atrasado') || statusLower.includes('atraso')) status = 'ATRASADO';
                        else if (statusLower.includes('acordo') || statusLower.includes('negociado')) status = 'Negociado';
                        else return; // Filtra (Pendente, Cancelado, etc)
                    } else {
                        if (statusLower.includes("cancelad")) return;
                    }

                    const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
                    const skipCheck = shouldSkipRow(refDate, cutoffDate, status);
                    if (skipCheck.shouldSkip) return;

                    // 4. Construção da Nova Linha
                    const newRow: Record<string, any> = {};
                    newRow["PROJETO"] = finalProj;

                    FINAL_HEADERS.forEach(key => {
                        if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
                    });

                    newRow["Status"] = status;

                    // Normalizações Específicas
                    if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
                    if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

                    // Formatação de Datas
                    if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);

                    const dataEmissao = parseExcelDate(newRow["Data de Emissão"]);
                    if (dataEmissao) newRow["Data de Emissão"] = formatDateToBR(dataEmissao);
                    const dataVencimento = parseExcelDate(newRow["Vencimento"]);
                    if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

                    if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return;

                    if (finalProj === 'EGS') newRow["Desconto contrato (%)"] = 0.25;
                    else if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;

                    // --- CÁLCULOS E CRUZAMENTO FINANCEIRO ---
                    let cSem = parseCurrency(newRow["Custo sem GD R$"]);
                    let cCom = parseCurrency(newRow["Custo com GD R$"]);
                    let ecoVal = "";

                    // Lógica de Cruzamento: Tenta buscar dados do relatório complementar
                    if (finalProj === 'EGS' && externalFinancials) {
                        const key = generateKey(newRow["Instalação"], refDate);
                        const complement = externalFinancials[key];

                        if (complement) {
                            // Se encontrar no relatório complementar, usa esses valores (são mais precisos)
                            if (complement.custoSemGD > 0) cSem = complement.custoSemGD;
                            if (complement.custoComGD > 0) cCom = complement.custoComGD;
                            if (complement.economia) ecoVal = String(complement.economia);
                        }
                    }

                    newRow["Custo sem GD R$"] = cSem;
                    newRow["Custo com GD R$"] = cCom;
                    if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);

                    // Economia: Prioridade (1) Cruzamento/Planilha (2) Cálculo
                    if (!ecoVal && newRow["Economia R$"] && String(newRow["Economia R$"]).trim() !== "") {
                        ecoVal = String(newRow["Economia R$"]).replace("R$", "").trim();
                    }

                    if (ecoVal) {
                        newRow["Economia R$"] = ecoVal;
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