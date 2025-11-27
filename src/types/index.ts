// src/types/index.ts

export interface ExcelRow {
    [key: string]: any;
}

// Interface opcional para tipagem mais rigorosa no worker
export interface RawExcelRow {
    [key: string]: any;
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
    targetProject?: string; // Define se estamos a filtrar por um projeto específico
    cutoffDate: string;
    status: 'idle' | 'processing' | 'success' | 'error';
    errorMessage: string;
}

// --- NOVO: Estrutura para o cruzamento de dados EGS ---
// Chave: "Instalação_Ano-Mês" (ex: "123456_2025-05")
export interface EGSFinancialMap {
    [key: string]: {
        custoComGD: number;
        custoSemGD: number;
        economia: number | string;
    };
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

// Tipos de Mensagens do Worker (para segurança de tipo)
export type WorkerMessage =
    | { action: 'analyze'; fileBuffer: ArrayBuffer }
    | { action: 'extract_financials'; fileBuffer: ArrayBuffer }
    | { action: 'process'; fileBuffer: ArrayBuffer; fileName: string; manualCode: string; cutoffDate: string; targetProject?: string; egsFinancials?: EGSFinancialMap };