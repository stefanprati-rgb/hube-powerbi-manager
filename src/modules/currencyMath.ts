// src/modules/currencyMath.ts

export const parseCurrency = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;

    // Remove R$, espaços e normaliza separadores
    let v = String(val).replace("R$", "").replace(/\s/g, "").trim();

    // Lógica para detectar milhar vs decimal
    if (v.includes(",") && v.includes(".")) {
        v = v.replace(/\./g, "").replace(",", ".");
    } else if (v.includes(",")) {
        v = v.replace(",", ".");
    }

    const parsed = parseFloat(v);
    return isNaN(parsed) ? 0 : parsed;
};

// Cálculo seguro convertendo para centavos
export const calculateEconomySafe = (custoComGD: number, custoSemGD: number): string => {
    const comGD_centavos = Math.round(custoComGD * 100);
    const semGD_centavos = Math.round(custoSemGD * 100);

    const economia_centavos = semGD_centavos - comGD_centavos;

    // ATUALIZAÇÃO: Permite valores negativos se a planilha indicar
    return (economia_centavos / 100).toFixed(2);
};