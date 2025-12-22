// src/workers/strategies/EraVerdeStrategy.ts
import { IProjectStrategy, ProcessingContext } from './IProjectStrategy';
import { parseExcelDate, formatDateToBR } from '../../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING, PROJECT_MAPPING } from '../../config/constants';

// Helpers
const findValueInRow = (rowObj: any, keyName: string) => {
    if (rowObj[keyName] !== undefined) return rowObj[keyName];
    const cleanKey = String(keyName).trim().toLowerCase();
    const actualKey = Object.keys(rowObj).find(k => String(k).trim().toLowerCase() === cleanKey);
    return actualKey ? rowObj[actualKey] : undefined;
};

// Relaxando status para evitar linhas faltantes
const mapStatusStrict = (statusRaw: string): string => {
    const s = statusRaw.toLowerCase().trim();
    if (!s) return 'Aberto';
    if (s.includes('quitado parc') || s.includes('negociado') || s.includes('acordo')) return 'Negociado';
    if (s.includes('pago') || s.includes('quitado')) return 'Pago';
    if (s.includes('atrasado') || s.includes('atraso')) return 'Atrasado';
    return 'Aberto';
};

export class EraVerdeStrategy implements IProjectStrategy {
    name = 'ERA VERDE (EMG/ESP)';

    matches(row: any, manualCode?: string): boolean {
        const rawProj = findValueInRow(row, "Projeto") || findValueInRow(row, "PROJETO") || manualCode;
        const p = String(rawProj || "").trim().toUpperCase();
        const mapped = PROJECT_MAPPING[p] || p;

        if (['EVD', 'EMG', 'ESP'].includes(mapped) || p.startsWith('ERA VERDE')) {
            return true;
        }
        const tipoContrato = String(findValueInRow(row, "Tipo Contrato") || "").toLowerCase();
        if (tipoContrato.includes("eraverde")) {
            return true;
        }
        return false;
    }

    process(row: any, context: ProcessingContext): any | null {
        let finalProj = 'ESP';
        const distRaw = String(findValueInRow(row, "Distribuidora") || "").toLowerCase().trim();

        if (distRaw.includes('cemig')) {
            finalProj = 'EMG';
        } else if (distRaw.includes('cpfl') || distRaw.includes('paulista')) {
            finalProj = 'ESP';
        } else {
            const uf = String(findValueInRow(row, "UF") || findValueInRow(row, "Estado") || "").trim().toUpperCase();
            if (uf === 'MG') {
                finalProj = 'EMG';
            } else {
                finalProj = 'ESP';
            }
        }

        if (context.manualCode) {
            // Lógica de filtro por projeto alvo removida - mantemos detecção automática
        }

        const normalizedRow: any = { ...row };
        Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
            const val = findValueInRow(row, orig);
            if (val !== undefined) normalizedRow[dest] = val;
        });

        const statusRaw = String(
            normalizedRow["Status"] ||
            normalizedRow["Status Faturamento"] ||
            normalizedRow["Status Pagamento"] ||
            ""
        ).trim();

        const finalStatus = mapStatusStrict(statusRaw);

        const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
        const skipCheck = shouldSkipRow(refDate, context.cutoffDate, finalStatus);
        if (skipCheck.shouldSkip) return null;

        const newRow: Record<string, any> = {};
        newRow["PROJETO"] = finalProj;

        FINAL_HEADERS.forEach(key => {
            if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
        });

        newRow["Status"] = finalStatus;

        const dataEmissaoRaw = normalizedRow["Data de Emissão"] || normalizedRow["Data emissão"];
        const dataEmissaoParsed = parseExcelDate(dataEmissaoRaw);

        // CORREÇÃO: Não descartar linhas sem Data de Emissão
        // Algumas linhas não possuem esta data preenchida
        if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return null;

        // --- FORMATAÇÃO NUMÉRICA (FLOAT) ---
        if (normalizedRow["Crédito kWh"]) newRow["Crédito kWh"] = parseCurrency(normalizedRow["Crédito kWh"]);
        if (normalizedRow["ID Boleto/Pix"]) newRow["ID Boleto/Pix"] = String(normalizedRow["ID Boleto/Pix"]).trim();

        if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
        if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

        if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);
        if (dataEmissaoParsed) newRow["Data de Emissão"] = formatDateToBR(dataEmissaoParsed);

        const dataVencimento = parseExcelDate(newRow["Vencimento"]);
        if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

        if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;
        // Garantindo que seja number, se vier string '0,2' parseCurrency resolve ou parseFloat
        if (typeof newRow["Desconto contrato (%)"] === 'string') {
            newRow["Desconto contrato (%)"] = parseCurrency(newRow["Desconto contrato (%)"]);
        }

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