import React, { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Icon from './components/Icon';
import { processSheetData, FINAL_HEADERS } from './utils/excelHelpers';
import type { FileQueueItem, ProcessingProgress, ProcessedRow } from './types';

function App() {
    const [fileQueue, setFileQueue] = useState<FileQueueItem[]>([]);
    const [processedData, setProcessedData] = useState<ProcessedRow[]>([]);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [isDragOver, setIsDragOver] = useState<boolean>(false);
    const [uploadStatus, setUploadStatus] = useState<string>('');
    const [processProgress, setProcessProgress] = useState<ProcessingProgress>({ current: 0, total: 0 });
    const [cutoffDate, setCutoffDate] = useState<string>('2025-06-01');

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<HTMLDivElement>) => {
        const files = Array.from(e.target.files || e.dataTransfer.files);

        // Validate file types
        const validExtensions = ['.xlsx', '.xls', '.csv'];
        const invalidFiles = files.filter(f =>
            !validExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
        );

        if (invalidFiles.length > 0) {
            setUploadStatus(`⚠️ Arquivos inválidos detectados. Apenas .xlsx, .xls e .csv são permitidos.`);
            return;
        }

        if (files.length > 0) {
            const newFiles = files.map(f => ({
                file: f,
                id: Date.now() + Math.random(),
                manualCode: '',
                status: 'idle',
                errorMessage: ''
            }));
            setFileQueue(prev => [...prev, ...newFiles]);
            setUploadStatus(`${files.length} arquivo(s) adicionado(s).`);
        }
    };

    const updateManualCode = (id: number, code: string) => {
        setFileQueue(prev => prev.map(item =>
            item.id === id ? { ...item, manualCode: code, status: 'idle', errorMessage: '' } : item
        ));
    };

    const removeFile = (id: number) => {
        setFileQueue(prev => prev.filter(item => item.id !== id));
    };

    const runBatch = async () => {
        if (fileQueue.length === 0) return;
        setIsProcessing(true);
        setProcessProgress({ current: 0, total: fileQueue.length });
        setUploadStatus('Iniciando...');

        const allData = [];
        let hasErrors = false;

        let currentQueue = [...fileQueue];

        for (let i = 0; i < fileQueue.length; i++) {
            const item = fileQueue[i];
            setProcessProgress({ current: i + 1, total: fileQueue.length });

            try {
                currentQueue[i] = { ...item, status: 'processing' };
                setFileQueue([...currentQueue]);
                setUploadStatus(`Processando ${i + 1}/${fileQueue.length}: ${item.file.name}...`);

                await new Promise(r => setTimeout(r, 50));

                const data = await item.file.arrayBuffer();
                const workbook = XLSX.read(data);

                let validSheetsFound = 0;
                let itemErrors = false;

                for (const sheetName of workbook.SheetNames) {
                    setUploadStatus(`Analisando: ${item.file.name} • Aba: ${sheetName}`);
                    await new Promise(r => setTimeout(r, 10));

                    const worksheet = workbook.Sheets[sheetName];

                    const headerData = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 0, limit: 1 });
                    if (headerData.length === 0) continue;

                    const headers = headerData[0].map(h => String(h).trim());
                    const headersLower = headers.map(h => h.toLowerCase());

                    const keyColumns = ["instalação", "valor", "referência", "projeto", "status"];
                    const matchCount = headersLower.filter(h => keyColumns.some(k => h.includes(k))).length;

                    if (matchCount < 2) continue;

                    const hasProjectColumn = headersLower.includes("projeto");

                    if (!hasProjectColumn && (!item.manualCode || item.manualCode.trim() === "")) {
                        itemErrors = true;
                        continue;
                    }

                    const sheetJson = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                    const result = processSheetData(sheetJson, item.file.name, sheetName, item.manualCode, cutoffDate);

                    if (result.rows.length > 0) {
                        allData.push(...result.rows);
                        validSheetsFound++;
                    }
                }

                if (itemErrors) {
                    hasErrors = true;
                    currentQueue[i] = { ...item, status: 'error', errorMessage: '⚠️ Aba sem Projeto detectada' };
                } else if (validSheetsFound === 0) {
                    currentQueue[i] = { ...item, status: 'success', errorMessage: '' };
                } else {
                    currentQueue[i] = { ...item, status: 'success', errorMessage: '' };
                }

            } catch (error) {
                console.error(error);
                hasErrors = true;
                currentQueue[i] = { ...item, status: 'error', errorMessage: 'Erro na leitura' };
            }

            setFileQueue([...currentQueue]);
        }

        if (!hasErrors) {
            setProcessedData(allData);
            setUploadStatus(`Concluído! ${allData.length} linhas processadas.`);
        } else {
            setProcessedData([]);
            setUploadStatus('Atenção: Resolva os erros de Projeto pendentes.');
        }

        setIsProcessing(false);
    };

    const handleExport = () => {
        if (processedData.length === 0) return;
        const ws = XLSX.utils.json_to_sheet(processedData, { header: FINAL_HEADERS, skipHeader: false });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Dados Consolidados");
        XLSX.writeFile(wb, "Relatorio_Hube_Consolidado.xlsx");
    };

    const onDragOver = useCallback((e) => { e.preventDefault(); setIsDragOver(true); }, []);
    const onDragLeave = useCallback((e) => { e.preventDefault(); setIsDragOver(false); }, []);
    const onDrop = useCallback((e) => {
        e.preventDefault(); setIsDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            const newFiles = files.map(f => ({
                file: f,
                id: Date.now() + Math.random(),
                manualCode: '',
                status: 'idle',
                errorMessage: ''
            }));
            setFileQueue(prev => [...prev, ...newFiles]);
            setUploadStatus(`${files.length} arquivo(s) adicionado(s).`);
        }
    }, []);

    return (
        <div className="min-h-screen pb-20 relative">
            <header className="glass-header sticky top-0 z-40 px-6 py-4 flex justify-between items-center mb-8">
                <div className="flex items-center gap-4">
                    <img src="https://hube.energy/wp-content/uploads/2024/10/Logo-1.svg" className="h-8 w-auto" alt="Hube Logo" onError={(e) => { e.target.style.display = 'none' }} />
                    <div className="h-6 w-px bg-gray-300 mx-2"></div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Power BI Manager</h1>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm">
                        <Icon name="Calendar" size={16} className="text-gray-400" />
                        <div className="flex flex-col">
                            <label className="text-[9px] font-bold uppercase text-gray-400 mb-0.5">Data de Corte</label>
                            <input
                                type="date"
                                value={cutoffDate}
                                onChange={(e) => setCutoffDate(e.target.value)}
                                className="text-sm font-semibold text-gray-900 border-none outline-none bg-transparent cursor-pointer"
                                title="Apenas dados a partir desta data serão processados"
                            />
                        </div>
                    </div>
                    {fileQueue.length > 0 && (
                        <button onClick={() => { if (confirm("Limpar tudo?")) { setFileQueue([]); setProcessedData([]); } }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all" title="Limpar Lista">
                            <Icon name="Trash" size={20} />
                        </button>
                    )}
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6">
                {fileQueue.length > 0 ? (
                    <div className="flex-1 flex flex-col mb-8">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Fila de Arquivos</h2>
                            <label className="text-[#00D655] text-sm font-medium cursor-pointer hover:underline flex items-center gap-1">
                                <Icon name="UploadCloud" size={16} /> Adicionar mais
                                <input type="file" className="hidden" multiple accept=".xlsx,.xls,.csv" onChange={handleFileUpload} />
                            </label>
                        </div>

                        <div className="space-y-3">
                            {fileQueue.map((item, index) => (
                                <div key={item.id} className={`
                      relative bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border transition-all duration-200 animate-fade-in-up
                      ${item.status === 'error' ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-100 hover:shadow-md'}
                      ${item.status === 'processing' ? 'border-blue-400 ring-2 ring-blue-100' : ''}
                  `}>
                                    <div className={`
                        w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors
                        ${item.status === 'idle' ? 'bg-gray-100 text-gray-400' : ''}
                        ${item.status === 'processing' ? 'bg-blue-50 text-blue-500' : ''}
                        ${item.status === 'success' ? 'bg-[#00D655]/10 text-[#00D655]' : ''}
                        ${item.status === 'error' ? 'bg-red-100 text-red-500' : ''}
                      `}>
                                        {item.status === 'idle' && <Icon name="FileSpreadsheet" size={20} />}
                                        {item.status === 'processing' && <div className="animate-spin"><Icon name="Loader2" size={20} /></div>}
                                        {item.status === 'success' && <Icon name="Check" size={20} />}
                                        {item.status === 'error' && <Icon name="AlertTriangle" size={20} />}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <h3 className={`text-sm font-semibold truncate ${item.status === 'error' ? 'text-red-600' : 'text-[#1D1D1F]'}`}>{item.file.name}</h3>
                                        {item.status === 'error' ? (
                                            <p className="text-xs text-red-500 font-bold mt-0.5 animate-pulse">{item.errorMessage}</p>
                                        ) : (
                                            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">{(item.file.size / 1024).toFixed(0)} KB</p>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-3 border-l pl-3 border-gray-100">
                                        <div className="flex flex-col items-end group">
                                            <label className={`text-[9px] font-bold uppercase mb-0.5 mr-1 transition-colors ${item.status === 'error' ? 'text-red-500' : 'text-gray-300 group-hover:text-[#00D655]'}`}>
                                                Cód. Projeto
                                            </label>
                                            <input
                                                type="text"
                                                className={`ios-input w-28 p-1.5 text-center uppercase font-bold text-xs rounded-lg border outline-none placeholder-gray-300 focus:bg-white
                                ${item.status === 'error' ? 'border-red-300 bg-red-50 text-red-800 placeholder-red-200 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 text-[#1D1D1F] bg-gray-50'}
                              `}
                                                placeholder={item.status === 'error' ? "DIGITE AQUI" : "Opcional"}
                                                value={item.manualCode}
                                                onChange={(e) => updateManualCode(item.id, e.target.value)}
                                            />
                                        </div>
                                        <button onClick={() => removeFile(item.id)} className="p-2 text-gray-300 hover:text-red-500 transition-colors rounded-full hover:bg-gray-50">
                                            <Icon name="X" size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                        className={`drop-zone relative h-64 rounded-3xl flex flex-col items-center justify-center text-center p-8 mb-8 border-2 border-dashed transition-all duration-300 ${isDragOver ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                        <input type="file" multiple accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                        <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                            <Icon name="UploadCloud" size={32} className="text-blue-500" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Arraste seus arquivos aqui</h3>
                        <p className="text-gray-500 max-w-md mx-auto">Processamento automático de todas as abas.</p>
                    </div>
                )}

                <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-10">
                    <div className={`flex items-center gap-3 px-4 py-2 rounded-full shadow-sm border transition-colors ${processedData.length === 0 && fileQueue.some(f => f.status === 'error') ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-gray-100 text-gray-600'}`}>
                        <Icon name="Info" size={16} />
                        <span className="text-sm font-medium">{uploadStatus || "Aguardando arquivos..."}</span>
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
                                            <th key={header} className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
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
                                                    {row[header] || '-'}
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
