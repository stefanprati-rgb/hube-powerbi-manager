# Contribuindo para o Hube Power BI Manager

Obrigado pelo interesse em contribuir! Este documento fornece diretrizes para contribuir com o projeto.

## 📋 Índice

- [Código de Conduta](#código-de-conduta)
- [Como Posso Contribuir?](#como-posso-contribuir)
- [Padrões de Desenvolvimento](#padrões-de-desenvolvimento)
- [Processo de Pull Request](#processo-de-pull-request)
- [Reportar Bugs](#reportar-bugs)
- [Sugerir Features](#sugerir-features)

---

## Código de Conduta

Este projeto segue princípios de respeito e colaboração. Esperamos que todos os contribuidores:

- Sejam respeitosos e profissionais
- Aceitem feedback construtivo
- Foquem no que é melhor para a comunidade
- Demonstrem empatia com outros membros

---

## Como Posso Contribuir?

### 🐛 Reportar Bugs

Se encontrou um bug, por favor:

1. **Verifique** se o bug já foi reportado nas [Issues](https://github.com/stefanprati-rgb/hube-powerbi-manager/issues)
2. **Crie uma nova issue** com:
   - Título claro e descritivo
   - Passos para reproduzir o problema
   - Comportamento esperado vs. comportamento atual
   - Screenshots (se aplicável)
   - Versão do navegador e sistema operacional

**Template de Bug Report:**

```markdown
**Descrição do Bug**
Descrição clara e concisa do problema.

**Passos para Reproduzir**
1. Vá para '...'
2. Clique em '...'
3. Veja o erro

**Comportamento Esperado**
O que deveria acontecer.

**Screenshots**
Se aplicável, adicione screenshots.

**Ambiente**
- Navegador: [ex: Chrome 120]
- OS: [ex: Windows 11]
- Versão: [ex: v15.1]
```

### 💡 Sugerir Features

Para sugerir uma nova funcionalidade:

1. **Verifique** se já não existe uma issue similar
2. **Crie uma issue** com a tag `enhancement`
3. **Descreva**:
   - O problema que a feature resolve
   - Como você imagina a solução
   - Alternativas consideradas

**Template de Feature Request:**

```markdown
**Problema a Resolver**
Descrição clara do problema ou necessidade.

**Solução Proposta**
Como você imagina que isso funcionaria.

**Alternativas Consideradas**
Outras abordagens que você pensou.

**Contexto Adicional**
Qualquer outra informação relevante.
```

---

## Padrões de Desenvolvimento

### Stack Tecnológica

- **Frontend**: React 18 + TypeScript 5.9
- **Build**: Vite 4
- **Styling**: Tailwind CSS 3
- **Backend**: Firebase Firestore
- **Processamento**: Web Workers + SheetJS

### Estrutura de Código

```
src/
├── components/       # Componentes React reutilizáveis
├── config/          # Configurações (Firebase, constantes)
├── modules/         # Lógica de negócio (regras, parsers)
├── workers/         # Web Workers (processamento pesado)
├── types/           # TypeScript types
└── App.tsx          # Componente principal
```

### Convenções de Código

#### TypeScript

- Use **tipos explícitos** sempre que possível
- Evite `any`, prefira `unknown` ou tipos específicos
- Crie interfaces para objetos complexos em `src/types/`

```typescript
// ✅ Bom
interface ProcessedRow {
  projeto: string;
  instalacao: string;
  status: string;
}

// ❌ Evitar
const data: any = { ... };
```

#### React

- Use **functional components** com hooks
- Prefira `const` para componentes
- Use `useMemo` e `useCallback` para otimização

```typescript
// ✅ Bom
const MyComponent: React.FC<Props> = ({ data }) => {
  const processed = useMemo(() => processData(data), [data]);
  return <div>{processed}</div>;
};
```

#### CSS (Tailwind)

- Use classes utilitárias do Tailwind
- Para estilos complexos, use `@apply` em `index.css`
- Mantenha consistência com o design system existente

```tsx
// ✅ Bom
<button className="px-6 py-3 rounded-xl font-bold bg-blue-500 hover:bg-blue-600">
  Processar
</button>
```

#### Nomenclatura

- **Arquivos**: PascalCase para componentes (`FileItem.tsx`), camelCase para utilitários (`dateParser.ts`)
- **Variáveis**: camelCase (`processedData`, `isLoading`)
- **Constantes**: UPPER_SNAKE_CASE (`VALID_PROJECT_CODES`)
- **Componentes**: PascalCase (`FileItem`, `Icon`)

### Commits

Siga o padrão [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>: <descrição>

[corpo opcional]
```

**Tipos:**

- `feat`: Nova funcionalidade
- `fix`: Correção de bug
- `docs`: Documentação
- `style`: Formatação (não afeta código)
- `refactor`: Refatoração
- `perf`: Melhoria de performance
- `test`: Testes
- `chore`: Tarefas de build/config

**Exemplos:**

```bash
feat: Add support for .csv files
fix: Resolve date parsing for MM/DD/YYYY format
docs: Update README with new screenshots
refactor: Extract Excel processing to worker
```

---

## Processo de Pull Request

### 1. Fork e Clone

```bash
# Fork no GitHub, depois:
git clone https://github.com/SEU-USUARIO/hube-powerbi-manager.git
cd hube-powerbi-manager
npm install
```

### 2. Crie uma Branch

```bash
git checkout -b feature/minha-feature
# ou
git checkout -b fix/meu-bug
```

### 3. Desenvolva

- Faça suas alterações
- Teste localmente: `npm run dev`
- Verifique o build: `npm run build`
- Execute o linter: `npm run lint`

### 4. Commit

```bash
git add .
git commit -m "feat: Adiciona suporte para formato XLS"
```

### 5. Push e PR

```bash
git push origin feature/minha-feature
```

No GitHub:

1. Abra um Pull Request
2. Preencha o template (se houver)
3. Aguarde review

### Checklist de PR

- [ ] Código segue os padrões do projeto
- [ ] Testei localmente (`npm run dev`)
- [ ] Build passa sem erros (`npm run build`)
- [ ] Lint passa sem erros (`npm run lint`)
- [ ] Documentação atualizada (se necessário)
- [ ] Commit messages seguem padrão

---

## Configuração do Ambiente

### Pré-requisitos

- Node.js 18+
- npm 9+
- Git

### Setup Local

```bash
# 1. Clone o repositório
git clone https://github.com/stefanprati-rgb/hube-powerbi-manager.git
cd hube-powerbi-manager

# 2. Instale dependências
npm install

# 3. Configure Firebase (opcional para desenvolvimento)
# Edite src/config/firebase.ts com suas credenciais

# 4. Inicie o dev server
npm run dev

# 5. Abra no navegador
# http://localhost:5173
```

### Comandos Úteis

```bash
npm run dev      # Servidor de desenvolvimento
npm run build    # Build de produção
npm run preview  # Preview do build
npm run lint     # Executar linter
```

---

## Dúvidas?

Se tiver dúvidas sobre como contribuir:

1. Verifique a [documentação](README.md)
2. Procure em [Issues](https://github.com/stefanprati-rgb/hube-powerbi-manager/issues)
3. Abra uma nova issue com a tag `question`

---

**Obrigado por contribuir! 🚀**
