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

        // --- 3. Construção e Validação de PROJETO ---
        const newRow: Record<string, any> = {};

        let projetoVal = normalizedRow["Projeto"] || normalizedRow["PROJETO"];
        if (manualCode && manualCode.trim() !== "") {
            projetoVal = manualCode.toUpperCase();
        }

        if (!projetoVal || String(projetoVal).trim() === "") {
            stats.skippedEmpty++;
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

        // --- 5. Cálculos Otimizados (Prioridade para dados existentes) ---

        // A. Desconto Contrato: Mantém o original da planilha se existir
        if (!newRow["Desconto contrato (%)"]) {
            newRow["Desconto contrato (%)"] = 0.25;
        }

        // B. Custos
        const custoSemGD = parseCurrency(newRow["Custo sem GD R$"]);
        const custoComGD = parseCurrency(newRow["Custo com GD R$"]);
        newRow["Custo sem GD R$"] = custoSemGD;
        newRow["Custo com GD R$"] = custoComGD;

        if (newRow["Valor Final R$"]) {
            newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);
        }

        // C. Economia (Blindagem contra valor negativo)
        const economiaExistente = newRow["Economia R$"];
        let economiaFinal = "";

        if (economiaExistente !== undefined && economiaExistente !== null && String(economiaExistente).trim() !== "") {
            // Se veio da planilha, verificamos se é negativo
            const econVal = parseCurrency(economiaExistente);
            if (econVal >= 0) {
                economiaFinal = String(economiaExistente);
            } else {
                // Se a planilha trouxe negativo, forçamos vazio
                economiaFinal = "";
            }
        } else {
            // Se não tem na planilha, calculamos
            economiaFinal = calculateEconomySafe(custoComGD, custoSemGD);
        }
        newRow["Economia R$"] = economiaFinal;

        // D. Dias de Atraso
        const dataVencimento = parseExcelDate(newRow["Vencimento"]);
        let diasAtraso: number;
        const diasInput = newRow["Dias Atrasados"] || normalizedRow["Dias de Atraso"];

        if (diasInput !== undefined && diasInput !== null && String(diasInput).trim() !== "") {
            diasAtraso = Number(diasInput);
            if (isNaN(diasAtraso)) {
                diasAtraso = calculateDaysLate(dataVencimento);
            }
        } else {
            diasAtraso = calculateDaysLate(dataVencimento);
        }
        newRow["Dias Atrasados"] = diasAtraso;

        // E. Risco
        // Prioriza o que veio da planilha (ex: "Alto" na aba MATRIX), se não tiver, calcula.
        if (newRow["Risco"] && String(newRow["Risco"]).trim() !== "") {
            // Mantém o risco original
        } else {
            newRow["Risco"] = determineRisk(newRow["Status"], diasAtraso);
        }

        newRow["Arquivo Origem"] = `${fileName} [${sheetName}]`;

        processedRows.push(newRow);
        stats.processed++;
    });

    return { rows: processedRows, stats };
};