// src/modules/dateParser.ts

/**
 * Converte Excel Serial Number para Date
 * Excel usa base: 1 de Janeiro de 1900 = dia 1
 * Mas há um bug histórico: Excel considera 1900 como ano bissexto (não é)
 * Fórmula correta: new Date(1900, 0, serial - 1)
 */
const excelSerialToDate = (serial: number): Date => {
    // Método correto: considerar que dia 1 = 01/01/1900
    // serial - 1 porque Excel começa no dia 1, não no dia 0
    return new Date(1900, 0, serial - 1);
};

export const parseExcelDate = (dateVal: any): Date | null => {
    if (!dateVal) return null;

    // 1. Se já for objeto Date
    if (dateVal instanceof Date) return isNaN(dateVal.getTime()) ? null : dateVal;

    // 2. Se for número (Serial do Excel)
    if (typeof dateVal === 'number') {
        // Range válido de datas Excel (1968 a 2064)
        if (dateVal > 25000 && dateVal < 60000) {
            return excelSerialToDate(dateVal);
        }
        // Se for número pequeno, pode ser timestamp em segundos
        if (dateVal > 1000000000 && dateVal < 2000000000) {
            return new Date(dateVal * 1000);
        }
        return null;
    }

    // 3. Se for String
    const s = String(dateVal).trim();

    // String que é apenas número (Excel Serial como string)
    // Ex: "45658" -> Janeiro/2025
    if (s.match(/^\d{5,}$/)) {
        const serial = parseFloat(s);
        if (!isNaN(serial) && serial > 25000 && serial < 60000) {
            return excelSerialToDate(serial);
        }
    }

    // Suporte para ISO YYYY-MM-DD (Comum em exportações de banco/sistemas novos)
    if (s.match(/^\d{4}-\d{2}-\d{2}/)) {
        // Ex: 2025-11-17 ou 2025-11-17T00:00:00
        const datePart = s.split('T')[0];
        const [y, m, d] = datePart.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    // Suporte para DD/MM/YYYY ou DD-MM-YYYY (Padrão BR)
    if (s.match(/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) {
        const parts = s.split(/[\/\-]/);
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const y = parseInt(parts[2], 10);
        // Ajuste para ano com 2 dígitos
        const fullYear = y < 100 ? y + 2000 : y;
        return new Date(fullYear, m, d);
    }

    // Suporte para MM-YYYY ou MM/YYYY (só mês e ano)
    if (s.match(/^\d{1,2}[\/\-]\d{4}$/)) {
        const parts = s.split(/[\/\-]/);
        const m = parseInt(parts[0], 10) - 1;
        const y = parseInt(parts[1], 10);
        return new Date(y, m, 1); // Primeiro dia do mês
    }

    // Fallback: tentar parse nativo
    const parsed = new Date(dateVal);
    return isNaN(parsed.getTime()) ? null : parsed;
};

export const formatDateToBR = (date: Date): string => {
    if (!date || isNaN(date.getTime())) return "";
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}-${m}-${y}`;
};