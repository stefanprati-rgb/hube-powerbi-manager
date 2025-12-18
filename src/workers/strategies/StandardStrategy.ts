// src/workers/strategies/StandardStrategy.ts
import { IProjectStrategy, ProcessingContext } from './IProjectStrategy';
import { parseExcelDate, formatDateToBR } from '../../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING, PROJECT_MAPPING } from '../../config/constants';

const STANDARD_CODES = ['LNV', 'ALA', 'MTX'];

const findValueInRow = (rowObj: any, keyName: string) => {
    if (rowObj[keyName] !== undefined) return rowObj[keyName];
    const cleanKey = String(keyName).trim().toLowerCase();
    const actualKey = Object.keys(rowObj).find(k => String(k).trim().toLowerCase() === cleanKey);
    return actualKey ? rowObj[actualKey] : undefined;
};

const mapStatusStrict = (statusRaw: string): string => {
    const s = statusRaw.toLowerCase().trim();
    if (!s) return 'Aberto';
    if (s.includes('quitado parc') || s.includes('negociado') || s.includes('acordo')) return 'Negociado';
    if (s.includes('pago') || s.includes('quitado') || s.includes('liquidado') || s.includes('baixado')) return 'Pago';
    if (s.includes('atrasado') || s.includes('atraso') || s.includes('expirado') || s.includes('pendente')) return 'Atrasado';
    return 'Aberto';
};

export class StandardStrategy implements IProjectStrategy {
    name = 'STANDARD (LNV/ALA/MTX)';

    matches(row: any, manualCode?: string): boolean {
        // 1. Manual
        if (manualCode && STANDARD_CODES.includes(manualCode)) return true;

        // 2. Coluna Projeto
        const rawProj = findValueInRow(row, "Projeto") || findValueInRow(row, "PROJETO");
        if (rawProj) {
            const p = String(rawProj).trim().toUpperCase();
            const mapped = PROJECT_MAPPING[p] || p;
            if (STANDARD_CODES.includes(mapped)) return true;
        }

        // 3. Genérico (para contagem na Análise)
        const temInstalacao = findValueInRow(row, "Instalação") !== undefined;
        const temValor = findValueInRow(row, "Valor Final R$") !== undefined ||
            findValueInRow(row, "Valor Consolidado") !== undefined ||
            findValueInRow(row, "Total calculado R$") !== undefined;

        if (temInstalacao && temValor) return true;

        return false;
    }

    process(row: any, context: ProcessingContext): any | null {
        // 1. Identificação do Projeto
        let finalProj = '';
        if (context.manualCode && STANDARD_CODES.includes(context.manualCode)) {
            finalProj = context.manualCode;
        } else {
            const rawProj = findValueInRow(row, "Projeto") || findValueInRow(row, "PROJETO");
            const p = String(rawProj || "").trim().toUpperCase();
            finalProj = PROJECT_MAPPING[p] || p;
        }
        if (!finalProj || !STANDARD_CODES.includes(finalProj)) {
            finalProj = 'A Definir';
        }

        // 2. Mapeamento de Colunas
        const normalizedRow: any = { ...row };
        Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
            const val = findValueInRow(row, orig);
            if (val !== undefined) normalizedRow[dest] = val;
        });

        if (normalizedRow["Valor Final R$"] === undefined) {
            const valConsolidado = findValueInRow(row, "Valor Consolidado") || findValueInRow(row, "Valor Consolidado R$");
            if (valConsolidado !== undefined) normalizedRow["Valor Final R$"] = valConsolidado;
        }

        // 3. Status
        const statusRaw = String(normalizedRow["Status"] || normalizedRow["Status Faturamento"] || normalizedRow["Status Pagamento"] || "").trim();
        const finalStatus = mapStatusStrict(statusRaw);

        // 4. VERIFICAÇÃO DE DATA DE CORTE (Melhorada)
        const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);

        // Durante análise (sem cutoffDate), não skipamos
        if (context.cutoffDate) {
            const skipCheck = shouldSkipRow(refDate, context.cutoffDate, finalStatus);
            // ALTERAÇÃO: Retorna objeto especial se for pulado, em vez de null
            if (skipCheck.shouldSkip) {
                return { _skipped: true, reason: 'cutoff' };
            }
        }

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

        // Se data inválida durante processamento real (não análise), conta como erro de validação
        if (finalProj !== 'A Definir') {
            if (!dataEmissaoParsed || isNaN(dataEmissaoParsed.getTime())) {
                return { _skipped: true, reason: 'validation' };
            }
        }

        if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) {
            return { _skipped: true, reason: 'validation' };
        }

        // 7. Formatações
        if (normalizedRow["Crédito kWh"]) newRow["Crédito kWh"] = parseCurrency(normalizedRow["Crédito kWh"]);
        if (normalizedRow["ID Boleto/Pix"]) newRow["ID Boleto/Pix"] = String(normalizedRow["ID Boleto/Pix"]).trim();
        if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
        if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);
        if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);
        if (dataEmissaoParsed) newRow["Data de Emissão"] = formatDateToBR(dataEmissaoParsed);

        const dataVencimento = parseExcelDate(newRow["Vencimento"]);
        if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

        newRow["Desconto contrato (%)"] = 0;

        const cSem = parseCurrency(newRow["Custo sem GD R$"]);
        const cCom = parseCurrency(newRow["Custo com GD R$"]);
        newRow["Custo sem GD R$"] = cSem;
        newRow["Custo com GD R$"] = cCom;
        newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"] || 0);

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

        if (context.fileName) {
            newRow["Arquivo Origem"] = context.fileName;
        }

        return newRow;
    }
}