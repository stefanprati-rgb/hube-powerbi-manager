// src/modules/dateParser.ts

export const parseExcelDate = (dateVal: any): Date | null => {
    try {
        if (!dateVal) return null;

        // Se já for objeto Date
        if (dateVal instanceof Date) return dateVal;

        // Se for número (Excel Serial Date)
        if (typeof dateVal === 'number') {
            return new Date(Math.round((dateVal - 25569) * 86400 * 1000));
        }

        // Se for string
        const strVal = String(dateVal).trim();

        // Formato pt-BR DD/MM/AAAA ou DD-MM-AAAA
        if (strVal.match(/^\d{1,2}[/-]\d{1,2}[/-]\d{4}/)) {
            const parts = strVal.split(/[-/]/);
            return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        }

        // Formato ISO YYYY-MM-DD
        if (strVal.includes('-') && strVal.split('-')[0].length === 4) {
            const parts = strVal.split('-');
            return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        }

        const parsed = new Date(dateVal);
        return isNaN(parsed.getTime()) ? null : parsed;

    } catch (e) {
        console.warn("Falha ao processar data:", dateVal);
        return null;
    }
};

export const formatDateToBR = (date: Date | null): string => {
    if (!date || isNaN(date.getTime())) return "";

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}/${month}/${year}`;
};