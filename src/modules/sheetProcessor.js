import { FINAL_HEADERS, EGS_MAPPING } from '../config/constants';
import { parseExcelDate } from './dateParser';
import { parseCurrency, calculateEconomySafe } from './currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from './businessRules';

export const processSheetData = (sheetData, fileName, sheetName, manualCode, cutoffDateStr) => {
    const processedRows = [];

    const stats = {
        total: sheetData.length,
        processed: 0,
        skippedOld: 0,
        skippedCancelled: 0,
        skippedEmpty: 0
    };

    sheetData.forEach(row => {
        // --- Validação Prévia ---
        const rawRefDate = row["Referência"] || row["Mês de Referência"];
        const refDate = parseExcelDate(rawRefDate);
        const statusFat = row["Status Faturamento"];

        const skipCheck = shouldSkipRow(refDate, cutoffDateStr, statusFat);

        if (skipCheck.shouldSkip) {
            if (skipCheck.reason === 'cancelled') stats.skippedCancelled++;
            if (skipCheck.reason === 'old_date') stats.skippedOld++;
            return;
        }

        // --- Construção da Linha ---
        const newRow = {};
        FINAL_HEADERS.forEach(header => newRow[header] = "");

        // --- Preenchimento ---
        let projetoVal = row["Projeto"] || row["PROJETO"];
        if (manualCode) projetoVal = manualCode.toUpperCase();
        newRow["PROJETO"] = projetoVal || "";

        // Mapeamento
        Object.entries(EGS_MAPPING).forEach(([origem, destino]) => {
            if (row[origem] !== undefined) newRow[destino] = row[origem];
        });

        // Preenchimento Automático
        Object.keys(row).forEach(key => {
            if (FINAL_HEADERS.includes(key) && !newRow[key]) {
                newRow[key] = row[key];
            }
        });

        // --- Integridade ---
        if (!newRow["Instalação"] && !newRow["CNPJ/CPF"] && !newRow["Nome"]) {
            stats.skippedEmpty++;
            return;
        }

        // --- Cálculos ---
        newRow["Desconto contrato (%)"] = 0.25;

        const custoSemGD = parseCurrency(newRow["Custo sem GD R$"]);
        const custoComGD = parseCurrency(newRow["Custo com GD R$"]);
        newRow["Economia R$"] = calculateEconomySafe(custoComGD, custoSemGD);

        const vencimentoVal = row["Data Vencimento"] || row["Vencimento"];
        const dataVencimento = parseExcelDate(vencimentoVal);

        const diasAtraso = calculateDaysLate(dataVencimento);
        newRow["Dias Atrasados"] = diasAtraso;

        const statusRow = newRow["Status"];
        newRow["Risco"] = determineRisk(statusRow, diasAtraso);

        newRow["Arquivo Origem"] = `${fileName} [${sheetName}]`;

        processedRows.push(newRow);
        stats.processed++;
    });

    return { rows: processedRows, stats };
};