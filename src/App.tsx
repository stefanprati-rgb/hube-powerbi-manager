// src/App.tsx
import React, { useState, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import Icon from './components/Icon';
import { FINAL_HEADERS, VALID_PROJECT_CODES } from './config/constants';
import type { FileQueueItem, ProcessingProgress, ProcessedRow } from './types';
// Importação do Worker (O Vite lida com isso nativamente)
import ExcelWorker from './workers/excel.worker?worker';

// Configurações de datas de corte padrão (Fallback)
const DEFAULT_CUTOFFS: Record<string, string> = {
    'LNV': '2025-01-01',
    'ALA': '2025-01-01',
    'ESP': '2025-05-01',
    'EMG': '2025-05-01',
    'EGS': '2025-06-01',
    'MTX': '2025-01-01',
    'DEFAULT': '2025-01-01'
};

function App() {
    /* ---------- Estado ---------- */
    const [fileQueue, setFileQueue] = useState<FileQueueItem[]>([]);
    const [processedData, setProcessedData] = useState<ProcessedRow[]>([]);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [isDragOver, setIsDragOver] = useState<boolean>(false);
    const [uploadStatus, setUploadStatus] = useState<string>('');
    const [processProgress, setProcessProgress] = useState<ProcessingProgress>({ current: 0, total: 0 });

    /* ---------- Helpers ---------- */
    const validExtensions = useMemo(() => ['.xlsx', '.xls', '.csv'], []);

    // Recupera a data da memória (localStorage) ou usa o padrão
    const getInitialDate = (projCode: string = 'DEFAULT') => {
        const code = projCode.toUpperCase();
        const saved = localStorage.getItem(`cutoff_${code}`);
        if (saved) return saved;
        return DEFAULT_CUTOFFS[code] || DEFAULT_CUTOFFS['DEFAULT'];
    };

    const normalizeFiles = (fileList: FileList | File[]): File[] =>
        Array.from(fileList).filter(f =>
            validExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
        );

    const isCodeValid = (code: string) => {
        return code && VALID_PROJECT_CODES.includes(code.toUpperCase());
    };

    /* ---------- Adição e Análise de Arquivos ---------- */
    const addFilesToQueue = async (files: File[]) => {
        if (!files.length) return;
        setUploadStatus(`Analisando estrutura de ${files.length} arquivo(s)...`);

        const newItems: FileQueueItem[] = [];

        for (const file of files) {
            try {
                // 1. Analisa o conteúdo sem travar a interface (Worker)
                const buffer = await file.arrayBuffer();
                const detectedProjects = await new Promise<string[]>((resolve) => {
                    const worker = new ExcelWorker();
                    worker.postMessage({ action: 'analyze', fileBuffer: buffer });

                    worker.onmessage = (e) => {
                        worker.terminate();
                        resolve(e.data.success ? e.data.projects : []);
                    };

                    worker.onerror = () => {
                        worker.terminate();
                        resolve([]); // Se falhar, trata como genérico
                    };
                });

                // 2. Se detectou projetos (ex: LNV e ALA no mesmo arquivo), cria um item para cada
                if (detectedProjects.length > 0) {
                    detectedProjects.forEach(proj => {
                        newItems.push({
                            file: file, // Referência ao mesmo arquivo
                            id: Date.now() + Math.random(),
                            manualCode: proj,      // Sigla detectada
                            targetProject: proj,   // Instrui o processador a filtrar só este projeto
                            cutoffDate: getInitialDate(proj), // Data específica deste projeto
                            status: 'idle',
                            errorMessage: ''
                        });
                    });
                } else {
                    // 3. Se NÃO detectou (sem coluna PROJETO), adiciona genérico para input manual OBRIGATÓRIO
                    newItems.push({
                        file: file,
                        id: Date.now() + Math.random(),
                        manualCode: '',
                        targetProject: undefined,
                        cutoffDate: getInitialDate('DEFAULT'),
                        status: 'idle',
                        errorMessage: ''
                    });
                }

            } catch (e) {
                console.error("Erro na análise preliminar:", file.name);
                newItems.push({
                    file,
                    id: Date.now(),
                    manualCode: '',
                    cutoffDate: getInitialDate('DEFAULT'),
                    status: 'idle',
                    errorMessage: ''
                });
            }
        }

        setFileQueue(prev => [...prev, ...newItems]);
        setUploadStatus(`${newItems.length} item(s) adicionado(s) à fila.`);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<HTMLDivElement>) => {
        const list = 'dataTransfer' in e ? e.dataTransfer.files : e.target.files;
        if (!list) return;
        const files = normalizeFiles(list);
        if (files.length === 0) {
            setUploadStatus('⚠️ Apenas arquivos .xlsx, .xls e .csv são permitidos.');
            return;
        }
        addFilesToQueue(files);
    };

    const updateItemField = (id: number, field: 'manualCode' | 'cutoffDate', value: string) => {
        setFileQueue(prev => prev.map(it => {
            if (it.id === id) {
                // Se mudar a sigla manual, tenta atualizar a data e o target automaticamente
                if (field === 'manualCode') {
                    const newCode = value.toUpperCase();
                    return {
                        ...it,
                        manualCode: newCode,
                        // Se o usuário digitou, assumimos que é o target (para arquivos sem coluna)
                        // ou uma correção de override.
                        targetProject: newCode,
                        cutoffDate: getInitialDate(newCode),
                        status: 'idle',
                        errorMessage: ''
                    };
                }
                return { ...it, [field]: value, status: 'idle', errorMessage: '' };
            }
            return it;
        }));
    };

    const removeFile = (id: number) => {
        setFileQueue(prev => prev.filter(it => it.id !== id));
    };

    /* ---------- Processamento (Core) ---------- */
    const runBatch = async () => {
        // Filtra itens pendentes ou com erro
        const pendingItems = fileQueue.filter(f => f.status !== 'success');

        if (!pendingItems.length) {
            alert("Todos os arquivos já foram processados com sucesso.");
            return;
        }

        // --- VALIDAÇÃO DE PRÉ-PROCESSAMENTO ---
        // Verifica se algum item não tem sigla válida
        const invalidItems = pendingItems.filter(item => !isCodeValid(item.manualCode));

        if (invalidItems.length > 0) {
            alert(`ERRO: Existem ${invalidItems.length} arquivo(s) com sigla inválida ou vazia.\n\nSiglas permitidas: ${VALID_PROJECT_CODES.join(', ')}.\n\nPor favor, corrija os campos em vermelho antes de processar.`);

            // Marca visualmente com erro
            setFileQueue(prev => prev.map(it =>
                !isCodeValid(it.manualCode) && it.status !== 'success'
                    ? { ...it, status: 'error', errorMessage: 'Sigla Inválida/Obrigatória' }
                    : it
            ));
            return;
        }

        setIsProcessing(true);
        setProcessProgress({ current: 0, total: fileQueue.length });
        setUploadStatus('Iniciando processamento...');

        const allData: ProcessedRow[] = [...processedData]; // Mantém dados anteriores
        let hasErrors = false;

        // Itera sobre a fila original para manter a ordem
        for (let i = 0; i < fileQueue.length; i++) {
            const item = fileQueue[i];

            if (item.status === 'success') {
                setProcessProgress(prev => ({ ...prev, current: i + 1 }));
                continue;
            }

            setProcessProgress(prev => ({ ...prev, current: i + 1 }));
            setUploadStatus(`Processando ${i + 1}/${fileQueue.length}: ${item.file.name}...`);

            setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'processing' } : it));

            try {
                // 1. Salva a data na memória para a próxima vez
                if (item.manualCode) {
                    localStorage.setItem(`cutoff_${item.manualCode}`, item.cutoffDate);
                }

                const buffer = await item.file.arrayBuffer();

                // 2. Chama o Worker para processar
                const processedRows = await new Promise<ProcessedRow[]>((resolve, reject) => {
                    const worker = new ExcelWorker();

                    worker.postMessage({
                        action: 'process',
                        fileBuffer: buffer,
                        fileName: item.file.name,
                        manualCode: item.manualCode, // Envia a sigla validada
                        cutoffDate: item.cutoffDate,
                        targetProject: item.targetProject // Filtra pelo projeto específico
                    });

                    worker.onmessage = (e) => {
                        worker.terminate();
                        if (e.data.success) {
                            resolve(e.data.rows);
                        } else {
                            reject(new Error(e.data.error || "Erro desconhecido"));
                        }
                    };

                    worker.onerror = (err) => {
                        worker.terminate();
                        reject(new Error("Falha crítica no Worker."));
                    };
                });

                // 3. Consolida Resultados
                if (processedRows.length > 0) {
                    allData.push(...processedRows);
                    setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'success', errorMessage: '' } : it));
                } else {
                    // Sucesso técnico, mas 0 linhas (ex: todas filtradas pela data)
                    // Consideramos sucesso para não bloquear, mas o usuário vê 0 linhas no preview
                    setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'success', errorMessage: '0 linhas geradas' } : it));
                }

            } catch (err: any) {
                console.error(err);
                hasErrors = true;
                const errorMsg = err.message || 'Erro desconhecido';
                setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'error', errorMessage: errorMsg.substring(0, 60) } : it));
            }
        }

        if (!hasErrors) {
            setProcessedData(allData);
            setUploadStatus(`Concluído! ${allData.length} linhas geradas.`);
        } else {
            setProcessedData(allData);
            setUploadStatus('Processo finalizado. Verifique os erros em vermelho.');
        }
        setIsProcessing(false);
    };

    /* ---------- Exportação ---------- */
    const handleExport = () => {
        if (!processedData.length) return;
        const ws = XLSX.utils.json_to_sheet(processedData, { header: FINAL_HEADERS });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Dados Consolidados');
        XLSX.writeFile(wb, 'Relatorio_Hube_Consolidado.xlsx');
    };

    /* ---------- UI Events ---------- */
    const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
    const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); }, []);
    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); setIsDragOver(false);
        addFilesToQueue(normalizeFiles(e.dataTransfer.files));
    }, [validExtensions]);

    const clearAll = () => {
        if (!confirm('Limpar toda a lista?')) return;
        setFileQueue([]);
        setProcessedData([]);
        setUploadStatus('');
    };

    return (
        <div className="min-h-screen pb-20 relative bg-[#F5F5F7]">
            <header className="glass-header sticky top-0 z-40 px-6 py-4 flex justify-between items-center mb-8">
                <div className="flex items-center gap-4">
                    <img
                        src="https://hube.energy/wp-content/uploads/2024/10/Logo-1.svg"
                        className="h-8 w-auto"
                        alt="Hube Logo"
                        onError={e => ((e.target as HTMLImageElement).style.display = 'none')}
                    />
                    <div className="h-6 w-px bg-gray-300 mx-2"></div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Power BI Manager <span className="text-xs font-normal text-gray-500 ml-2">v13.0</span></h1>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {fileQueue.length > 0 && (
                        <button
                            onClick={clearAll}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                            title="Limpar Lista"
                        >
                            <Icon name="Trash" size={20} />
                        </button>
                    )}
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6">

                {/* 1. ÁREA DE DRAG & DROP (Sempre visível) */}
                <div
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    className={`
                        drop-zone relative rounded-3xl flex flex-col items-center justify-center text-center p-8 mb-8 border-2 border-dashed transition-all duration-300
                        ${isDragOver ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-gray-200 hover:border-gray-300'}
                        ${fileQueue.length > 0 ? 'h-40' : 'h-64'} 
                    `}
                >
                    <input
                        type="file"
                        multiple
                        accept=".xlsx,.xls,.csv"
                        onChange={handleFileUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <Icon name="UploadCloud" size={32} className="text-blue-500" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                        {fileQueue.length > 0 ? 'Arrastar mais arquivos' : 'Arraste seus arquivos aqui'}
                    </h3>
                    <p className="text-gray-500 max-w-md mx-auto">
                        {fileQueue.length > 0 ? 'Ou clique para adicionar à fila' : 'Processamento automático de todas as abas.'}
                    </p>
                </div>

                {/* 2. LISTA DE ARQUIVOS */}
                {fileQueue.length > 0 && (
                    <div className="flex-1 flex flex-col mb-8">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                                Fila de Processamento
                            </h2>
                            <label className="text-[#00D655] text-sm font-medium cursor-pointer hover:underline flex items-center gap-1">
                                <Icon name="UploadCloud" size={16} /> Selecionar
                                <input
                                    type="file"
                                    multiple
                                    accept=".xlsx,.xls,.csv"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                            </label>
                        </div>

                        <div className="space-y-3">
                            {fileQueue.map(item => (
                                <div
                                    key={item.id}
                                    className={`
                                        relative bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border transition-all duration-200 
                                        ${item.status === 'error' ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-100 hover:shadow-md'}
                                        ${item.status === 'processing' ? 'border-blue-400 ring-2 ring-blue-100' : ''}
                                    `}
                                >
                                    {/* Ícone de Status */}
                                    <div
                                        className={`
                                            w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors
                                            ${item.status === 'idle' ? 'bg-gray-100 text-gray-400' : ''}
                                            ${item.status === 'processing' ? 'bg-blue-50 text-blue-500' : ''}
                                            ${item.status === 'success' ? 'bg-[#00D655]/10 text-[#00D655]' : ''}
                                            ${item.status === 'error' ? 'bg-red-100 text-red-500' : ''}
                                        `}
                                    >
                                        {item.status === 'idle' && <Icon name="FileSpreadsheet" size={20} />}
                                        {item.status === 'processing' && (
                                            <div className="animate-spin">
                                                <Icon name="Loader2" size={20} />
                                            </div>
                                        )}
                                        {item.status === 'success' && <Icon name="Check" size={20} />}
                                        {item.status === 'error' && <Icon name="AlertTriangle" size={20} />}
                                    </div>

                                    {/* Informações do Arquivo */}
                                    <div className="flex-1 min-w-0">
                                        <h3 className={`text-sm font-semibold truncate ${item.status === 'error' ? 'text-red-600' : 'text-[#1D1D1F]'}`}>
                                            {item.file.name}
                                            {/* Badge do Projeto Detectado */}
                                            {item.targetProject && (
                                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200">
                                                    {item.targetProject}
                                                </span>
                                            )}
                                        </h3>
                                        {item.status === 'error' ? (
                                            <p className="text-xs text-red-500 font-bold mt-0.5 animate-pulse">
                                                {item.errorMessage}
                                            </p>
                                        ) : (
                                            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">
                                                {(item.file.size / 1024).toFixed(0)} KB
                                            </p>
                                        )}
                                    </div>

                                    {/* Controles Individuais */}
                                    <div className="flex items-center gap-3 border-l pl-3 border-gray-100">

                                        <div className="flex flex-col items-end group">
                                            <label className="text-[9px] font-bold uppercase mb-0.5 mr-1 text-gray-300 group-hover:text-blue-500 transition-colors">
                                                Data Corte
                                            </label>
                                            <input
                                                type="date"
                                                value={item.cutoffDate}
                                                onChange={e => updateItemField(item.id, 'cutoffDate', e.target.value)}
                                                className="ios-input w-28 p-1.5 text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#00D655]"
                                                title="Faturas anteriores a esta data serão ignoradas"
                                            />
                                        </div>

                                        <div className="flex flex-col items-end group">
                                            <label className={`text-[9px] font-bold uppercase mb-0.5 mr-1 transition-colors ${!isCodeValid(item.manualCode) ? 'text-red-500' : 'text-gray-300 group-hover:text-[#00D655]'}`}>
                                                Sigla
                                            </label>
                                            <input
                                                type="text"
                                                maxLength={3}
                                                className={`
                                                    ios-input w-16 p-1.5 text-center uppercase font-bold text-xs rounded-lg border outline-none focus:bg-white
                                                    ${!isCodeValid(item.manualCode)
                                                        ? 'border-red-300 bg-red-50 text-red-800 placeholder-red-300 focus:border-red-500 focus:ring-red-200'
                                                        : 'border-gray-200 bg-gray-50 text-[#1D1D1F] focus:border-[#00D655]'
                                                    }
                                                `}
                                                placeholder="???"
                                                value={item.manualCode}
                                                onChange={e => updateItemField(item.id, 'manualCode', e.target.value)}
                                                title={!isCodeValid(item.manualCode) ? "Sigla obrigatória (LNV, ALA, EGS, MTX, EMG, ESP)" : ""}
                                            />
                                        </div>

                                        <button
                                            onClick={() => removeFile(item.id)}
                                            className="p-2 text-gray-300 hover:text-red-500 transition-colors rounded-full hover:bg-gray-50"
                                        >
                                            <Icon name="X" size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Footer: Ações Gerais */}
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-10">
                    <div
                        className={`
                            flex items-center gap-3 px-4 py-2 rounded-full shadow-sm border transition-colors
                            ${processedData.length === 0 && fileQueue.some(f => f.status === 'error')
                                ? 'bg-red-50 border-red-200 text-red-600'
                                : 'bg-white border-gray-100 text-gray-600'
                            }
                        `}
                    >
                        <Icon name="Info" size={16} />
                        <span className="text-sm font-medium">
                            {uploadStatus || 'Aguardando arquivos...'}
                        </span>
                        {isProcessing && processProgress.total > 0 && (
                            <span className="ml-2 text-xs font-bold bg-blue-100 text-blue-600 px-2 py-1 rounded">
                                {processProgress.current}/{processProgress.total}
                            </span>
                        )}
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={runBatch}
                            disabled={isProcessing || fileQueue.length === 0}
                            className="group relative px-6 py-3 rounded-xl font-bold text-white bg-[#1D1D1F] hover:bg-black disabled:bg-gray-300 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
                        >
                            {isProcessing ? (
                                <>
                                    <Icon name="Loader2" className="animate-spin" size={18} />
                                    Processando...
                                </>
                            ) : (
                                <>
                                    Processar Lista
                                    <Icon name="Play" size={18} className="group-hover:translate-x-0.5 transition-transform" />
                                </>
                            )}
                        </button>

                        {processedData.length > 0 && (
                            <button
                                onClick={handleExport}
                                className="px-6 py-3 rounded-xl font-bold text-white bg-[#00D655] hover:bg-[#00c24e] transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center gap-2 animate-fade-in-up"
                            >
                                Baixar Excel
                                <Icon name="Download" size={20} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Preview dos Dados */}
                {processedData.length > 0 && (
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-in-up mb-8">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-gray-900">Preview dos Dados Processados</h3>
                            <span className="text-sm text-gray-500">{processedData.length} linhas</span>
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        {FINAL_HEADERS.slice(0, 8).map(header => (
                                            <th
                                                key={header}
                                                className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider"
                                            >
                                                {header}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {processedData.slice(0, 10).map((row, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50">
                                            {FINAL_HEADERS.slice(0, 8).map(header => (
                                                <td key={header} className="px-4 py-3 whitespace-nowrap text-gray-700">
                                                    {row[header as keyof ProcessedRow] || '-'}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {processedData.length > 10 && (
                            <p className="text-xs text-gray-400 mt-3 text-center">
                                Mostrando 10 de {processedData.length} linhas. Baixe o Excel para ver tudo.
                            </p>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;