// src/components/FileItem.tsx
import React from 'react';
import Icon from './Icon';
import { FileQueueItem } from '../types';

interface FileItemProps {
    item: FileQueueItem;
    isCodeValid: (code: string) => boolean;
    onUpdateField: (id: number, field: 'manualCode' | 'cutoffDate', value: string) => void;
    onRemove: (id: number) => void;
}

// Helper para formatar número com separadores
const formatNumber = (num: number): string => {
    return num.toLocaleString('pt-BR');
};

// Helper para cor do badge baseado no projeto
const getBadgeColor = (project: string): string => {
    const colors: Record<string, string> = {
        'EGS': 'bg-purple-100 text-purple-700 border-purple-200',
        'EMG': 'bg-green-100 text-green-700 border-green-200',
        'ESP': 'bg-amber-100 text-amber-700 border-amber-200',
        'LNV': 'bg-blue-100 text-blue-700 border-blue-200',
        'ALA': 'bg-cyan-100 text-cyan-700 border-cyan-200',
        'MTX': 'bg-rose-100 text-rose-700 border-rose-200',
        'A Definir': 'bg-yellow-100 text-yellow-700 border-yellow-300',
    };
    return colors[project] || 'bg-gray-100 text-gray-700 border-gray-200';
};

// Lista de projetos para o ComboBox
const PROJECT_OPTIONS = ['EGS', 'EMG', 'ESP', 'LNV', 'ALA', 'MTX'];

const FileItem: React.FC<FileItemProps> = ({ item, isCodeValid, onUpdateField, onRemove }) => {

    // Verifica se tem linhas "A Definir" pendentes
    const hasPendingLines = item.projectCounts && item.projectCounts['A Definir'] > 0;

    // LÓGICA DE EXIBIÇÃO DO COMBO BOX
    // Só mostramos o select se:
    // 1. Não houver contagem de projetos (ainda não analisou)
    // 2. OU se houver linhas "A Definir" (Pendentes)
    const showProjectSelect = !item.projectCounts ||
        Object.keys(item.projectCounts).length === 0 ||
        Object.keys(item.projectCounts).includes('A Definir');

    // Renderiza os badges de contagem por projeto
    const renderProjectCounts = () => {
        if (!item.projectCounts || Object.keys(item.projectCounts).length === 0) return null;

        const entries = Object.entries(item.projectCounts).sort(([projA], [projB]) => {
            // "A Definir" sempre primeiro para chamar atenção
            if (projA === 'A Definir') return -1;
            if (projB === 'A Definir') return 1;
            return projB.localeCompare(projA);
        });
        const totalLines = entries.reduce((sum, [, count]) => sum + count, 0);

        return (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {entries.map(([proj, count]) => {
                    const isPending = proj === 'A Definir';
                    return (
                        <span
                            key={proj}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${getBadgeColor(proj)} ${isPending ? 'animate-pulse' : ''}`}
                        >
                            {isPending ? 'Pendentes' : proj}: <span className="font-black">{formatNumber(count)}</span>
                        </span>
                    );
                })}
                <span className="text-[10px] text-gray-400 ml-1">
                    ({formatNumber(totalLines)} total)
                </span>
            </div>
        );
    };

    return (
        <div className={`
            relative bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border transition-all duration-200 
            ${item.status === 'error' ? 'border-red-400 ring-2 ring-red-100' : ''}
            ${item.status === 'processing' ? 'border-blue-400 ring-2 ring-blue-100' : ''}
            ${hasPendingLines && item.status === 'idle' ? 'border-yellow-400 ring-2 ring-yellow-100' : 'border-gray-100 hover:shadow-md'}
        `}>
            {/* Ícone de Status */}
            <div className={`
                w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors
                ${item.status === 'idle' && !hasPendingLines ? 'bg-gray-100 text-gray-400' : ''}
                ${item.status === 'idle' && hasPendingLines ? 'bg-yellow-100 text-yellow-500' : ''}
                ${item.status === 'processing' ? 'bg-blue-50 text-blue-500' : ''}
                ${item.status === 'success' ? 'bg-[#00D655]/10 text-[#00D655]' : ''}
                ${item.status === 'error' ? 'bg-red-100 text-red-500' : ''}
            `}>
                {item.status === 'idle' && !hasPendingLines && <Icon name="FileSpreadsheet" size={20} />}
                {item.status === 'idle' && hasPendingLines && <Icon name="AlertCircle" size={20} />}
                {item.status === 'processing' && <div className="animate-spin"><Icon name="Loader2" size={20} /></div>}
                {item.status === 'success' && <Icon name="Check" size={20} />}
                {item.status === 'error' && <Icon name="AlertTriangle" size={20} />}
            </div>

            {/* Informações do Arquivo */}
            <div className="flex-1 min-w-0">
                <h3 className={`text-sm font-semibold truncate ${item.status === 'error' ? 'text-red-600' : 'text-[#1D1D1F]'}`}>
                    {item.file.name}
                </h3>

                {/* Badges de Contagem por Projeto */}
                {renderProjectCounts()}

                {item.status === 'error' ? (
                    <p className="text-xs text-red-500 font-bold mt-1 animate-pulse">
                        {item.errorMessage}
                    </p>
                ) : !item.projectCounts || Object.keys(item.projectCounts).length === 0 ? (
                    <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mt-1">
                        {(item.file.size / 1024).toFixed(0)} KB
                    </p>
                ) : null}
            </div>

            {/* Controles */}
            <div className="flex items-center gap-3 border-l pl-3 border-gray-100">

                <div className="flex flex-col items-end group">
                    <label className="text-[9px] font-bold uppercase mb-0.5 mr-1 text-gray-300 group-hover:text-blue-500 transition-colors">
                        Data Corte
                    </label>
                    <input
                        type="date"
                        value={item.cutoffDate}
                        onChange={e => onUpdateField(item.id, 'cutoffDate', e.target.value)}
                        className="ios-input w-28 p-1.5 text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#00D655]"
                    />
                </div>

                {/* Renderização Condicional do ComboBox */}
                {showProjectSelect && (
                    <div className="flex flex-col items-end group">
                        <label className={`text-[9px] font-bold uppercase mb-0.5 mr-1 transition-colors ${!isCodeValid(item.manualCode) || hasPendingLines
                                ? 'text-yellow-500'
                                : 'text-gray-300 group-hover:text-[#00D655]'
                            }`}>
                            Projeto
                        </label>
                        <select
                            value={item.manualCode || ''}
                            onChange={e => onUpdateField(item.id, 'manualCode', e.target.value)}
                            disabled={item.status === 'processing'}
                            className={`
                                ios-input w-20 p-1.5 text-center uppercase font-bold text-xs rounded-lg border outline-none focus:bg-white cursor-pointer
                                ${!isCodeValid(item.manualCode) || hasPendingLines
                                    ? 'border-yellow-300 bg-yellow-50 text-yellow-800 focus:border-yellow-500'
                                    : 'border-gray-200 bg-gray-50 text-[#1D1D1F] focus:border-[#00D655]'
                                }
                            `}
                        >
                            <option value="">???</option>
                            {PROJECT_OPTIONS.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    </div>
                )}

                <button
                    onClick={() => onRemove(item.id)}
                    className="p-2 text-gray-300 hover:text-red-500 transition-colors rounded-full hover:bg-gray-50"
                >
                    <Icon name="X" size={16} />
                </button>
            </div>
        </div>
    );
};

export default FileItem;