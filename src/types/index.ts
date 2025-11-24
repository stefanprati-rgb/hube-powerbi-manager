// Definições de tipos para garantir segurança em todo o projeto

// Representa uma linha crua vinda do Excel (pode ter qualquer coisa)
export interface ExcelRow {
    [key: string]: any;
}

// Representa a linha depois de processada e limpa
export interface ProcessedRow {
    [key: string]: string | number | boolean | Date | null;
}

// Representa um item na fila de upload
export interface FileQueueItem {
    file: File;
    id: number;
    manualCode: string;
    status: 'idle' | 'processing' | 'success' | 'error';
    errorMessage: string;
}

// Resultado do processamento de uma aba
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

// Simples controle de progresso
export interface ProcessingProgress {
    current: number;
    total: number;
}