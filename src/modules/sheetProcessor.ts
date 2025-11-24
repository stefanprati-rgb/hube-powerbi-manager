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
        // --- 1. Normalização dos Dados (A "Tradução") ---
        const normalizedRow: any = { ...row };

        // Aplica o mapa de equivalência (EGS -> Sistema)
        Object.entries(EGS_MAPPING).forEach(([colunaOrigem, colunaDestino]) => {
            // Se a linha tem a coluna "Valor sem desconto", copia o valor para "Custo sem GD R$"
            if (row[colunaOrigem] !== undefined && row[colunaOrigem] !== null) {
                normalizedRow[colunaDestino] = row[colunaOrigem];
            }
        });

        // --- 2. Validação de Data e Status ---
        // Agora buscamos na chave normalizada (ex: "Mês de Referência")
        const rawRefDate = normalizedRow["Mês de Referência"];
        const refDate = parseExcelDate(rawRefDate);

        // Status também normalizado
        const statusFat = normalizedRow["Status"] || normalizedRow["Status Faturamento"];

        const skipCheck = shouldSkipRow(refDate, cutoffDateStr, statusFat);

        if (skipCheck.shouldSkip) {
            if (skipCheck.reason === 'cancelled') stats.skippedCancelled++;
            if (skipCheck.reason === 'old_date') stats.skippedOld++;
            return;
        }

        // --- 3. Construção da Linha Final ---
        const newRow: Record<string, any> = {};

        // Inicializa todas as colunas vazias
        FINAL_HEADERS.forEach(header => newRow[header] = "");

        // Preenche PROJETO
        let projetoVal = normalizedRow["Projeto"] || normalizedRow["PROJETO"];
        if (manualCode) projetoVal = manualCode.toUpperCase();
        newRow["PROJETO"] = projetoVal || "";

        // Preenche dados mapeados
        FINAL_HEADERS.forEach(key => {
            if (normalizedRow[key] !== undefined) {
                newRow[key] = normalizedRow[key];
            }
        });

        // --- 4. Verificação de Integridade Básica ---
        // Se não tem Instalação, CNPJ ou Nome, provavelmente é linha vazia ou lixo
        if (!newRow["Instalação"] && !newRow["CNPJ/CPF"] && !newRow["Nome"]) {
            stats.skippedEmpty++;
            return;
        }

        // --- 5. Tratamento de Valores Monetários e Cálculos ---
        newRow["Desconto contrato (%)"] = 0.25; // Padrão hardcoded ou extrair se houver coluna

        // Parse robusto de moeda (aceita número ou texto formatado)
        // Note que pegamos já do newRow, pois o mapping já jogou os valores para as chaves certas
        const custoSemGD = parseCurrency(newRow["Custo sem GD R$"]);
        const custoComGD = parseCurrency(newRow["Custo com GD R$"]);

        // Reescreve os valores limpos no objeto
        newRow["Custo sem GD R$"] = custoSemGD;
        newRow["Custo com GD R$"] = custoComGD;

        // Se veio "Valor Final R$" da planilha (antigo Valor Emitido), usamos ele.
        // Se não, calculamos? Normalmente o sistema recalcula ou valida.
        // Vamos garantir que seja numérico:
        if (newRow["Valor Final R$"]) {
            newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);
        }

        // Cálculo de Economia
        newRow["Economia R$"] = calculateEconomySafe(custoComGD, custoSemGD);

        // Tratamento de Datas
        const dataVencimento = parseExcelDate(newRow["Vencimento"]);
        // Opcional: formatar dataVencimento de volta para string se necessário para o CSV

        // Cálculo de Atraso e Risco
        const diasAtraso = calculateDaysLate(dataVencimento);
        newRow["Dias Atrasados"] = diasAtraso;
        newRow["Risco"] = determineRisk(newRow["Status"], diasAtraso);

        // Metadados
        newRow["Arquivo Origem"] = `${fileName} [${sheetName}]`;
        // Se a planilha EGS tem coluna 'Região', ela já foi mapeada se estiver em FINAL_HEADERS.
        // Caso contrário, pode ser adicionada manualmente se necessário.

        processedRows.push(newRow);
        stats.processed++;
    });

    return { rows: processedRows, stats };
};