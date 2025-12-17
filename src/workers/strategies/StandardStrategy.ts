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

// REMOVIDO: formatNumberToBR (Agora retornamos números puros para o Excel somar corretamente)

const mapStatusStrict = (statusRaw: string): string => {
    const s = statusRaw.toLowerCase().trim();
    if (!s) return 'Aberto'; // Se vazio, assume Aberto (antes retornava null e pulava a linha)

    // 1. Negociados
    if (s.includes('quitado parc') || s.includes('negociado') || s.includes('acordo')) return 'Negociado';

    // 2. Pagos
    if (s.includes('pago') || s.includes('quitado') || s.includes('liquidado') || s.includes('baixado')) return 'Pago';

    // 3. Atrasados
    if (s.includes('atrasado') || s.includes('atraso') || s.includes('expirado') || s.includes('pendente')) return 'Atrasado';

    // 4. Em Aberto (Status padrão para "A vencer", "Emitido", etc)
    return 'Aberto';
};

export class StandardStrategy implements IProjectStrategy {
    name = 'STANDARD (LNV/ALA/MTX)';

    matches(row: any, manualCode?: string): boolean {
        const rawProj = findValueInRow(row, "Projeto") || findValueInRow(row, "PROJETO") || manualCode;
        const p = String(rawProj || "").trim().toUpperCase();
        const mapped = PROJECT_MAPPING[p] || p;
        return STANDARD_CODES.includes(mapped);
    }

    process(row: any, context: ProcessingContext): any | null {
        // 1. Identificação do Projeto
        const rawProj = findValueInRow(row, "Projeto") || findValueInRow(row, "PROJETO") || context.manualCode;
        const p = String(rawProj || "").trim().toUpperCase();
        const finalProj = PROJECT_MAPPING[p] || p;

        // 2. Mapeamento de Colunas
        const normalizedRow: any = { ...row };
        Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
            const val = findValueInRow(row, orig);
            if (val !== undefined) normalizedRow[dest] = val;
        });

        // CORREÇÃO: Busca por "Valor Consolidado" se "Valor Final R$" não existir
        // Isso resolve o problema de LNV/ALA com colunas novas
        if (normalizedRow["Valor Final R$"] === undefined) {
            const valConsolidado = findValueInRow(row, "Valor Consolidado") || findValueInRow(row, "Valor Consolidado R$");
            if (valConsolidado !== undefined) {
                normalizedRow["Valor Final R$"] = valConsolidado;
            }
        }

        // 3. Status
        const statusRaw = String(
            normalizedRow["Status"] ||
            normalizedRow["Status Faturamento"] ||
            normalizedRow["Status Pagamento"] ||
            ""
        ).trim();

        // Alterado para não retornar NULL e perder linhas
        const finalStatus = mapStatusStrict(statusRaw);

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
        if (!dataEmissaoParsed || isNaN(dataEmissaoParsed.getTime())) {
            // Se falhar data de emissão, tenta usar a de referência ou hoje para não perder a linha de cobrança
            // (Comentado: manter rigoroso se for essencial, mas para "não perder linhas", relaxar é melhor)
            return null;
        }

        if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return null;

        // 7. Normalizações e Formatações
        // IMPORTANTE: Agora retornamos NÚMEROS (parseCurrency direto) ao invés de strings formatadas
        if (normalizedRow["Crédito kWh"]) newRow["Crédito kWh"] = parseCurrency(normalizedRow["Crédito kWh"]);
        if (normalizedRow["ID Boleto/Pix"]) newRow["ID Boleto/Pix"] = String(normalizedRow["ID Boleto/Pix"]).trim();

        if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
        if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

        if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);
        if (dataEmissaoParsed) newRow["Data de Emissão"] = formatDateToBR(dataEmissaoParsed);

        const dataVencimento = parseExcelDate(newRow["Vencimento"]);
        if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

        // Desconto Padrão (Numérico)
        newRow["Desconto contrato (%)"] = 0;

        // Cálculos Financeiros (Mantendo como Number)
        const cSem = parseCurrency(newRow["Custo sem GD R$"]);
        const cCom = parseCurrency(newRow["Custo com GD R$"]);

        newRow["Custo sem GD R$"] = cSem;
        newRow["Custo com GD R$"] = cCom;

        if (newRow["Valor Final R$"]) {
            newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);
        } else {
            // Fallback se ainda estiver vazio
            newRow["Valor Final R$"] = 0;
        }

        let ecoVal = newRow["Economia R$"];
        if (ecoVal && String(ecoVal).trim() !== "") {
            newRow["Economia R$"] = parseCurrency(ecoVal);
        } else {
            // calculateEconomySafe retorna string, converter para float
            newRow["Economia R$"] = parseFloat(calculateEconomySafe(cCom, cSem));
        }

        // Outros campos monetários (Tudo Number)
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