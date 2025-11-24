// src/utils/excelHelpers.ts
import * as XLSX from 'xlsx';
import { ExcelRow } from '../types';

// Palavras-chave para identificar se a aba é útil
// Para ser aceita, a aba TEM que ter "Instalação" E pelo menos um termo financeiro/temporal
const REQUIRED_ID_COLUMN = ['instalação', 'instalacao'];
const FINANCIAL_TERMS = ['valor', 'custo', 'tarifa', 'total', 'referência', 'vencimento'];

export interface SheetResult {
    sheetName: string;
    rows: ExcelRow[];
}

export const readExcelFile = (file: File): Promise<SheetResult[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const validSheets: SheetResult[] = [];

                // Percorre TODAS as abas do arquivo
                workbook.SheetNames.forEach(sheetName => {
                    const sheet = workbook.Sheets[sheetName];

                    // Leitura exploratória para detectar cabeçalho (scan de 20 linhas)
                    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                    let headerRowIndex = -1;
                    let bestMatchCount = 0;

                    for (let i = 0; i < Math.min(rawData.length, 20); i++) {
                        const row = rawData[i];
                        if (!row || row.length === 0) continue;

                        const rowStr = row.map(c => String(c).toLowerCase());

                        // 1. Verifica se tem a coluna Mestra (Instalação)
                        const hasId = rowStr.some(cell => REQUIRED_ID_COLUMN.some(k => cell.includes(k)));

                        // 2. Verifica se tem termos financeiros (para diferenciar de abas de cadastro/contatos)
                        const financialMatches = rowStr.filter(cell =>
                            FINANCIAL_TERMS.some(term => cell.includes(term))
                        ).length;

                        // Critério de Aceite: Tem ID (Instalação) e pelo menos 2 termos financeiros/datas
                        if (hasId && financialMatches >= 2) {
                            // Se acharmos uma linha melhor que a anterior, usamos ela
                            if (financialMatches > bestMatchCount) {
                                bestMatchCount = financialMatches;
                                headerRowIndex = i;
                            }
                        }
                    }

                    // Se encontramos um cabeçalho válido, processamos a aba
                    if (headerRowIndex !== -1) {
                        console.log(`[${file.name}] Aba aceita: '${sheetName}' (Cabeçalho na linha ${headerRowIndex + 1})`);

                        const jsonData = XLSX.utils.sheet_to_json(sheet, {
                            range: headerRowIndex,
                            defval: ""
                        }) as ExcelRow[];

                        if (jsonData.length > 0) {
                            validSheets.push({
                                sheetName: sheetName,
                                rows: jsonData
                            });
                        }
                    } else {
                        console.log(`[${file.name}] Aba ignorada: '${sheetName}' (Não parece ser faturamento)`);
                    }
                });

                if (validSheets.length === 0) {
                    throw new Error("Nenhuma aba válida de cobrança/faturamento encontrada neste arquivo.");
                }

                resolve(validSheets);

            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = (error) => reject(error);
        reader.readAsBinaryString(file);
    });
};