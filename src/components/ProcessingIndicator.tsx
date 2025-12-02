// src/components/ProcessingIndicator.tsx
import React from 'react';
import Icon from './Icon';

interface ProcessingIndicatorProps {
    current: number;
    total: number;
    fileName?: string;
}

const ProcessingIndicator: React.FC<ProcessingIndicatorProps> = ({ current, total, fileName }) => {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full mx-4 animate-scale-in">
                {/* Header */}
                <div className="flex items-center justify-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <div className="animate-spin text-white">
                            <Icon name="Loader2" size={32} />
                        </div>
                    </div>
                </div>

                {/* Title */}
                <h3 className="text-xl font-bold text-gray-900 text-center mb-2">
                    A processar...
                </h3>

                {/* File Name */}
                {fileName && (
                    <p className="text-sm text-gray-500 text-center mb-6 truncate px-4">
                        {fileName}
                    </p>
                )}

                {/* Progress Bar */}
                <div className="mb-4">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                            Progresso
                        </span>
                        <span className="text-sm font-bold text-gray-900">
                            {current} / {total}
                        </span>
                    </div>

                    {/* Progress Track */}
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${percentage}%` }}
                        />
                    </div>

                    {/* Percentage */}
                    <div className="text-center mt-3">
                        <span className="text-2xl font-bold text-gray-900">
                            {percentage}%
                        </span>
                    </div>
                </div>

                {/* Pulsing Dots */}
                <div className="flex justify-center gap-1.5 mt-6">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
            </div>
        </div>
    );
};

export default ProcessingIndicator;
