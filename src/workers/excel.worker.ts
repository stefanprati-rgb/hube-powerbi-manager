// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { parseExcelDate } from '../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../modules/businessRules';
import { FINAL_HEADERS, EGS_MAPPING } from '../config/constants';

const PROJECT_MAPPING: Record<string, string> = {
    'LN': 'LNV', 'LNV': 'LNV', 'LUA NOVA': 'LNV', 'LUA NOVA ENERGIA': 'LNV',
    'ALA': 'ALA', 'ALAGOAS': 'ALA', 'ALAGOAS ENERGIA': 'ALA',
    'EGS': 'EGS', 'E3': 'EGS', 'E3 ENERGIA': 'EGS',
    'MX': 'MTX', 'MTX': 'MTX', 'MATRIX': 'MTX',
    'EMG': 'EMG', 'ERA VERDE ENERGIA - MG': 'EMG',
    'ESP': 'ESP', 'ERA VERDE ENERGIA - SP': 'ESP'
};

const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

// Helper para normalizar nome do projeto
const normalizeProject = (raw: any, row: any): string => {
    let p = String(raw || "").trim().toUpperCase();
    if (PROJECT_MAPPING[p]) return PROJECT_MAPPING[p];

    // Lógica Era Verde
    if (p === 'EVD' || p.startsWith('ERA VERDE')) {
        const uf = String(row["UF"] || row["Estado"] || "").trim().toUpperCase();
        return uf === 'MG' ? 'EMG' : 'ESP';
    }

    return p; // Retorna original se não reconhecer
};

self.onmessage = async (e: MessageEvent) => {
    const { action, fileBuffer, fileName, manualCode, cutoffDate, targetProject } = e.data;

    try {
        const workbook = XLSX.read(fileBuffer, { type: 'array' });

        // --- MODO 1: ANÁLISE PRÉVIA (Para separar projetos na fila) ---
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

                // Coleta projetos únicos desta aba
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

        // --- MODO 2: PROCESSAMENTO (Gera dados finais) ---
        if (action === 'process') {
            const processedRows: any[] = [];

            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                // Scan cabeçalho (Repetido para garantir isolamento)
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

                // Validação de Coluna PROJETO
                const headerRow = rawData[headerRowIndex].map(c => String(c).toUpperCase().trim());
                const hasProjectCol = headerRow.includes('PROJETO') || headerRow.includes('PROJETO');

                if (!hasProjectCol && (!manualCode || manualCode.trim() === "")) {
                    throw new Error("Coluna PROJETO ausente. Digite a Sigla.");
                }

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    // 1. Define Projeto da Linha
                    let rawProj = "";
                    if (hasProjectCol) rawProj = row["Projeto"] || row["PROJETO"];
                    if (!rawProj) rawProj = manualCode; // Fallback

                    const finalProj = normalizeProject(rawProj, row);

                    // FILTRO CRÍTICO: Só processa se for o projeto alvo deste item da fila
                    // Se targetProject for undefined (modo genérico), processa tudo.
                    if (targetProject && finalProj !== targetProject) return;
                    if (!finalProj) return;

                    // 2. Normalização e Filtros
                    const normalizedRow: any = { ...row };
                    Object.entries(EGS_MAPPING).forEach(([orig, dest]) => { if (row[orig] !== undefined) normalizedRow[dest] = row[orig]; });

                    const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
                    const skipCheck = shouldSkipRow(refDate, cutoffDate, normalizedRow["Status"] || normalizedRow["Status Faturamento"]);
                    if (skipCheck.shouldSkip) return;

                    // 3. Construção da Linha
                    const newRow: Record<string, any> = {};
                    newRow["PROJETO"] = finalProj;

                    FINAL_HEADERS.forEach(key => {
                        if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
                    });

                    if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return;

                    // Regra EGS
                    if (finalProj === 'EGS') newRow["Desconto contrato (%)"] = 0.25;
                    else if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;

                    // Math
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