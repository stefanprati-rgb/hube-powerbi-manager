// src/App.tsx
import React, { useState, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import Icon from './components/Icon';
import { FINAL_HEADERS } from './config/constants';
import type { FileQueueItem, ProcessingProgress, ProcessedRow } from './types';
import ExcelWorker from './workers/excel.worker?worker';

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
    const [fileQueue, setFileQueue] = useState<FileQueueItem[]>([]);
    const [processedData, setProcessedData] = useState<ProcessedRow[]>([]);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [isDragOver, setIsDragOver] = useState<boolean>(false);
    const [uploadStatus, setUploadStatus] = useState<string>('');
    const [processProgress, setProcessProgress] = useState<ProcessingProgress>({ current: 0, total: 0 });

    const validExtensions = useMemo(() => ['.xlsx', '.xls', '.csv'], []);

    const getInitialDate = (projCode: string = 'DEFAULT') => {
        const saved = localStorage.getItem(`cutoff_${projCode.toUpperCase()}`);
        if (saved) return saved;
        return DEFAULT_CUTOFFS[projCode.toUpperCase()] || DEFAULT_CUTOFFS['DEFAULT'];
    };

    const normalizeFiles = (fileList: FileList | File[]): File[] =>
        Array.from(fileList).filter(f => validExtensions.some(ext => f.name.toLowerCase().endsWith(ext)));

    // --- FUNÇÃO PRINCIPAL: Adiciona e Analisa Projetos ---
    const addFilesToQueue = async (files: File[]) => {
        if (!files.length) return;
        setUploadStatus(`Analisando ${files.length} arquivo(s)...`);

        const newItems: FileQueueItem[] = [];

        for (const file of files) {
            try {
                // 1. Cria Worker para analisar o conteúdo antes de adicionar
                const buffer = await file.arrayBuffer();
                const detectedProjects = await new Promise<string[]>((resolve) => {
                    const worker = new ExcelWorker();
                    worker.postMessage({ action: 'analyze', fileBuffer: buffer });
                    worker.onmessage = (e) => {
                        worker.terminate();
                        resolve(e.data.success ? e.data.projects : []);
                    };
                    worker.onerror = () => { worker.terminate(); resolve([]); };
                });

                // 2. Se encontrou projetos, cria um item para cada
                if (detectedProjects.length > 0) {
                    detectedProjects.forEach(proj => {
                        newItems.push({
                            file: file,
                            id: Date.now() + Math.random(),
                            manualCode: proj,
                            targetProject: proj,
                            cutoffDate: getInitialDate(proj),
                            status: 'idle',
                            errorMessage: ''
                        });
                    });
                } else {
                    // 3. Genérico (sem coluna projeto detectada)
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
                console.error("Erro ao analisar arquivo:", file.name);
                newItems.push({ file, id: Date.now(), manualCode: '', cutoffDate: getInitialDate('DEFAULT'), status: 'idle', errorMessage: '' });
            }
        }

        setFileQueue(prev => [...prev, ...newItems]);
        setUploadStatus(`${newItems.length} item(s) adicionado(s).`);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<HTMLDivElement>) => {
        const list = 'dataTransfer' in e ? e.dataTransfer.files : e.target.files;
        if (!list) return;
        addFilesToQueue(normalizeFiles(list));
    };

    const updateItemField = (id: number, field: 'manualCode' | 'cutoffDate', value: string) => {
        setFileQueue(prev => prev.map(it => {
            if (it.id === id) {
                if (field === 'manualCode') {
                    const newCode = value.toUpperCase();
                    return {
                        ...it,
                        manualCode: newCode,
                        targetProject: newCode, // Assume filtro pelo novo código
                        cutoffDate: DEFAULT_CUTOFFS[newCode] || it.cutoffDate,
                        status: 'idle', errorMessage: ''
                    };
                }
                return { ...it, [field]: value, status: 'idle', errorMessage: '' };
            }
            return it;
        }));
    };

    const removeFile = (id: number) => setFileQueue(prev => prev.filter(it => it.id !== id));

    /* ---------- EXECUÇÃO ---------- */
    const runBatch = async () => {
        const pendingItems = fileQueue.filter(f => f.status !== 'success');
        if (!pendingItems.length) { alert("Todos os arquivos já foram processados."); return; }

        setIsProcessing(true);
        setProcessProgress({ current: 0, total: fileQueue.length });
        setUploadStatus('Processando...');

        const allData: ProcessedRow[] = [...processedData];
        let hasErrors = false;

        for (let i = 0; i < fileQueue.length; i++) {
            const item = fileQueue[i];
            if (item.status === 'success') {
                setProcessProgress(prev => ({ ...prev, current: i + 1 }));
                continue;
            }

            setProcessProgress(prev => ({ ...prev, current: i + 1 }));
            setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'processing' } : it));

            try {
                if (item.manualCode) localStorage.setItem(`cutoff_${item.manualCode}`, item.cutoffDate);

                const buffer = await item.file.arrayBuffer();
                const processedRows = await new Promise<ProcessedRow[]>((resolve, reject) => {
                    const worker = new ExcelWorker();
                    worker.postMessage({
                        action: 'process',
                        fileBuffer: buffer,
                        fileName: item.file.name,
                        manualCode: item.manualCode,
                        cutoffDate: item.cutoffDate,
                        targetProject: item.targetProject
                    });
                    worker.onmessage = (e) => {
                        worker.terminate();
                        if (e.data.success) resolve(e.data.rows);
                        else reject(new Error(e.data.error));
                    };
                    worker.onerror = () => { worker.terminate(); reject(new Error("Falha no Worker.")); };
                });

                if (processedRows.length > 0) {
                    allData.push(...processedRows);
                    setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'success', errorMessage: '' } : it));
                } else {
                    setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'success', errorMessage: '' } : it));
                }

            } catch (err: any) {
                hasErrors = true;
                setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'error', errorMessage: err.message.substring(0, 50) } : it));
            }
        }

        if (!hasErrors) setUploadStatus(`Concluído! ${allData.length} linhas.`);
        else {
            setProcessedData(allData);
            setUploadStatus('Concluído com erros. Verifique a lista.');
        }
        setIsProcessing(false);
    };

    const handleExport = () => {
        if (!processedData.length) return;
        const ws = XLSX.utils.json_to_sheet(processedData, { header: FINAL_HEADERS });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Dados Consolidados');
        XLSX.writeFile(wb, 'Relatorio_Hube_Consolidado.xlsx');
    };

    const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
    const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); }, []);
    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); setIsDragOver(false);
        addFilesToQueue(normalizeFiles(e.dataTransfer.files));
    }, [validExtensions]);

    const clearAll = () => {
        if (!confirm('Limpar tudo?')) return;
        setFileQueue([]); setProcessedData([]); setUploadStatus('');
    };

    return (
        <div className="min-h-screen pb-20 relative bg-[#F5F5F7]">
            <header className="glass-header sticky top-0 z-40 px-6 py-4 flex justify-between items-center mb-8">
                <div className="flex items-center gap-4">
                    <img src="https://hube.energy/wp-content/uploads/2024/10/Logo-1.svg" className="h-8 w-auto" alt="Hube Logo" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
                    <div className="h-6 w-px bg-gray-300 mx-2"></div>
                    <div><h1 className="text-xl font-bold text-gray-900">Power BI Manager <span className="text-xs font-normal text-gray-500 ml-2">v12.1</span></h1></div>
                </div>
                <div className="flex items-center gap-4">
                    {fileQueue.length > 0 && (
                        <button onClick={clearAll} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"><Icon name="Trash" size={20} /></button>
                    )}
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6">

                {/* 1. ÁREA DE DRAG & DROP (SEMPRE VISÍVEL) */}
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

                {/* 2. LISTA DE ARQUIVOS (VISÍVEL APENAS SE HOUVER ITENS) */}
                {fileQueue.length > 0 && (
                    <div className="flex-1 flex flex-col mb-8">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Fila de Processamento</h2>
                            <label className="text-[#00D655] text-sm font-medium cursor-pointer hover:underline flex items-center gap-1">
                                <Icon name="UploadCloud" size={16} /> Selecionar
                                <input type="file" multiple accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
                            </label>
                        </div>

                        <div className="space-y-3">
                            {fileQueue.map(item => (
                                <div key={item.id} className={`relative bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border transition-all duration-200 ${item.status === 'error' ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-100 hover:shadow-md'}`}>
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${item.status === 'processing' ? 'bg-blue-50 text-blue-500' : item.status === 'success' ? 'bg-[#00D655]/10 text-[#00D655]' : item.status === 'error' ? 'bg-red-100 text-red-500' : 'bg-gray-100 text-gray-400'}`}>
                                        {item.status === 'idle' && <Icon name="FileSpreadsheet" size={20} />}
                                        {item.status === 'processing' && <div className="animate-spin"><Icon name="Loader2" size={20} /></div>}
                                        {item.status === 'success' && <Icon name="Check" size={20} />}
                                        {item.status === 'error' && <Icon name="AlertTriangle" size={20} />}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <h3 className={`text-sm font-semibold truncate ${item.status === 'error' ? 'text-red-600' : 'text-[#1D1D1F]'}`}>
                                            {item.file.name}
                                            {item.targetProject && <span className="ml-2 text-xs font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded">[{item.targetProject}]</span>}
                                        </h3>
                                        {item.status === 'error' ?
                                            <p className="text-xs text-red-500 font-bold mt-0.5">{item.errorMessage}</p> :
                                            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">{(item.file.size / 1024).toFixed(0)} KB</p>
                                        }
                                    </div>

                                    <div className="flex items-center gap-3 border-l pl-3 border-gray-100">
                                        <div className="flex flex-col items-end group">
                                            <label className="text-[9px] font-bold uppercase mb-0.5 mr-1 text-gray-300">Data Corte</label>
                                            <input type="date" value={item.cutoffDate} onChange={e => updateItemField(item.id, 'cutoffDate', e.target.value)} className="ios-input w-28 p-1.5 text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#00D655]" />
                                        </div>
                                        <div className="flex flex-col items-end group">
                                            <label className="text-[9px] font-bold uppercase mb-0.5 mr-1 text-gray-300">Sigla</label>
                                            <input type="text" maxLength={3} className={`ios-input w-16 p-1.5 text-center uppercase font-bold text-xs rounded-lg border outline-none ${item.status === 'error' && !item.manualCode ? 'border-red-300 bg-red-50 placeholder-red-300' : 'border-gray-200 bg-gray-50'}`} placeholder="???" value={item.manualCode} onChange={e => updateItemField(item.id, 'manualCode', e.target.value)} />
                                        </div>
                                        <button onClick={() => removeFile(item.id)} className="p-2 text-gray-300 hover:text-red-500 transition-colors rounded-full hover:bg-gray-50"><Icon name="X" size={16} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-10">
                    <div className="flex items-center gap-3 px-4 py-2 bg-white rounded-full shadow-sm border border-gray-100 text-gray-600">
                        <Icon name="Info" size={16} />
                        <span className="text-sm font-medium">{uploadStatus || 'Aguardando arquivos...'}</span>
                        {isProcessing && <span className="ml-2 text-xs font-bold bg-blue-100 text-blue-600 px-2 py-1 rounded">{processProgress.current}/{processProgress.total}</span>}
                    </div>
                    <div className="flex gap-3">
                        <button onClick={runBatch} disabled={isProcessing || fileQueue.length === 0} className="group px-6 py-3 rounded-xl font-bold text-white bg-[#1D1D1F] hover:bg-black disabled:bg-gray-300 transition-all shadow-lg hover:shadow-xl flex items-center gap-2">
                            {isProcessing ? <><Icon name="Loader2" className="animate-spin" size={18} /> Processando...</> : <>Processar Lista <Icon name="Play" size={18} /></>}
                        </button>
                        {processedData.length > 0 && (
                            <button onClick={handleExport} className="px-6 py-3 rounded-xl font-bold text-white bg-[#00D655] hover:bg-[#00c24e] transition-all shadow-lg hover:shadow-xl flex items-center gap-2 animate-fade-in-up">
                                Baixar Excel <Icon name="Download" size={20} />
                            </button>
                        )}
                    </div>
                </div>

                {processedData.length > 0 && (
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-in-up mb-8">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-gray-900">Preview ({processedData.length})</h3>
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50"><tr>{FINAL_HEADERS.slice(0, 8).map(h => <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">{h}</th>)}</tr></thead>
                                <tbody className="bg-white divide-y divide-gray-200">{processedData.slice(0, 10).map((row, idx) => <tr key={idx} className="hover:bg-gray-50">{FINAL_HEADERS.slice(0, 8).map(h => <td key={h} className="px-4 py-3 whitespace-nowrap text-gray-700">{row[h as keyof ProcessedRow] || '-'}</td>)}</tr>)}</tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;