// src/workers/strategies/StandardStrategy.ts
import { IProjectStrategy, ProcessingContext } from './IProjectStrategy';
import { parseExcelDate, formatDateToBR } from '../../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING, PROJECT_MAPPING } from '../../config/constants';

// Projetos que esta estratégia aceita
const STANDARD_CODES = ['LNV', 'ALA', 'MTX'];

// Helpers Utilitários (Locais para a Estratégia)
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

export class StandardStrategy implements IProjectStrategy {
    name = 'STANDARD (LNV/ALA/MTX)';

    matches(row: any, manualCode?: string): boolean {
        // Tenta identificar o projeto pela coluna ou pelo código manual
        const rawProj = findValueInRow(row, "Projeto") || findValueInRow(row, "PROJETO") || manualCode;
        const p = String(rawProj || "").trim().toUpperCase();

        // Mapeia (ex: "LN" -> "LNV")
        const mapped = PROJECT_MAPPING[p] || p;

        // Verifica se é um dos códigos padrão suportados
        return STANDARD_CODES.includes(mapped);
    }

    process(row: any, context: ProcessingContext): any | null {
        // 1. Identificação do Projeto
        const rawProj = findValueInRow(row, "Projeto") || findValueInRow(row, "PROJETO") || context.manualCode;
        const p = String(rawProj || "").trim().toUpperCase();
        const finalProj = PROJECT_MAPPING[p] || p;

        // 2. Mapeamento de Colunas (EGS_MAPPING é o mapa geral de colunas)
        const normalizedRow: any = { ...row };
        Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
            const val = findValueInRow(row, orig);
            if (val !== undefined) normalizedRow[dest] = val;
        });

        // 3. Status
        const statusRaw = String(
            normalizedRow["Status"] ||
            normalizedRow["Status Faturamento"] ||
            normalizedRow["Status Pagamento"] ||
            ""
        ).trim();

        const finalStatus = mapStatusStrict(statusRaw);
        if (!finalStatus) return null; // Pula linha se status for inválido/ignorado

        // 4. Verificação de Data de Corte
        const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
        const skipCheck = shouldSkipRow(refDate, context.cutoffDate, finalStatus);

        if (skipCheck.shouldSkip) return null;

        // 5. Construção do Objeto Final
        const newRow: Record<string, any> = {};
        newRow["PROJETO"] = finalProj;

        FINAL_HEADERS.forEach(key => {
            if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
        });

        newRow["Status"] = finalStatus;

        // 6. Validações Essenciais
        const dataEmissaoRaw = normalizedRow["Data de Emissão"] || normalizedRow["Data emissão"];
        const dataEmissaoParsed = parseExcelDate(dataEmissaoRaw);
        if (!dataEmissaoParsed || isNaN(dataEmissaoParsed.getTime())) return null;

        if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return null;

        // 7. Normalizações e Formatações
        if (normalizedRow["Crédito kWh"]) newRow["Crédito kWh"] = formatNumberToBR(parseCurrency(normalizedRow["Crédito kWh"]));
        if (normalizedRow["ID Boleto/Pix"]) newRow["ID Boleto/Pix"] = String(normalizedRow["ID Boleto/Pix"]).trim();

        if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
        if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

        if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);
        if (dataEmissaoParsed) newRow["Data de Emissão"] = formatDateToBR(dataEmissaoParsed);

        const dataVencimento = parseExcelDate(newRow["Vencimento"]);
        if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

        // Desconto Padrão (0 para Standard)
        newRow["Desconto contrato (%)"] = formatNumberToBR(0);

        // Cálculos Financeiros
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

        // Formatação de outros campos monetários
        ['Valor Bruto R$', 'Tarifa aplicada R$', 'Ajuste retroativo R$', 'Desconto extra',
            'Valor da cobrança R$', 'Valor Pago', 'Valor creditado R$'].forEach(field => {
                if (newRow[field]) newRow[field] = formatNumberToBR(parseCurrency(newRow[field]));
            });

        // 8. Cálculo de Atraso e Risco
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

        // Metadados do Arquivo
        if (context.fileName) {
            newRow["Arquivo Origem"] = context.fileName;
        }

        return newRow;
    }
}