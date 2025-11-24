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

    // Economia = Custo Com GD - Custo Sem GD (mantendo sua lógica original)
    // Nota: Geralmente economia é (Sem GD - Com GD), verifique se o sinal (-) não deveria ser invertido no seu output.
    // Aqui estou mantendo estritamente a lógica matemática do seu arquivo original.
    const economia_centavos = comGD_centavos - semGD_centavos;

    return (economia_centavos / 100).toFixed(2);
};
