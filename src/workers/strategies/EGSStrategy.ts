// src/workers/strategies/EGSStrategy.ts
import { IProjectStrategy, ProcessingContext } from './IProjectStrategy';
import { parseExcelDate, formatDateToBR } from '../../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING } from '../../config/constants';

// Helpers
const findValueInRow = (rowObj: any, keyName: string) => {
    if (rowObj[keyName] !== undefined) return rowObj[keyName];
    const cleanKey = String(keyName).trim().toLowerCase();
    const actualKey = Object.keys(rowObj).find(k => String(k).trim().toLowerCase() === cleanKey);
    return actualKey ? rowObj[actualKey] : undefined;
};

// Relaxando o status para não perder linhas
const mapStatusStrict = (statusRaw: string): string => {
    const s = statusRaw.toLowerCase().trim();
    if (!s) return 'Aberto';
    if (s.includes('quitado parc') || s.includes('negociado') || s.includes('acordo')) return 'Negociado';
    if (s.includes('pago') || s.includes('quitado')) return 'Pago';
    if (s.includes('atrasado') || s.includes('atraso')) return 'Atrasado';
    return 'Aberto'; // Default seguro
};

export class EGSStrategy implements IProjectStrategy {
    name = 'EGS';

    matches(row: any, manualCode?: string): boolean {
        if (manualCode === 'EGS') return true;
        if (findValueInRow(row, "CUSTO_S_GD") !== undefined ||
            findValueInRow(row, "Obs Planilha Rubia") !== undefined) {
            return true;
        }
        return false;
    }

    process(row: any, context: ProcessingContext): any | null {
        // --- FILTROS ESPECÍFICOS EGS (RELAXADOS) ---

        // CORREÇÃO: O filtro "statusFat === aprovado" foi removido.
        // Ele estava descartando todas as linhas que não tinham faturamento explicitamente aprovado,
        // o que causava a perda de ~300 linhas.

        const statusPag = String(findValueInRow(row, "Status Pagamento") || "").toLowerCase().trim();
        // Mantemos apenas o filtro de cancelados explícitos
        if (statusPag.includes('cancelado')) return null;

        // --- MAPEAMENTO ---
        const normalizedRow: any = { ...row };
        Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
            const val = findValueInRow(row, orig);
            if (val !== undefined) normalizedRow[dest] = val;
        });

        const statusRaw = String(findValueInRow(row, "Status Pagamento") || "").trim();
        const finalStatus = mapStatusStrict(statusRaw);

        // --- DATA DE CORTE ---
        const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
        const skipCheck = shouldSkipRow(refDate, context.cutoffDate, finalStatus);
        if (skipCheck.shouldSkip) return null;

        // --- CONSTRUÇÃO ---
        const newRow: Record<string, any> = {};
        newRow["PROJETO"] = 'EGS';

        FINAL_HEADERS.forEach(key => {
            if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
        });

        newRow["Status"] = finalStatus;
        newRow["Cancelada"] = "Não";

        if (String(newRow["Juros e Multa"]).trim() === '-') {
            newRow["Juros e Multa"] = "";
        }

        // Desconto fixo de 25% (Number)
        newRow["Desconto contrato (%)"] = 0.25;

        // --- VALIDAÇÕES ---
        const dataEmissaoRaw = normalizedRow["Data de Emissão"] || normalizedRow["Data emissão"];
        const dataEmissaoParsed = parseExcelDate(dataEmissaoRaw);

        if (!dataEmissaoParsed || isNaN(dataEmissaoParsed.getTime())) return null;

        // --- FORMATAÇÃO NUMÉRICA (FLOAT) ---
        if (normalizedRow["Crédito kWh"]) newRow["Crédito kWh"] = parseCurrency(normalizedRow["Crédito kWh"]);
        if (normalizedRow["ID Boleto/Pix"]) newRow["ID Boleto/Pix"] = String(normalizedRow["ID Boleto/Pix"]).trim();

        if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
        if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

        if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);
        if (dataEmissaoParsed) newRow["Data de Emissão"] = formatDateToBR(dataEmissaoParsed);

        const dataVencimento = parseExcelDate(newRow["Vencimento"]);
        if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

        if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return null;

        const cSem = parseCurrency(newRow["Custo sem GD R$"]);
        const cCom = parseCurrency(newRow["Custo com GD R$"]);

        newRow["Custo sem GD R$"] = cSem;
        newRow["Custo com GD R$"] = cCom;

        if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);

        let ecoVal = newRow["Economia R$"];
        if (ecoVal && String(ecoVal).trim() !== "") {
            newRow["Economia R$"] = parseCurrency(ecoVal);
        } else {
            newRow["Economia R$"] = parseFloat(calculateEconomySafe(cCom, cSem));
        }

        ['Valor Bruto R$', 'Tarifa aplicada R$', 'Ajuste retroativo R$', 'Desconto extra',
            'Valor da cobrança R$', 'Valor Pago', 'Valor creditado R$'].forEach(field => {
                if (newRow[field]) newRow[field] = parseCurrency(newRow[field]);
            });

        // Risco
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

        if (context.fileName) {
            newRow["Arquivo Origem"] = context.fileName;
        }

        return newRow;
    }
}