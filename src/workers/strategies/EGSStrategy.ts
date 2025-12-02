// src/workers/strategies/EGSStrategy.ts
import { IProjectStrategy, ProcessingContext } from './IProjectStrategy';
import { parseExcelDate, formatDateToBR } from '../../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING } from '../../config/constants';

// Helpers Utilitários (Locais para manter isolamento)
const findValueInRow = (rowObj: any, keyName: string) => {
    if (rowObj[keyName] !== undefined) return rowObj[keyName];
    const cleanKey = String(keyName).trim().toLowerCase();
    const actualKey = Object.keys(rowObj).find(k => String(k).trim().toLowerCase() === cleanKey);
    return actualKey ? rowObj[actualKey] : undefined;
};

const formatNumberToBR = (value: number | string | null | undefined): string => {
    if (value === undefined || value === null || value === '') return "";
    if (typeof value === 'string' && value.includes(',')) return value;
    return String(value).replace('.', ',');
};

const mapStatusStrict = (statusRaw: string): string | null => {
    const s = statusRaw.toLowerCase().trim();
    if (!s) return null;
    if (s.includes('quitado parc') || s.includes('negociado') || s.includes('acordo')) return 'Negociado';
    if (s.includes('pago') || s.includes('quitado')) return 'Pago';
    if (s.includes('atrasado') || s.includes('atraso')) return 'Atrasado';
    return null;
};

export class EGSStrategy implements IProjectStrategy {
    name = 'EGS';

    matches(row: any, manualCode?: string): boolean {
        // 1. Verifica Manual
        if (manualCode === 'EGS') return true;

        // 2. Verifica "Assinatura" do arquivo EGS (Colunas exclusivas)
        if (findValueInRow(row, "CUSTO_S_GD") !== undefined ||
            findValueInRow(row, "Obs Planilha Rubia") !== undefined) {
            return true;
        }

        // 3. Verifica aba (Filtro simples para evitar falsos positivos em abas de resumo)
        // Isso geralmente é feito no Worker antes, mas aqui garantimos que se parece EGS, é EGS.
        return false;
    }

    process(row: any, context: ProcessingContext): any | null {
        // --- FILTROS ESPECÍFICOS EGS ---

        // 1. Filtro: Status Faturamento = "aprovado"
        const statusFat = String(findValueInRow(row, "Status Faturamento") || "").toLowerCase().trim();
        if (statusFat !== 'aprovado') return null;

        // 2. Filtro: Status Pagamento != "não faturado" e != "cancelado"
        const statusPag = String(findValueInRow(row, "Status Pagamento") || "").toLowerCase().trim();
        if (statusPag === 'não faturado' || statusPag.includes('cancelado')) return null;

        // --- MAPEAMENTO ---
        const normalizedRow: any = { ...row };
        Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
            const val = findValueInRow(row, orig);
            if (val !== undefined) normalizedRow[dest] = val;
        });

        // --- STATUS ---
        // Para EGS, a fonte da verdade é "Status Pagamento"
        const statusRaw = String(findValueInRow(row, "Status Pagamento") || "").trim();
        const finalStatus = mapStatusStrict(statusRaw);

        if (!finalStatus) return null;

        // --- DATA DE CORTE ---
        const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
        const skipCheck = shouldSkipRow(refDate, context.cutoffDate, finalStatus);
        if (skipCheck.shouldSkip) return null;

        // --- CONSTRUÇÃO DO OBJETO ---
        const newRow: Record<string, any> = {};
        newRow["PROJETO"] = 'EGS';

        FINAL_HEADERS.forEach(key => {
            if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
        });

        newRow["Status"] = finalStatus;

        // --- REGRAS DE NEGÓCIO EGS ---

        // 1. Forçar Cancelada = "Não"
        newRow["Cancelada"] = "Não";

        // 2. Limpar Multa/Juros se for "-"
        if (String(newRow["Juros e Multa"]).trim() === '-') {
            newRow["Juros e Multa"] = "";
        }

        // 3. Desconto fixo de 0.25 (25%)
        newRow["Desconto contrato (%)"] = formatNumberToBR(0.25);


        // --- VALIDAÇÕES E FORMATAÇÕES ---
        const dataEmissaoRaw = normalizedRow["Data de Emissão"] || normalizedRow["Data emissão"];
        const dataEmissaoParsed = parseExcelDate(dataEmissaoRaw);

        if (!dataEmissaoParsed || isNaN(dataEmissaoParsed.getTime())) return null;

        // Formatação Monetária BR
        if (normalizedRow["Crédito kWh"]) newRow["Crédito kWh"] = formatNumberToBR(parseCurrency(normalizedRow["Crédito kWh"]));
        if (normalizedRow["ID Boleto/Pix"]) newRow["ID Boleto/Pix"] = String(normalizedRow["ID Boleto/Pix"]).trim();

        if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
        if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

        if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);
        if (dataEmissaoParsed) newRow["Data de Emissão"] = formatDateToBR(dataEmissaoParsed);

        const dataVencimento = parseExcelDate(newRow["Vencimento"]);
        if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

        if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return null;

        // Custos e Economia
        const cSem = parseCurrency(newRow["Custo sem GD R$"]);
        const cCom = parseCurrency(newRow["Custo com GD R$"]);

        newRow["Custo sem GD R$"] = formatNumberToBR(cSem);
        newRow["Custo com GD R$"] = formatNumberToBR(cCom);

        if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = formatNumberToBR(parseCurrency(newRow["Valor Final R$"]));

        let ecoVal = newRow["Economia R$"];
        if (ecoVal && String(ecoVal).trim() !== "") {
            newRow["Economia R$"] = formatNumberToBR(parseCurrency(ecoVal));
        } else {
            newRow["Economia R$"] = formatNumberToBR(calculateEconomySafe(cCom, cSem));
        }

        // Outros campos monetários
        ['Valor Bruto R$', 'Tarifa aplicada R$', 'Ajuste retroativo R$', 'Desconto extra',
            'Valor da cobrança R$', 'Valor Pago', 'Valor creditado R$'].forEach(field => {
                if (newRow[field]) newRow[field] = formatNumberToBR(parseCurrency(newRow[field]));
            });

        // Risco e Atraso
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