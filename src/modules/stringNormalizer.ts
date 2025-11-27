// src/modules/stringNormalizer.ts

/**
 * Remove tudo o que não for dígito.
 * Ex: "10/530195-7" -> "105301957"
 */
export const normalizeInstallation = (value: any): string => {
    if (!value) return "";
    return String(value).replace(/\D/g, "").trim();
};

/**
 * Converte para maiúsculas e remove caracteres especiais.
 * Substitui underscores (_) por espaço.
 * Ex: "energisa_mt" -> "ENERGISA MT"
 */
export const normalizeDistributor = (value: any): string => {
    if (!value) return "";

    let str = String(value).toUpperCase();

    // Substitui underscore por espaço
    str = str.replace(/_/g, " ");

    // Opcional: Remove outros caracteres especiais se necessário, mantendo letras, números e espaços
    // str = str.replace(/[^A-Z0-9 ]/g, ""); 

    return str.trim();
};