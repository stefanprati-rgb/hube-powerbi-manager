// src/services/settingsService.ts
import { db } from '../config/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const COLLECTION_NAME = 'project_settings';

export interface ProjectSettings {
    cutoffDate: string;
    updatedAt: string;
    updatedBy: string; // Pode ser útil no futuro
}

export const getProjectSettings = async (projectCode: string): Promise<ProjectSettings | null> => {
    try {
        const docRef = doc(db, COLLECTION_NAME, projectCode.toUpperCase());
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docSnap.data() as ProjectSettings;
        } else {
            return null;
        }
    } catch (error) {
        console.error(`Erro ao buscar configurações para ${projectCode}:`, error);
        return null;
    }
};

export const saveProjectSettings = async (projectCode: string, settings: Partial<ProjectSettings>) => {
    try {
        const docRef = doc(db, COLLECTION_NAME, projectCode.toUpperCase());
        await setDoc(docRef, {
            ...settings,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        console.log(`Configurações salvas para ${projectCode}`);
    } catch (error) {
        console.error(`Erro ao salvar configurações para ${projectCode}:`, error);
        throw error;
    }
};
