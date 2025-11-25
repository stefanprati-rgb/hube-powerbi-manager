export const parseCurrency = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;

    // Remove R$, espaços e normaliza separadores
    let v = String(val).replace("R$", "").replace(/\s/g, "").trim();

    // Lógica para detectar milhar vs decimal
    // Ex: 1.000,00 -> remove ponto, troca vírgula por ponto
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

    // CORREÇÃO: Economia = (Sem GD) - (Com GD)
    // Ex: Se custaria 150 (Sem GD) e custou 100 (Com GD), a economia é 50.
    const economia_centavos = semGD_centavos - comGD_centavos;

    // REGRA DE OURO: Não mostrar economia negativa. Se for < 0, retorna vazio.
    if (economia_centavos < 0) {
        return "";
    }

    return (economia_centavos / 100).toFixed(2);
};