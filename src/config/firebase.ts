// src/config/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Substitua estes dados pelos do seu projeto!
// (Vá em: Configurações do Projeto > Geral > As suas aplicações > SDK setup)
const firebaseConfig = {
    apiKey: "SUA_API_KEY_AQUI",
    authDomain: "hube-powerbi-manager.firebaseapp.com",
    projectId: "hube-powerbi-manager",
    storageBucket: "hube-powerbi-manager.appspot.com",
    messagingSenderId: "...",
    appId: "..."
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
