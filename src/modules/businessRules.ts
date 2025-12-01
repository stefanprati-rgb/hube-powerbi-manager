// src/modules/businessRules.ts

export const calculateDaysLate = (dataVencimento: Date | null): number => {
    if (!dataVencimento || isNaN(dataVencimento.getTime())) return 0;

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const vencimento = new Date(dataVencimento);
    vencimento.setHours(0, 0, 0, 0);

    const diffTime = hoje.getTime() - vencimento.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays > 0 ? diffDays : 0;
};

export const determineRisk = (status: any, daysLate: number): string => {
    // ATUALIZADO: Risco baseado APENAS em dias de atraso
    // Status não influencia mais o risco

    if (daysLate === 0) return "Nenhum";
    if (daysLate <= 30) return "Baixo";
    if (daysLate <= 90) return "Médio";
    return "Alto";
};

interface SkipResult {
    shouldSkip: boolean;
    reason?: 'cancelled' | 'old_date';
}

export const shouldSkipRow = (
    rowDate: Date | null,
    cutoffDateStr: string | undefined,
    statusFaturamento: any
): SkipResult => {
    // 1. Filtro de Cancelamento
    const status = String(statusFaturamento || "").toLowerCase();
    if (status.includes("cancelad")) {
        return { shouldSkip: true, reason: 'cancelled' };
    }

    // 2. Filtro de Data (Corte)
    if (rowDate && cutoffDateStr) {
        const [y, m, d] = cutoffDateStr.split('-').map(Number);
        const cutoff = new Date(y, m - 1, d);
        cutoff.setHours(0, 0, 0, 0);

        const checkDate = new Date(rowDate);
        checkDate.setDate(1);
        checkDate.setHours(0, 0, 0, 0);

        if (checkDate < cutoff) {
            return { shouldSkip: true, reason: 'old_date' };
        }
    }

    return { shouldSkip: false };
};