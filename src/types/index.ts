// src/types/index.ts

export interface ExcelRow {
    [key: string]: any;
}

export interface RawExcelRow {
    [key: string]: any; // Permite indexação dinâmica, mas define os campos conhecidos abaixo
    "Projeto"?: string;
    "PROJETO"?: string;
    "UF"?: string;
    "Estado"?: string;
    "Mês de Referência"?: string;
    "Referência"?: string;
    "Status"?: string;
    "Status Faturamento"?: string;
    "Instalação"?: string;
    "CNPJ/CPF"?: string;
    "Nome"?: string;
    "Desconto contrato (%)"?: number | string;
    "Custo sem GD R$"?: number | string;
    "Custo com GD R$"?: number | string;
    "Valor Final R$"?: number | string;
    "Economia R$"?: number | string;
    "Vencimento"?: string | number;
    "Dias Atrasados"?: number | string;
    "Dias de Atraso"?: number | string;
    "Risco"?: string;
}

export interface ProcessedRow {
    [key: string]: string | number | boolean | Date | null;
}

export interface FileQueueItem {
    file: File;
    id: number;
    manualCode: string;
    targetProject?: string; // NOVO: Define qual projeto filtrar nesta passada
    cutoffDate: string;
    status: 'idle' | 'processing' | 'success' | 'error';
    errorMessage: string;
}

export interface ProcessResult {
    rows: ProcessedRow[];
    stats: {
        total: number;
        processed: number;
        skippedOld: number;
        skippedCancelled: number;
        skippedEmpty: number;
    };
}

export interface ProcessingProgress {
    current: number;
    total: number;
}