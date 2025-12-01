// src/components/FileItem.tsx
import React from 'react';
import Icon from './Icon';
import { FileQueueItem } from '../types';
import { VALID_PROJECT_CODES } from '../config/constants';

interface FileItemProps {
    item: FileQueueItem;
    isCodeValid: (code: string) => boolean;
    // Atualizado: Removemos 'egsFileType' pois não é mais necessário
    onUpdateField: (id: number, field: 'manualCode' | 'cutoffDate', value: string) => void;
    onRemove: (id: number) => void;
}

const FileItem: React.FC<FileItemProps> = ({ item, isCodeValid, onUpdateField, onRemove }) => {
    return (
        <div className={`
            relative bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border transition-all duration-200 
            ${item.status === 'error' ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-100 hover:shadow-md'}
            ${item.status === 'processing' ? 'border-blue-400 ring-2 ring-blue-100' : ''}
        `}>
            {/* Ícone de Status */}
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

            {/* Informações do Arquivo */}
            <div className="flex-1 min-w-0">
                <h3 className={`text-sm font-semibold truncate ${item.status === 'error' ? 'text-red-600' : 'text-[#1D1D1F]'}`}>
                    {item.file.name}
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
                        onChange={e => onUpdateField(item.id, 'manualCode', e.target.value)}
                        title={!isCodeValid(item.manualCode) ? `Siglas válidas: ${VALID_PROJECT_CODES.join(', ')}` : ""}
                    />
                </div>

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