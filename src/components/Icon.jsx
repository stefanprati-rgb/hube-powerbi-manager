import React from 'react';
import {
    UploadCloud,
    FileSpreadsheet,
    Info,
    Loader2,
    Play,
    Download,
    Table,
    Check,
    X,
    Trash,
    AlertTriangle
} from 'lucide-react';

// Mapping for compatibility if we want to keep using string names, 
// or we can just use Lucide icons directly. 
// For now, let's keep the component interface compatible with the existing code
// but use Lucide icons which are nicer and standard.

const Icon = ({ name, size = 20, className }) => {
    const icons = {
        UploadCloud,
        FileSpreadsheet,
        Info,
        Loader2,
        Play,
        Download,
        Table,
        Check,
        X,
        Trash,
        AlertTriangle
    };

    const LucideIcon = icons[name];

    if (!LucideIcon) return null;

    return <LucideIcon size={size} className={className} />;
};

export default Icon;
