// src/utils/excelHelpers.ts
import * as XLSX from 'xlsx';
import { ExcelRow } from '../types';

// Palavras-chave obrigatórias para considerar que a aba é a correta (Billing)
const REQUIRED_KEYWORDS = [
    'Instalação',
    'Referência',
    'Valor',
    'Vencimento'
];

export const readExcelFile = (file: File): Promise<ExcelRow[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });

                let bestSheetName = '';
                let bestHeaderRow = 0;
                let maxMatches = 0;

                // --- 1. ITERAR SOBRE TODAS AS ABAS ---
                // Para encontrar qual delas é a de Faturamento/Cobrança
                workbook.SheetNames.forEach(sheetName => {
                    const sheet = workbook.Sheets[sheetName];

                    // Converte as primeiras 20 linhas para checar o cabeçalho
                    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                    for (let i = 0; i < Math.min(rawData.length, 20); i++) {
                        const row = rawData[i];
                        if (!row) continue;

                        // Conta quantas palavras-chave aparecem nesta linha
                        let matches = 0;
                        row.forEach(cell => {
                            if (typeof cell === 'string') {
                                // Verifica palavras-chave gerais e do mapeamento EGS
                                if (REQUIRED_KEYWORDS.some(k => cell.toLowerCase().includes(k.toLowerCase()))) {
                                    matches++;
                                }
                                // Pontos extras para termos específicos da EGS
                                if (cell.includes('Valor sem desconto') || cell.includes('Valor liberado')) {
                                    matches += 2;
                                }
                            }
                        });

                        // Se essa linha desta aba for a "campeã" até agora, salvamos ela
                        if (matches > maxMatches) {
                            maxMatches = matches;
                            bestSheetName = sheetName;
                            bestHeaderRow = i;
                        }
                    }
                });

                if (!bestSheetName || maxMatches < 2) {
                    throw new Error("Não foi possível identificar uma aba de faturamento válida neste arquivo.");
                }

                console.log(`Aba selecionada: '${bestSheetName}' (Cabeçalho na linha ${bestHeaderRow + 1})`);

                // --- 2. LER A ABA VENCEDORA ---
                const selectedSheet = workbook.Sheets[bestSheetName];
                const jsonData = XLSX.utils.sheet_to_json(selectedSheet, {
                    range: bestHeaderRow, // Começa da linha do cabeçalho detectado
                    defval: ""
                }) as ExcelRow[];

                resolve(jsonData);

            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = (error) => reject(error);
        reader.readAsBinaryString(file);
    });
};