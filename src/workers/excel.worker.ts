// src/workers/excel.worker.ts
import * as XLSX from 'xlsx';
import { parseExcelDate, formatDateToBR } from '../modules/dateParser';
import { parseCurrency, calculateEconomySafe } from '../modules/currencyMath';
import { calculateDaysLate, determineRisk, shouldSkipRow } from '../modules/businessRules';
import { normalizeInstallation, normalizeDistributor } from '../modules/stringNormalizer';
import { FINAL_HEADERS, EGS_MAPPING, PROJECT_MAPPING, VALID_PROJECT_CODES } from '../config/constants';

const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

// Normalização estrita de projeto
const normalizeProject = (raw: any, row: any): string | null => {
    let p = String(raw || "").trim().toUpperCase();
    if (!p) return null;

    let mapped = PROJECT_MAPPING[p] || p;

    if (mapped === 'EVD' || p.startsWith('ERA VERDE')) {
        const uf = String(row["UF"] || row["Estado"] || "").trim().toUpperCase();
        mapped = uf === 'MG' ? 'EMG' : 'ESP';
    }

    return VALID_PROJECT_CODES.includes(mapped) ? mapped : null;
};

const findValueInRow = (rowObj: any, keyName: string) => {
    if (rowObj[keyName] !== undefined) return rowObj[keyName];
    const cleanKey = String(keyName).trim().toLowerCase();
    const actualKey = Object.keys(rowObj).find(k => String(k).trim().toLowerCase() === cleanKey);
    return actualKey ? rowObj[actualKey] : undefined;
};

// Função auxiliar para mapear status conforme regras estritas
const mapStatus = (statusRaw: string): string | null => {
    const s = statusRaw.toLowerCase().trim();

    if (!s) return null; // Vazio

    // Regras de Exclusão (Ignorar)
    if (
        s === 'pendente' ||
        s === 'aprovado' ||
        s.includes('não emitido') ||
        s.includes('nao emitido') ||
        s.includes('não faturado') ||
        s.includes('nao faturado')
    ) {
        return null;
    }

    // Regras de Mapeamento (Prioridade para strings mais longas/específicas)
    if (s.includes('quitado parc')) return 'Acordo';
    if (s.includes('negociado')) return 'Acordo';
    if (s.includes('acordo')) return 'Acordo';

    if (s.includes('atrasado') || s.includes('atraso')) return 'Atrasado';

    if (s.includes('pago') || s.includes('quitado')) return 'Pago';

    // Se não caiu em nenhuma regra acima, mas tem valor, retorna capitalizado (ou null se preferir ser super estrito)
    // Para segurança, vamos assumir que se passou pelos filtros de exclusão, mantemos capitalizado.
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

self.onmessage = async (e: MessageEvent) => {
    const { action, fileBuffer, fileName, manualCode, cutoffDate, targetProject } = e.data;

    try {
        const workbook = XLSX.read(fileBuffer, { type: 'array' });

        if (action === 'analyze') {
            const detectedProjects = new Set<string>();
            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
                let headerRowIndex = -1;
                for (let i = 0; i < Math.min(rawData.length, 100); i++) {
                    const row = rawData[i];
                    if (!row || row.length === 0) continue;
                    const rowStr = row.map(c => String(c).toLowerCase());
                    if (rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)))) {
                        headerRowIndex = i; break;
                    }
                }
                if (headerRowIndex === -1) return;
                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];
                sheetData.forEach(row => {
                    const rawProj = row["Projeto"] || row["PROJETO"];
                    if (rawProj) {
                        const norm = normalizeProject(rawProj, row);
                        if (norm) detectedProjects.add(norm);
                    }
                });
            });
            self.postMessage({ success: true, projects: Array.from(detectedProjects) });
            return;
        }

        if (action === 'process') {
            const processedRows: any[] = [];
            const stats = {
                total: 0,
                processed: 0,
                skippedOld: 0,
                skippedCancelled: 0,
                skippedEmpty: 0,
                skippedStatus: 0
            };

            const currentProjCode = targetProject || (manualCode ? normalizeProject(manualCode, {}) : null);
            const isEGSContext = currentProjCode === 'EGS';

            console.log(`[WORKER] Iniciando: ${fileName} (${currentProjCode || 'N/A'})`);

            workbook.SheetNames.forEach(sheetName => {
                if (isEGSContext) {
                    const lowerName = sheetName.toLowerCase();
                    if (!lowerName.includes('faturamento') && !lowerName.includes('financeiro')) return;
                }

                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                let headerRowIndex = -1;
                for (let i = 0; i < Math.min(rawData.length, 50); i++) {
                    const row = rawData[i];
                    if (!row || row.length === 0) continue;
                    const rowStr = row.map(c => String(c).toLowerCase());
                    if (rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)))) {
                        const matches = rowStr.filter(cell => FINANCIAL_TERMS.some(term => cell.includes(term))).length;
                        if (matches >= 2) { headerRowIndex = i; break; }
                    }
                }

                if (headerRowIndex === -1) return;

                const headerRow = rawData[headerRowIndex].map(c => String(c).toUpperCase().trim());
                const hasProjectCol = headerRow.includes('PROJETO');

                if (!hasProjectCol && (!manualCode || manualCode.trim() === "")) {
                    throw new Error("Coluna PROJETO ausente e sigla manual não informada.");
                }

                const sheetData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" }) as any[];

                sheetData.forEach(row => {
                    stats.total++;

                    let rawProj = "";
                    if (hasProjectCol) rawProj = row["Projeto"] || row["PROJETO"];
                    if (!rawProj) rawProj = manualCode;

                    const finalProj = normalizeProject(rawProj, row);

                    if (!finalProj || (targetProject && finalProj !== targetProject)) {
                        stats.skippedEmpty++;
                        return;
                    }

                    const normalizedRow: any = { ...row };
                    Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
                        const val = findValueInRow(row, orig);
                        if (val !== undefined) normalizedRow[dest] = val;
                    });

                    // --- TRATAMENTO DE STATUS ESTRITO ---
                    const statusRaw = String(
                        normalizedRow["Status"] ||
                        normalizedRow["Status Faturamento"] ||
                        normalizedRow["Status Pagamento"] ||
                        ""
                    );

                    const finalStatus = mapStatus(statusRaw);

                    if (!finalStatus) {
                        stats.skippedStatus++;
                        return; // Ignora Pendente, Aprovado, Vazios, Não Emitido
                    }

                    if (finalStatus.toLowerCase().includes("cancelad")) {
                        stats.skippedCancelled++;
                        return;
                    }

                    // --- Verificação de Data (Corte) ---
                    const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
                    const skipCheck = shouldSkipRow(refDate, cutoffDate, finalStatus);

                    if (skipCheck.shouldSkip) {
                        if (skipCheck.reason === 'old_date') stats.skippedOld++;
                        else if (skipCheck.reason === 'cancelled') stats.skippedCancelled++;
                        return;
                    }

                    // --- Construção da Linha ---
                    const newRow: Record<string, any> = {};
                    newRow["PROJETO"] = finalProj;

                    FINAL_HEADERS.forEach(key => {
                        if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
                    });

                    newRow["Status"] = finalStatus;

                    const dataEmissaoRaw = normalizedRow["Data de Emissão"] || normalizedRow["Data emissão"];
                    const dataEmissaoParsed = parseExcelDate(dataEmissaoRaw);

                    if (!dataEmissaoParsed || isNaN(dataEmissaoParsed.getTime())) {
                        stats.skippedEmpty++;
                        return;
                    }

                    if (normalizedRow["Telefone"]) newRow["Telefone"] = String(normalizedRow["Telefone"]).trim();
                    if (normalizedRow["E-mail"] || normalizedRow["E-MAIL DO PAGADOR"]) {
                        newRow["E-mail"] = String(normalizedRow["E-mail"] || normalizedRow["E-MAIL DO PAGADOR"]).trim();
                    }
                    if (normalizedRow["Crédito kWh"]) newRow["Crédito kWh"] = parseCurrency(normalizedRow["Crédito kWh"]);
                    if (normalizedRow["ID Boleto/Pix"]) newRow["ID Boleto/Pix"] = String(normalizedRow["ID Boleto/Pix"]).trim();

                    if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
                    if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);

                    if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);
                    if (dataEmissaoParsed) newRow["Data de Emissão"] = formatDateToBR(dataEmissaoParsed);

                    const dataVencimento = parseExcelDate(newRow["Vencimento"]);
                    if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

                    if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) {
                        stats.skippedEmpty++;
                        return;
                    }

                    if (finalProj === 'EGS') newRow["Desconto contrato (%)"] = 0.25;
                    else if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;

                    const cSem = parseCurrency(newRow["Custo sem GD R$"]);
                    const cCom = parseCurrency(newRow["Custo com GD R$"]);

                    newRow["Custo sem GD R$"] = cSem;
                    newRow["Custo com GD R$"] = cCom;

                    if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);

                    let ecoVal = newRow["Economia R$"];
                    if (ecoVal && String(ecoVal).trim() !== "") {
                        newRow["Economia R$"] = parseCurrency(ecoVal);
                    } else {
                        newRow["Economia R$"] = calculateEconomySafe(cCom, cSem);
                    }

                    let dias = 0;
                    const statusPago = finalStatus === 'Pago'; // Agora normalizado

                    if (!statusPago) {
                        dias = newRow["Dias Atrasados"] ? Number(newRow["Dias Atrasados"]) : calculateDaysLate(dataVencimento);
                        if (isNaN(dias)) dias = calculateDaysLate(dataVencimento);
                    }
                    newRow["Dias Atrasados"] = dias > 0 ? dias : 0;

                    if (!newRow["Risco"]) {
                        newRow["Risco"] = determineRisk(null, newRow["Dias Atrasados"]);
                    }

                    newRow["Arquivo Origem"] = `${fileName} [${sheetName}]`;

                    processedRows.push(newRow);
                    stats.processed++;
                });
            });

            console.log(`[WORKER] Relatório Final (${fileName}):`, stats);
            self.postMessage({ success: true, rows: processedRows, stats });
        }

    } catch (error: any) {
        console.error("Worker Error:", error);
        self.postMessage({ success: false, error: error.message });
    }
};