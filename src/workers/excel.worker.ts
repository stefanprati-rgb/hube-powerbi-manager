// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { parseExcelDate } from '../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../modules/businessRules';
import { FINAL_HEADERS, EGS_MAPPING } from '../config/constants';

// --- Configurações de Mapeamento (Atualizado) ---
const PROJECT_MAPPING: Record<string, string> = {
    // Lua Nova
    'LN': 'LNV', 'LNV': 'LNV',
    'LUA NOVA': 'LNV', 'LUA NOVA ENERGIA': 'LNV',

    // Alagoas
    'ALA': 'ALA', 'ALAGOAS': 'ALA', 'ALAGOAS ENERGIA': 'ALA',

    // E3 Energia (Antiga EGS)
    'EGS': 'EGS', 'E3': 'EGS', 'E3 ENERGIA': 'EGS',

    // Matrix
    'MX': 'MTX', 'MTX': 'MTX', 'MATRIX': 'MTX',

    // Era Verde (Mapeamentos diretos se vierem escritos assim)
    'EMG': 'EMG', 'ERA VERDE ENERGIA - MG': 'EMG',
    'ESP': 'ESP', 'ERA VERDE ENERGIA - SP': 'ESP'
};

const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

self.onmessage = async (e: MessageEvent) => {
    const { fileBuffer, fileName, manualCode, cutoffDate } = e.data;

    try {
        const workbook = XLSX.read(fileBuffer, { type: 'array' });
        const processedRows: any[] = [];

        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

            // 1. Scan inteligente de cabeçalho
            let headerRowIndex = -1;
            let bestMatchCount = 0;

            for (let i = 0; i < Math.min(rawData.length, 50); i++) {
                const row = rawData[i];
                if (!row || row.length === 0) continue;
                const rowStr = row.map(c => String(c).toLowerCase());

                const hasId = rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)));
                const financialMatches = rowStr.filter(cell =>
                    FINANCIAL_TERMS.some(term => cell.includes(term))
                ).length;

                if (hasId && financialMatches >= 2) {
                    if (financialMatches > bestMatchCount) {
                        bestMatchCount = financialMatches;
                        headerRowIndex = i;
                    }
                }
            }

            if (headerRowIndex === -1) return;

            const sheetData = XLSX.utils.sheet_to_json(sheet, {
                range: headerRowIndex,
                defval: ""
            }) as any[];

            // 2. Processamento Linha a Linha
            sheetData.forEach(row => {
                const normalizedRow: any = { ...row };
                Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
                    if (row[orig] !== undefined) normalizedRow[dest] = row[orig];
                });

                // --- Filtros ---
                const rawRefDate = normalizedRow["Mês de Referência"] || normalizedRow["Referência"];
                const refDate = parseExcelDate(rawRefDate);
                const statusFat = normalizedRow["Status"] || normalizedRow["Status Faturamento"];

                const skipCheck = shouldSkipRow(refDate, cutoffDate, statusFat);
                if (skipCheck.shouldSkip) return;

                // --- Definição do Projeto ---
                let rawProj = String(normalizedRow["Projeto"] || normalizedRow["PROJETO"] || manualCode || "").trim().toUpperCase();
                let finalProj = "";

                // Verifica mapeamento direto primeiro (ex: "E3 ENERGIA" -> "EGS")
                if (PROJECT_MAPPING[rawProj]) {
                    finalProj = PROJECT_MAPPING[rawProj];
                }
                // Fallback para EVD Genérico: decide por UF
                else if (rawProj === 'EVD' || rawProj.startsWith('ERA VERDE')) {
                    const uf = String(normalizedRow["UF"] || normalizedRow["Estado"] || "").trim().toUpperCase();
                    finalProj = uf === 'MG' ? 'EMG' : 'ESP';
                } else {
                    finalProj = rawProj; // Mantém o original se não reconhecer
                }

                if (!finalProj || finalProj === "") return;

                // --- Construção da Nova Linha ---
                const newRow: Record<string, any> = {};
                newRow["PROJETO"] = finalProj;

                FINAL_HEADERS.forEach(key => {
                    if (key !== "PROJETO") {
                        newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
                    }
                });

                if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return;

                // --- Regra de Desconto (Apenas EGS/E3 Energia tem 25%) ---
                if (finalProj === 'EGS') {
                    newRow["Desconto contrato (%)"] = 0.25;
                } else {
                    if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;
                }

                // --- Cálculos ---
                const custoSemGD = parseCurrency(newRow["Custo sem GD R$"]);
                const custoComGD = parseCurrency(newRow["Custo com GD R$"]);
                newRow["Custo sem GD R$"] = custoSemGD;
                newRow["Custo com GD R$"] = custoComGD;

                if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);

                const ecoExistente = newRow["Economia R$"];
                if (ecoExistente !== undefined && String(ecoExistente).trim() !== "") {
                    newRow["Economia R$"] = String(ecoExistente).replace("R$", "").trim();
                } else {
                    newRow["Economia R$"] = calculateEconomySafe(custoComGD, custoSemGD);
                }

                // Datas e Risco
                const dataVencimento = parseExcelDate(newRow["Vencimento"]);
                const diasInput = newRow["Dias Atrasados"];
                let diasAtraso = diasInput ? Number(diasInput) : calculateDaysLate(dataVencimento);
                if (isNaN(diasAtraso)) diasAtraso = calculateDaysLate(dataVencimento);

                newRow["Dias Atrasados"] = diasAtraso;

                if (!newRow["Risco"]) {
                    newRow["Risco"] = determineRisk(newRow["Status"], diasAtraso);
                }

                newRow["Arquivo Origem"] = `${fileName} [${sheetName}]`;
                processedRows.push(newRow);
            });
        });

        self.postMessage({ success: true, rows: processedRows });

    } catch (error: any) {
        self.postMessage({ success: false, error: error.message });
    }
};