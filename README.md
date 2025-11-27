# 🔋 Hube Power BI Manager

> **Processador inteligente de planilhas Excel para consolidação de dados de projetos de energia solar**

[![Firebase](https://img.shields.io/badge/Firebase-Hosting-orange?logo=firebase)](https://firebase.google.com/)
[![React](https://img.shields.io/badge/React-18.2-blue?logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-4.4-purple?logo=vite)](https://vitejs.dev/)

---

## 📋 Índice

- [O Problema](#-o-problema)
- [A Solução](#-a-solução)
- [Screenshots](#-screenshots)
- [Funcionalidades](#-funcionalidades)
- [Como Rodar](#-como-rodar)
  - [Desenvolvimento](#desenvolvimento)
  - [Produção](#produção)
- [Configuração](#-configuração)
  - [Firebase](#1-firebase)
  - [Planilhas de Entrada](#2-planilhas-de-entrada)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Tecnologias](#-tecnologias)

---

## 🎯 O Problema

Empresas de energia solar gerenciam **múltiplos projetos** (LNV, ALA, EGS, ESP, EMG, MTX) com dados financeiros distribuídos em **dezenas de planilhas Excel** com formatos diferentes:

- ❌ **Formatos inconsistentes**: Cada projeto tem sua própria estrutura de colunas
- ❌ **Dados sujos**: Datas em formatos variados, valores com símbolos, instalações com caracteres especiais
- ❌ **Processamento manual**: Horas gastas consolidando dados manualmente
- ❌ **Erros humanos**: Cálculos incorretos, filtros esquecidos, dados duplicados
- ❌ **Falta de memória**: Datas de corte perdidas entre sessões

---

## ✨ A Solução

O **Hube Power BI Manager** é uma aplicação web moderna que:

✅ **Detecta automaticamente** o projeto de cada planilha  
✅ **Normaliza dados** (instalações, distribuidoras, datas, status)  
✅ **Filtra inteligentemente** por data de corte e regras de negócio  
✅ **Calcula automaticamente** economia, risco, dias de atraso  
✅ **Consolida tudo** em um único arquivo Excel padronizado  
✅ **Lembra configurações** via Firebase (memória coletiva na nuvem)

**Resultado**: De **horas** para **segundos** ⚡

---

## 📸 Screenshots

### 1. Interface de Upload
![Upload Interface](C:/Users/Stefan_Pratti/.gemini/antigravity/brain/a4baeb9a-ca22-415b-92e5-023c685718d5/app_upload_interface_1764255842560.png)
*Arraste e solte seus arquivos Excel - a aplicação detecta automaticamente os projetos*

### 2. Fila de Processamento
![Processing Queue](C:/Users/Stefan_Pratti/.gemini/antigravity/brain/a4baeb9a-ca22-415b-92e5-023c685718d5/app_processing_queue_1764255859365.png)
*Configure siglas de projeto e datas de corte - valores são salvos na nuvem para próximas sessões*

### 3. Preview dos Dados
![Data Preview](C:/Users/Stefan_Pratti/.gemini/antigravity/brain/a4baeb9a-ca22-415b-92e5-023c685718d5/app_data_preview_1764255877344.png)
*Visualize os dados processados antes de exportar*

---

## 🚀 Funcionalidades

### Processamento Inteligente
- 🔍 **Detecção automática de projetos** via coluna `PROJETO` ou entrada manual
- 📅 **Filtro por data de corte** (ignora referências antigas)
- 🧹 **Normalização de dados**:
  - Instalações: apenas números (`10/530195-7` → `105301957`)
  - Distribuidoras: maiúsculas sem underscores (`energisa_mt` → `ENERGISA MT`)
  - Datas: formato brasileiro (`DD/MM/AAAA`)
  - Status: transformações (`Acordo` → `Negociado`, ignora `Cancelado`)

### Cálculos Automáticos
- 💰 **Economia**: `Custo sem GD - Custo com GD`
- ⚠️ **Risco**: Baseado em status e dias de atraso
- 📊 **Dias Atrasados**: Calculado a partir do vencimento

### Memória Coletiva (Firebase)
- ☁️ **Sincronização de datas de corte** entre usuários
- 🔄 **Configurações persistentes** (não perde dados ao fechar o navegador)

### Interface Moderna
- 🎨 **Design Apple-inspired** (glassmorphism, animações suaves)
- 📱 **Responsivo** (funciona em desktop e tablet)
- ⚡ **Web Workers** (processamento em background, UI sempre responsiva)

---

## 🏃 Como Rodar

### Desenvolvimento

```bash
# 1. Clone o repositório
git clone https://github.com/stefanprati-rgb/hube-powerbi-manager.git
cd hube-powerbi-manager

# 2. Instale as dependências
npm install

# 3. Configure o Firebase (veja seção "Configuração")
# Edite src/config/firebase.ts com suas credenciais

# 4. Inicie o servidor de desenvolvimento
npm run dev

# 5. Abra no navegador
# http://localhost:5173
```

### Produção

```bash
# 1. Build da aplicação
npm run build

# 2. Preview local (opcional)
npm run preview

# 3. Deploy no Firebase Hosting
firebase deploy --only hosting

# Ou use GitHub Actions (já configurado em .github/workflows)
# Basta fazer push para a branch main
```

---

## ⚙️ Configuração

### 1. Firebase

#### Criar Projeto Firebase

1. Acesse [Firebase Console](https://console.firebase.google.com/)
2. Clique em **"Adicionar projeto"**
3. Nome do projeto: `hube-powerbi-manager` (ou outro de sua escolha)
4. Desabilite Google Analytics (opcional)
5. Clique em **"Criar projeto"**

#### Configurar Firestore Database

1. No menu lateral, vá em **"Firestore Database"**
2. Clique em **"Criar banco de dados"**
3. Modo: **"Produção"** (ou "Teste" para desenvolvimento)
4. Localização: `southamerica-east1` (São Paulo)
5. Clique em **"Ativar"**

#### Configurar Regras de Segurança

No Firestore, vá em **"Regras"** e adicione:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Permite leitura/escrita em app_settings para todos
    match /app_settings/{document=**} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ **Atenção**: Estas regras permitem acesso público. Para produção, implemente autenticação.

#### Obter Credenciais

1. Vá em **"Configurações do projeto"** (ícone de engrenagem)
2. Role até **"Seus aplicativos"**
3. Clique no ícone **Web** (`</>`)
4. Registre o app: `Hube Power BI Manager`
5. Copie as credenciais do `firebaseConfig`

#### Configurar no Projeto

Edite `src/config/firebase.ts`:

```typescript
const firebaseConfig = {
    apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    authDomain: "hube-powerbi-manager.firebaseapp.com",
    projectId: "hube-powerbi-manager",
    storageBucket: "hube-powerbi-manager.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef1234567890"
};
```

#### Configurar Hosting (Opcional)

```bash
# Instale Firebase CLI
npm install -g firebase-tools

# Faça login
firebase login

# Inicialize o projeto
firebase init hosting

# Selecione:
# - Use an existing project: hube-powerbi-manager
# - Public directory: dist
# - Single-page app: Yes
# - GitHub Actions: Yes (opcional)
```

---

### 2. Planilhas de Entrada

#### Formato Esperado

As planilhas devem conter **pelo menos uma das seguintes colunas de identificação**:

| Coluna Obrigatória | Descrição |
|-------------------|-----------|
| `Instalação` ou `Instalacao` | Número da instalação |
| `CNPJ/CPF` ou `CNPJ` | Documento do cliente |

#### Colunas Reconhecidas (Mapeamento EGS)

A aplicação mapeia automaticamente estas colunas:

| Coluna Original | Coluna Final | Descrição |
|----------------|--------------|-----------|
| `Região` | `Região` | Região do projeto |
| `Instalação` | `Instalação` | Número da instalação |
| `CNPJ` | `CNPJ/CPF` | Documento |
| `Distribuidora` | `Distribuidora` | Concessionária |
| `Status` | `Status` | Status do pagamento |
| `Mês de Referência` | `Mês de Referência` | Competência |
| `Data de Emissão` | `Data de Emissão` | Data de emissão |
| `Vencimento` | `Vencimento` | Data de vencimento |
| `Custo sem GD R$` | `Custo sem GD R$` | Valor sem desconto |
| `Custo com GD R$` | `Custo com GD R$` | Valor com desconto |
| `Economia R$` | `Economia R$` | Economia gerada |
| `Desconto contrato (%)` | `Desconto contrato (%)` | Percentual de desconto |

#### Coluna PROJETO (Recomendada)

Para detecção automática, adicione uma coluna `PROJETO` com as siglas:

| Sigla | Projeto |
|-------|---------|
| `LNV` | Lenovo |
| `ALA` | Alamo |
| `ESP` | Esparta |
| `EMG` | Energia MG |
| `EGS` | EGS |
| `MTX` | Matrix |

**Exemplo de planilha válida:**

| PROJETO | Instalação | CNPJ/CPF | Distribuidora | Status | Mês de Referência | Vencimento | Custo sem GD R$ | Custo com GD R$ |
|---------|-----------|----------|---------------|--------|-------------------|------------|-----------------|-----------------|
| EGS | 10/530195-7 | 12.345.678/0001-90 | energisa_mt | Pago | 01/2025 | 15/02/2025 | 1500.00 | 1125.00 |
| LNV | 20456789 | 987.654.321-00 | CEMIG | Atrasado | 12/2024 | 10/01/2025 | 2000.00 | 1600.00 |

#### Regras de Filtragem

A aplicação **ignora** automaticamente:

- ❌ Linhas com status `Cancelado` ou `Não faturado`
- ❌ Referências **anteriores** à data de corte configurada
- ❌ Linhas sem `Instalação` **E** sem `CNPJ/CPF`

#### Transformações Aplicadas

| Status Original | Status Final |
|----------------|--------------|
| `Acordo` | `Negociado` |
| `Pago` | `Pago` |
| `Atrasado` / `Atraso` | `Atrasado` |

---

## 📁 Estrutura do Projeto

```
hube-powerbi-manager/
├── src/
│   ├── components/          # Componentes React
│   │   ├── FileItem.tsx     # Item da fila de processamento
│   │   └── Icon.tsx         # Wrapper de ícones Lucide
│   ├── config/              # Configurações
│   │   ├── constants.ts     # Constantes (projetos, mapeamentos)
│   │   └── firebase.ts      # Configuração Firebase
│   ├── modules/             # Lógica de negócio
│   │   ├── businessRules.ts # Regras de filtro e risco
│   │   ├── currencyMath.ts  # Parsing de moeda e cálculos
│   │   ├── dateParser.ts    # Parsing e formatação de datas
│   │   └── stringNormalizer.ts # Normalização de strings
│   ├── workers/             # Web Workers
│   │   └── excel.worker.ts  # Processamento de Excel em background
│   ├── types/               # TypeScript types
│   │   └── index.ts
│   ├── App.tsx              # Componente principal
│   ├── main.tsx             # Entry point
│   └── index.css            # Estilos globais
├── .github/
│   └── workflows/
│       └── firebase-hosting.yml # CI/CD automático
├── firebase.json            # Configuração Firebase Hosting
├── package.json
├── tsconfig.json
├── vite.config.js
└── README.md
```

---

## 🛠️ Tecnologias

### Frontend
- **React 18** - Biblioteca UI
- **TypeScript 5.9** - Type safety
- **Vite 4** - Build tool ultrarrápido
- **Tailwind CSS 3** - Utility-first CSS
- **Lucide React** - Ícones modernos

### Processamento
- **SheetJS (xlsx)** - Leitura/escrita de Excel
- **Web Workers** - Processamento paralelo sem travar a UI

### Backend/Cloud
- **Firebase Firestore** - Banco de dados NoSQL
- **Firebase Hosting** - Hospedagem estática

### DevOps
- **GitHub Actions** - CI/CD automático
- **ESLint** - Linting
- **PostCSS** - Processamento CSS

---

## 📝 Notas Importantes

### Performance
- ✅ Processa **milhares de linhas** sem travar o navegador (Web Workers)
- ✅ Detecção automática de projetos em **< 100ms** por arquivo
- ✅ UI sempre responsiva durante processamento

### Segurança
- ⚠️ **Dados processados localmente** (não são enviados para servidor)
- ⚠️ **Apenas datas de corte** são salvas no Firebase
- ⚠️ Para produção, implemente autenticação Firebase

### Limitações
- 📌 Suporta apenas `.xlsx`, `.xls`, `.csv`
- 📌 Requer coluna `Instalação` **OU** `CNPJ/CPF`
- 📌 Datas de corte são compartilhadas entre todos os usuários

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Para mudanças importantes:

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/MinhaFeature`)
3. Commit suas mudanças (`git commit -m 'Add: MinhaFeature'`)
4. Push para a branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

---

## 📄 Licença

Este projeto é privado e proprietário da **Hube Energy**.

---

## 👨‍💻 Autor

**Stefan Pratti**  
Desenvolvido para Hube Energy

---

## 🆘 Suporte

Encontrou um bug ou tem uma sugestão?  
Abra uma [issue](https://github.com/stefanprati-rgb/hube-powerbi-manager/issues) no GitHub.

---

**Feito com ❤️ e ☕ para otimizar processos de energia solar** ⚡
