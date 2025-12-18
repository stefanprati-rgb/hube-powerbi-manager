// src/modules/dateParser.ts

export const parseExcelDate = (dateVal: any): Date | null => {
    if (!dateVal) return null;

    // 1. Se já for objeto Date
    if (dateVal instanceof Date) return isNaN(dateVal.getTime()) ? null : dateVal;

    // 2. Se for número (Serial do Excel)
    if (typeof dateVal === 'number') {
        // Excel base date: December 30, 1899
        // Ajuste básico para UTC para evitar problemas de fuso horário (-3h) ao converter
        const utc_days = Math.floor(dateVal - 25569);
        const utc_value = utc_days * 86400;
        return new Date(utc_value * 1000);
    }

    // 3. Se for String
    const s = String(dateVal).trim();

    // Suporte para ISO YYYY-MM-DD (Comum em exportações de banco/sistemas novos)
    if (s.match(/^\d{4}-\d{2}-\d{2}/)) {
        // Ex: 2025-11-17
        const [y, m, d] = s.split('-').map(Number);
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

    return null;
};

export const formatDateToBR = (date: Date): string => {
    if (!date || isNaN(date.getTime())) return "";
    const d = String(date.getUTCDate()).padStart(2, '0');
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const y = date.getUTCFullYear();
    return `${d}-${m}-${y}`;
};