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
    AlertTriangle,
    Calendar
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type IconName = 'UploadCloud' | 'FileSpreadsheet' | 'Info' | 'Loader2' | 'Play' | 'Download' | 'Table' | 'Check' | 'X' | 'Trash' | 'AlertTriangle' | 'Calendar';

interface IconProps {
    name: IconName;
    size?: number;
    className?: string;
}

const Icon: React.FC<IconProps> = ({ name, size = 20, className }) => {
    const icons: Record<IconName, LucideIcon> = {
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
        AlertTriangle,
        Calendar
    };

    const LucideIcon = icons[name];

    if (!LucideIcon) return null;

    return <LucideIcon size={size} className={className} />;
};

export default Icon;
