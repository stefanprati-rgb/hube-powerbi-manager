// src/App.tsx
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './config/firebase';
import Icon from './components/Icon';
import FileItem from './components/FileItem';
import ProcessingIndicator from './components/ProcessingIndicator';
import { FINAL_HEADERS, VALID_PROJECT_CODES } from './config/constants';
import type { FileQueueItem, ProcessingProgress, ProcessedRow } from './types';
import ExcelWorker from './workers/excel.worker?worker';

const DEFAULT_CUTOFFS: Record<string, string> = {
    'LNV': '2025-01-01', 'ALA': '2025-01-01', 'ESP': '2025-05-01',
    'EMG': '2025-05-01', 'EGS': '2025-06-01', 'MTX': '2025-01-01',
    'DEFAULT': '2025-01-01'
};

function App() {
    const [fileQueue, setFileQueue] = useState<FileQueueItem[]>([]);
    const [processedData, setProcessedData] = useState<ProcessedRow[]>([]);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
    const [isDragOver, setIsDragOver] = useState<boolean>(false);
    const [uploadStatus, setUploadStatus] = useState<string>('');
    const [processProgress, setProcessProgress] = useState<ProcessingProgress>({ current: 0, total: 0 });
    const [currentFileName, setCurrentFileName] = useState<string>('');
    const [cloudCutoffs, setCloudCutoffs] = useState<Record<string, string>>(DEFAULT_CUTOFFS);

    // Carrega configurações da nuvem
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const docRef = doc(db, "app_settings", "cutoffs");
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setCloudCutoffs(prev => ({ ...prev, ...docSnap.data() }));
                }
            } catch (error) {
                console.warn("Modo Offline ou erro no Firebase.");
            }
        };
        loadSettings();
    }, []);

    const validExtensions = useMemo(() => ['.xlsx', '.xls', '.csv'], []);

    const getInitialDate = (projCode: string = 'DEFAULT') => {
        const code = projCode.toUpperCase();
        return cloudCutoffs[code] || DEFAULT_CUTOFFS['DEFAULT'];
    };

    const normalizeFiles = (fileList: FileList | File[]): File[] =>
        Array.from(fileList).filter(f => validExtensions.some(ext => f.name.toLowerCase().endsWith(ext)));

    const isCodeValid = (code: string) => code && VALID_PROJECT_CODES.includes(code.toUpperCase());

    /* --- Adição de Arquivos --- */
    const addFilesToQueue = async (files: File[]) => {
        if (!files.length) return;
        setIsAnalyzing(true);
        setUploadStatus(`Medindo a carga de ${files.length} arquivo(s)...`);

        const newItems: FileQueueItem[] = [];
        await new Promise(resolve => setTimeout(resolve, 50));

        for (const file of files) {
            try {
                const buffer = await file.arrayBuffer();
                const analysisResult = await new Promise<{ projects: string[], projectCounts: Record<string, number> }>((resolve) => {
                    const worker = new ExcelWorker();
                    worker.postMessage({ action: 'analyze', fileBuffer: buffer });
                    worker.onmessage = (e) => {
                        worker.terminate();
                        resolve(e.data.success
                            ? { projects: e.data.projects || [], projectCounts: e.data.projectCounts || {} }
                            : { projects: [], projectCounts: {} }
                        );
                    };
                    worker.onerror = () => { worker.terminate(); resolve({ projects: [], projectCounts: {} }); };
                });

                const { projects, projectCounts } = analysisResult;

                if (projects.length > 0) {
                    // Ordena projetos por contagem (maior primeiro) para sugerir o principal
                    const sortedProjects = Object.entries(projectCounts)
                        .sort(([, a], [, b]) => b - a);
                    const mainProject = sortedProjects.length > 0 ? sortedProjects[0][0] : projects[0];

                    // Cria apenas 1 item por arquivo com a contagem detalhada
                    newItems.push({
                        file,
                        id: Date.now() + Math.random(),
                        manualCode: mainProject,
                        targetProject: undefined, // Não filtramos mais por projeto
                        cutoffDate: getInitialDate(mainProject),
                        status: 'idle',
                        errorMessage: '',
                        projectCounts
                    });
                } else {
                    // Genérico ou EGS sem coluna projeto
                    newItems.push({
                        file,
                        id: Date.now() + Math.random(),
                        manualCode: '',
                        targetProject: undefined,
                        cutoffDate: getInitialDate('DEFAULT'),
                        status: 'idle',
                        errorMessage: '',
                        projectCounts: {}
                    });
                }
            } catch (e) {
                console.error("Erro:", file.name);
                newItems.push({
                    file,
                    id: Date.now(),
                    manualCode: '',
                    cutoffDate: getInitialDate('DEFAULT'),
                    status: 'idle',
                    errorMessage: 'Erro na leitura',
                    projectCounts: {}
                });
            }
        }

        setFileQueue(prev => [...prev, ...newItems]);
        setIsAnalyzing(false);
        const totalLines = newItems.reduce((sum, item) =>
            sum + Object.values(item.projectCounts || {}).reduce((a, b) => a + b, 0), 0
        );
        setUploadStatus(`Carga identificada! ${newItems.length} arquivo(s) com ${totalLines.toLocaleString()} registros`);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<HTMLDivElement>) => {
        const list = 'dataTransfer' in e ? e.dataTransfer.files : e.target.files;
        if (!list) return;
        addFilesToQueue(normalizeFiles(list));
    };

    /* --- Updates de UI --- */
    const updateItemField = (id: number, field: 'manualCode' | 'cutoffDate', value: string) => {
        setFileQueue(prev => prev.map(it => {
            if (it.id === id) {
                if (field === 'manualCode') {
                    const newCode = value.toUpperCase();
                    const newDate = cloudCutoffs[newCode] ? getInitialDate(newCode) : it.cutoffDate;
                    return { ...it, manualCode: newCode, targetProject: newCode, cutoffDate: newDate, status: 'idle', errorMessage: '' };
                }
                return { ...it, [field]: value, status: 'idle', errorMessage: '' };
            }
            return it;
        }));
    };

    const removeFile = (id: number) => setFileQueue(prev => prev.filter(it => it.id !== id));

    /* --- Processamento --- */
    const runBatch = async () => {
        const pendingItems = fileQueue.filter(f => f.status !== 'success');
        if (!pendingItems.length) { alert("Todos os arquivos já foram processados."); return; }

        // Validação simples: Apenas verifica se tem sigla válida
        const invalidItems = pendingItems.filter(item => !isCodeValid(item.manualCode));
        if (invalidItems.length > 0) {
            alert(`Erro: Existem arquivos sem Sigla válida (ex: EGS, LNV). Preencha antes de processar.`);
            setFileQueue(prev => prev.map(it => !isCodeValid(it.manualCode) && it.status !== 'success' ? { ...it, status: 'error', errorMessage: 'Sigla Obrigatória' } : it));
            return;
        }

        setIsProcessing(true);
        setProcessProgress({ current: 0, total: fileQueue.length });
        setUploadStatus('Compensando energia...');

        const allData: ProcessedRow[] = [...processedData];
        let hasErrors = false;
        const newCloudData: Record<string, string> = {};

        for (let i = 0; i < fileQueue.length; i++) {
            const item = fileQueue[i];

            if (item.status === 'success') { setProcessProgress(prev => ({ ...prev, current: i + 1 })); continue; }

            setProcessProgress(prev => ({ ...prev, current: i + 1 }));
            setCurrentFileName(item.file.name);
            setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'processing' } : it));

            try {
                if (item.manualCode) newCloudData[item.manualCode] = item.cutoffDate;

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
                    worker.onmessage = (e) => { worker.terminate(); if (e.data.success) resolve(e.data.rows); else reject(new Error(e.data.error)); };
                    worker.onerror = () => { worker.terminate(); reject(new Error("Falha no Worker")); };
                });

                if (processedRows.length > 0) {
                    allData.push(...processedRows);
                    setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'success', errorMessage: '' } : it));
                } else {
                    setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'success', errorMessage: '0 linhas (filtro data?)' } : it));
                }
            } catch (err: any) {
                hasErrors = true;
                setFileQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'error', errorMessage: err.message.substring(0, 60) } : it));
            }
        }

        // Salvar na Nuvem
        if (Object.keys(newCloudData).length > 0) {
            try {
                await setDoc(doc(db, "app_settings", "cutoffs"), newCloudData, { merge: true });
                setCloudCutoffs(prev => ({ ...prev, ...newCloudData }));
            } catch (e) { console.error("Erro nuvem", e); }
        }

        if (!hasErrors) setUploadStatus(`Fatura consolidada! ${allData.length} cooperados prontos`);
        else setUploadStatus('Ops! Alguns medidores falharam');

        setProcessedData(allData);
        setCurrentFileName('');
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
    const onDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); addFilesToQueue(normalizeFiles(e.dataTransfer.files)); }, [validExtensions]);
    const clearAll = () => { if (confirm('Desligar tudo?')) { setFileQueue([]); setProcessedData([]); setUploadStatus(''); } };

    return (
        <div className="min-h-screen pb-20 relative bg-[#F5F5F7]">
            {isProcessing && (
                <ProcessingIndicator
                    current={processProgress.current}
                    total={processProgress.total}
                    fileName={currentFileName}
                />
            )}
            <header className="glass-header sticky top-0 z-40 px-6 py-4 flex justify-between items-center mb-8">
                <div className="flex items-center gap-4">
                    <img src="https://hube.energy/wp-content/uploads/2024/10/Logo-1.svg" className="h-8 w-auto" alt="Hube Logo" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
                    <div className="h-6 w-px bg-gray-300 mx-2"></div>
                    <h1 className="text-xl font-bold text-gray-900">Power BI Manager <span className="text-xs font-normal text-gray-500 ml-2">v15.1</span></h1>
                </div>
                <div className="flex items-center gap-4">{fileQueue.length > 0 && <button onClick={clearAll} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"><Icon name="Trash" size={20} /></button>}</div>
            </header>

            <main className="max-w-5xl mx-auto px-6">
                <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} className={`drop-zone relative rounded-3xl flex flex-col items-center justify-center text-center p-8 mb-8 border-2 border-dashed transition-all duration-300 ${isDragOver ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-gray-200 hover:border-gray-300'} ${fileQueue.length > 0 ? 'h-40' : 'h-64'}`}>
                    <input type="file" multiple accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" disabled={isAnalyzing} />
                    {isAnalyzing ? (
                        <div className="flex flex-col items-center animate-pulse">
                            <div className="animate-spin mb-4 text-[#00D655]"><Icon name="Loader2" size={40} /></div>
                            <h3 className="text-lg font-bold text-gray-800">Lendo o medidor...</h3>
                        </div>
                    ) : (
                        <>
                            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><Icon name="UploadCloud" size={32} className="text-blue-500" /></div>
                            <h3 className="text-xl font-bold text-gray-900 mb-2">{fileQueue.length > 0 ? 'Mais planilhas? Pode trazer!' : 'Solte seus kWh de dados aqui'}</h3>
                        </>
                    )}
                </div>

                {fileQueue.length > 0 && (
                    <div className="flex-1 flex flex-col mb-8">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Fila de Processamento</h2>
                        </div>
                        <div className="space-y-3">
                            {fileQueue.map(item => (
                                <FileItem
                                    key={item.id}
                                    item={item}
                                    isCodeValid={isCodeValid}
                                    onUpdateField={updateItemField}
                                    onRemove={removeFile}
                                />
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-10">
                    <div className={`flex items-center gap-3 px-4 py-2 rounded-full shadow-sm border transition-colors ${processedData.length === 0 && fileQueue.some(f => f.status === 'error') ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-gray-100 text-gray-600'}`}>
                        <Icon name="Info" size={16} />
                        <span className="text-sm font-medium">{uploadStatus || 'Pronto para faturar'}</span>
                        {isProcessing && <span className="ml-2 text-xs font-bold bg-blue-100 text-blue-600 px-2 py-1 rounded">{processProgress.current}/{processProgress.total}</span>}
                    </div>
                    <div className="flex gap-3">
                        <button onClick={runBatch} disabled={isProcessing || isAnalyzing || fileQueue.length === 0} className="group px-6 py-3 rounded-xl font-bold text-white bg-[#1D1D1F] hover:bg-black disabled:bg-gray-300 transition-all shadow-lg hover:shadow-xl flex items-center gap-2">
                            {isProcessing ? <><Icon name="Loader2" className="animate-spin" size={18} /> Gerando faturas...</> : <>Gerar Fatura <Icon name="Play" size={18} /></>}
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