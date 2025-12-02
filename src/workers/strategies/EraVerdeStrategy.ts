// src/workers/strategies/EraVerdeStrategy.ts
import { IProjectStrategy, ProcessingContext } from './IProjectStrategy';
import { parseExcelDate, formatDateToBR } from '../../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING, PROJECT_MAPPING } from '../../config/constants';

// Helpers Utilitários (Locais)
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

export class EraVerdeStrategy implements IProjectStrategy {
    name = 'ERA VERDE (EMG/ESP)';

    matches(row: any, manualCode?: string): boolean {
        // 1. Verifica Seleção Manual ou Coluna Projeto
        const rawProj = findValueInRow(row, "Projeto") || findValueInRow(row, "PROJETO") || manualCode;
        const p = String(rawProj || "").trim().toUpperCase();

        const mapped = PROJECT_MAPPING[p] || p;

        if (['EVD', 'EMG', 'ESP'].includes(mapped) || p.startsWith('ERA VERDE')) {
            return true;
        }

        // 2. Auto-detecção por Tipo de Contrato (se não houver indicação explicita)
        const tipoContrato = String(findValueInRow(row, "Tipo Contrato") || "").toLowerCase();
        if (tipoContrato.includes("eraverde")) {
            return true;
        }

        return false;
    }

    process(row: any, context: ProcessingContext): any | null {
        // --- RESOLUÇÃO DE SUB-PROJETO (EMG vs ESP) ---
        let finalProj = 'ESP'; // Valor padrão seguro

        // 1. Tenta identificar pela Distribuidora (Mais preciso)
        const distRaw = String(findValueInRow(row, "Distribuidora") || "").toLowerCase().trim();

        if (distRaw.includes('cemig')) {
            finalProj = 'EMG';
        } else if (distRaw.includes('cpfl') || distRaw.includes('paulista')) {
            finalProj = 'ESP';
        } else {
            // 2. Fallback: Tenta identificar pela UF
            const uf = String(findValueInRow(row, "UF") || findValueInRow(row, "Estado") || "").trim().toUpperCase();
            if (uf === 'MG') {
                finalProj = 'EMG';
            } else {
                finalProj = 'ESP'; // Se não for MG, assume SP (ESP)
            }
        }

        // Filtro de Projeto Alvo (Caso o usuário tenha filtrado especificamente "Era Verde MG" na UI)
        // Se o contexto tiver um manualCode específico (EMG ou ESP), verificamos se bate.
        // Se o manualCode for genérico (EVD), aceitamos ambos.
        if (context.manualCode) {
            const target = PROJECT_MAPPING[context.manualCode] || context.manualCode;
            if ((target === 'EMG' || target === 'ESP') && target !== finalProj) {
                // Se o usuário selecionou EXPLICITAMENTE um subprojeto e detectamos outro, 
                // tecnicamente poderíamos pular. Mas a regra atual é "corrigir" a seleção.
                // Mantemos o finalProj calculado como verdadeiro.
            }
        }

        // --- MAPEAMENTO DE DADOS ---
        const normalizedRow: any = { ...row };
        Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
            const val = findValueInRow(row, orig);
            if (val !== undefined) normalizedRow[dest] = val;
        });

        // --- STATUS ---
        const statusRaw = String(
            normalizedRow["Status"] ||
            normalizedRow["Status Faturamento"] ||
            normalizedRow["Status Pagamento"] ||
            ""
        ).trim();

        const finalStatus = mapStatusStrict(statusRaw);
        if (!finalStatus) return null;

        // --- DATA DE CORTE ---
        const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
        const skipCheck = shouldSkipRow(refDate, context.cutoffDate, finalStatus);
        if (skipCheck.shouldSkip) return null;

        // --- CONSTRUÇÃO DO OBJETO ---
        const newRow: Record<string, any> = {};
        newRow["PROJETO"] = finalProj; // Aqui entra o código correto (EMG ou ESP)

        FINAL_HEADERS.forEach(key => {
            if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
        });

        newRow["Status"] = finalStatus;

        // --- VALIDAÇÕES E FORMATAÇÕES ---
        const dataEmissaoRaw = normalizedRow["Data de Emissão"] || normalizedRow["Data emissão"];
        const dataEmissaoParsed = parseExcelDate(dataEmissaoRaw);

        if (!dataEmissaoParsed || isNaN(dataEmissaoParsed.getTime())) return null;
        if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return null;

        // Formatação Monetária
        if (normalizedRow["Crédito kWh"]) newRow["Crédito kWh"] = formatNumberToBR(parseCurrency(normalizedRow["Crédito kWh"]));
        if (normalizedRow["ID Boleto/Pix"]) newRow["ID Boleto/Pix"] = String(normalizedRow["ID Boleto/Pix"]).trim();

        if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
        if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

        if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);
        if (dataEmissaoParsed) newRow["Data de Emissão"] = formatDateToBR(dataEmissaoParsed);

        const dataVencimento = parseExcelDate(newRow["Vencimento"]);
        if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

        // Desconto Padrão (Era Verde não tem regra fixa de 0.25 como EGS, então segue o arquivo ou 0)
        if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;
        newRow["Desconto contrato (%)"] = formatNumberToBR(newRow["Desconto contrato (%)"]);

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

        // Outros campos
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