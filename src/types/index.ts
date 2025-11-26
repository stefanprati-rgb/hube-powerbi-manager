// src/types/index.ts

export interface ExcelRow {
    [key: string]: any;
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