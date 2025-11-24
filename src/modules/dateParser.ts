export const parseExcelDate = (dateVal: any): Date | null => {
    try {
        if (!dateVal) return null;

        // Se já for objeto Date
        if (dateVal instanceof Date) return dateVal;

        // Se for número (Excel Serial Date)
        // Excel base date é 30/12/1899, mas JS conta milissegundos
        if (typeof dateVal === 'number') {
            return new Date(Math.round((dateVal - 25569) * 86400 * 1000));
        }

        // Se for string (Tentativa de parse robusto)
        const strVal = String(dateVal).trim();

        // Formato comum pt-BR DD/MM/AAAA ou DD-MM-AAAA
        if (strVal.match(/^\d{1,2}[/-]\d{1,2}[/-]\d{4}/)) {
            const parts = strVal.split(/[-/]/);
            // Assumindo dia/mês/ano
            return new Date(parts[2], parts[1] - 1, parts[0]);
        }

        // Formato ISO YYYY-MM-DD
        if (strVal.includes('-') && strVal.split('-')[0].length === 4) {
            const parts = strVal.split('-');
            return new Date(parts[0], parts[1] - 1, parts[2]);
        }

        const parsed = new Date(dateVal);
        return isNaN(parsed.getTime()) ? null : parsed;

    } catch (e) {
        console.warn("Falha ao processar data:", dateVal);
        return null;
    }
};
