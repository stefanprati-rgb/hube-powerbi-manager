// src/workers/strategies/IProjectStrategy.ts

export interface ProcessingContext {
    manualCode?: string;
    cutoffDate?: string;
    fileName?: string;
}

export interface IProjectStrategy {
    /**
     * Nome da estratégia para fins de debug/log (ex: 'EGS', 'ERA_VERDE', 'STANDARD').
     */
    name: string;

    /**
     * Verifica se esta estratégia é a correta para processar a linha fornecida.
     * @param row A linha bruta do Excel.
     * @param manualCode Código selecionado manualmente pelo usuário (se houver).
     */
    matches(row: any, manualCode?: string): boolean;

    /**
     * Aplica as regras de negócio específicas, limpa dados e formata.
     * @param row A linha bruta do Excel.
     * @param context Contexto adicional (datas de corte, nome do arquivo, etc).
     * @returns O objeto final formatado ou null se a linha for filtrada/ignorada.
     */
    process(row: any, context: ProcessingContext): any | null;
}