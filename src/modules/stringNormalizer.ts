// src/modules/stringNormalizer.ts

export const normalizeInstallation = (value: any): string => {
    if (!value) return "";
    return String(value).replace(/\D/g, "").trim();
};

export const normalizeDistributor = (value: any): string => {
    if (!value) return "";

    let str = String(value).toUpperCase();
    str = str.replace(/_/g, " ");

    return str.trim();
};