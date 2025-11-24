// src/modules/sheetProcessor.ts
import { FINAL_HEADERS, EGS_MAPPING } from '../config/constants';
import { parseExcelDate } from './dateParser';
import { parseCurrency, calculateEconomySafe } from './currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from './businessRules';
import { ExcelRow, ProcessResult } from '../types';

export const processSheetData = (
    sheetData: ExcelRow[],
    fileName: string,
    sheetName: string,
    manualCode: string,
    cutoffDateStr?: string
): ProcessResult => {
    const processedRows: any[] = [];

    const stats = {
        total: sheetData.length,
        processed: 0,
        skippedOld: 0,
        skippedCancelled: 0,
        skippedEmpty: 0
    };

    sheetData.forEach(row => {
        // --- 1. Normalização dos Dados ---
        const normalizedRow: any = { ...row };
        Object.entries(EGS_MAPPING).forEach(([colunaOrigem, colunaDestino]) => {
            if (row[colunaOrigem] !== undefined && row[colunaOrigem] !== null) {
                normalizedRow[colunaDestino] = row[colunaOrigem];
            }
        });

        // --- 2. Validação Prévia ---
        const rawRefDate = normalizedRow["Mês de Referência"] || normalizedRow["Referência"];
        const refDate = parseExcelDate(rawRefDate);
        const statusFat = normalizedRow["Status"] || normalizedRow["Status Faturamento"];
        const skipCheck = shouldSkipRow(refDate, cutoffDateStr, statusFat);

        if (skipCheck.shouldSkip) {
            if (skipCheck.reason === 'cancelled') stats.skippedCancelled++;
            if (skipCheck.reason === 'old_date') stats.skippedOld++;
            return;
        }

        // --- 3. Construção e Validação de PROJETO (CRÍTICO) ---
        const newRow: Record<string, any> = {};

        let projetoVal = normalizedRow["Projeto"] || normalizedRow["PROJETO"];
        // Se o usuário digitou um código manual, ele SOBRESCREVE o da planilha
        if (manualCode && manualCode.trim() !== "") {
            projetoVal = manualCode.toUpperCase();
        }

        // REGRA DE OURO: Se não tem projeto, a linha não pode existir no relatório
        if (!projetoVal || String(projetoVal).trim() === "") {
            stats.skippedEmpty++; // Contamos como erro de integridade
            return;
        }

        newRow["PROJETO"] = String(projetoVal).trim().toUpperCase();

        // --- 4. Preenchimento do Restante ---
        FINAL_HEADERS.forEach(header => {
            if (header !== "PROJETO") newRow[header] = "";
        });

        FINAL_HEADERS.forEach(key => {
            if (key !== "PROJETO" && normalizedRow[key] !== undefined) {
                newRow[key] = normalizedRow[key];
            }
        });

        if (!newRow["Instalação"] && !newRow["CNPJ/CPF"] && !newRow["Nome"]) {
            stats.skippedEmpty++;
            return;
        }

        // --- 5. Cálculos ---
        newRow["Desconto contrato (%)"] = 0.25;

        const custoSemGD = parseCurrency(newRow["Custo sem GD R$"]);
        const custoComGD = parseCurrency(newRow["Custo com GD R$"]);
        newRow["Custo sem GD R$"] = custoSemGD;
        newRow["Custo com GD R$"] = custoComGD;

        if (newRow["Valor Final R$"]) {
            newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);
        }

        newRow["Economia R$"] = calculateEconomySafe(custoComGD, custoSemGD);

        const dataVencimento = parseExcelDate(newRow["Vencimento"]);
        const diasAtraso = calculateDaysLate(dataVencimento);
        newRow["Dias Atrasados"] = diasAtraso;
        newRow["Risco"] = determineRisk(newRow["Status"], diasAtraso);

        newRow["Arquivo Origem"] = `${fileName} [${sheetName}]`;

        processedRows.push(newRow);
        stats.processed++;
    });

    return { rows: processedRows, stats };
};