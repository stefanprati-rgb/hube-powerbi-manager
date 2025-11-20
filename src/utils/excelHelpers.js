import * as XLSX from 'xlsx';

// Estrutura combinada: PROJETO + Colunas do CSV (Instalação até Risco) + Extras (Região, Arquivo Origem)
export const FINAL_HEADERS = [
    "PROJETO",
    "Instalação", "Nome", "CNPJ/CPF", "Distribuidora", "Cep", "Endereço", "Cidade", "UF",
    "Tipo de Pagamento", "Tipo Contrato", "Desconto contrato (%)", "Condição Comercial",
    "Data de Vencimento", "Mês de Referência", "Base para cálculo", "Tipo Cobrança",
    "Origem do cálculo", "Aprovação", "Data de Emissão", "Vencimento", "Crédito kWh",
    "Tarifa aplicada R$", "Valor Bruto R$", "Desconto extra", "Ajuste retroativo R$",
    "Valor Final R$", "Custo com GD R$", "Custo sem GD R$", "Economia R$",
    "Número da conta", "Nº da cobrança", "Data de Pagamento", "Pagamento via",
    "Dias de Atraso", "Juros e Multa", "Valor da cobrança R$", "Valor Pago",
    "Valor creditado R$", "ID Boleto/Pix", "Instituição bancária", "Conta vinculada",
    "Status", "Cancelada", "Data de Cancelamento", "Motivo do Cancelamento",
    "Cancelamento", "Dias Atrasados", "Risco",
    "Região", "Arquivo Origem"
];

const EGS_MAPPING = {
    "Instalação": "Instalação",
    "CNPJ": "CNPJ/CPF",
    "Distribuidora": "Distribuidora",
    "Razão Social": "Nome",
    "Referência": "Mês de Referência",
    "Valor sem desconto": "Custo sem GD R$",
    "Valor liberado": "Custo com GD R$",
    "Data emissão": "Data de Emissão",
    "Data Vencimento": "Vencimento", // Mapeado para a coluna 'Vencimento' (pode duplicar para 'Data de Vencimento' se necessário)
    "Valor emitido": "Valor Final R$",
    "Status Pagamento": "Status",
    "Valor Pago": "Valor Pago",
    "Multa/Juros": "Juros e Multa",
    "Data Pagamento": "Data de Pagamento"
};

export const parseExcelDate = (dateVal) => {
    try {
        if (!dateVal) return null;
        if (dateVal instanceof Date) return dateVal;
        if (typeof dateVal === 'number') return new Date(Math.round((dateVal - 25569) * 86400 * 1000));
        const strVal = String(dateVal);
        if (strVal.includes('-')) {
            const parts = strVal.split('-');
            if (parts[0].length === 4) return new Date(parts[0], parts[1] - 1, parts[2]);
        }
        return new Date(dateVal);
    } catch (e) { return null; }
};

export const parseCurrency = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    let v = String(val).replace("R$", "").trim();
    if (v.includes(",") && !v.includes(".")) v = v.replace(",", ".");
    return parseFloat(v) || 0;
};

export const processSheetData = (sheetData, fileName, sheetName, manualCode) => {
    const processedRows = [];
    const cutoffDate = new Date(2025, 5, 1); // 01/06/2025 (Mês 5 é Junho no JS 0-indexed)

    sheetData.forEach(row => {
        // 1. Molde Vazio com todos os cabeçalhos finais
        const newRow = {};
        FINAL_HEADERS.forEach(header => newRow[header] = "");

        // Validação de Data (Mês de Referência)
        let rawRefDate = row["Referência"] || row["Mês de Referência"];
        if (rawRefDate) {
            let refDate = parseExcelDate(rawRefDate);
            if (refDate && !isNaN(refDate.getTime())) {
                refDate.setDate(1); refDate.setHours(0, 0, 0, 0);
                if (refDate < cutoffDate) return;
            }
        }

        // Filtro de Status
        const statusFat = String(row["Status Faturamento"] || "").toLowerCase();
        if (statusFat.includes("cancelad")) return;

        // 2. Preenchimento
        let projetoVal = row["Projeto"] || row["PROJETO"];
        if (manualCode) {
            projetoVal = manualCode.toUpperCase();
        }
        newRow["PROJETO"] = projetoVal || "";

        // Mapeamento das colunas conhecidas
        Object.entries(EGS_MAPPING).forEach(([origem, destino]) => {
            if (row[origem] !== undefined) newRow[destino] = row[origem];
        });

        // Tenta preencher colunas que tenham o mesmo nome na origem e no destino
        Object.keys(row).forEach(key => {
            if (FINAL_HEADERS.includes(key) && !newRow[key]) {
                newRow[key] = row[key];
            }
        });

        // 3. Cálculos Específicos
        newRow["Desconto contrato (%)"] = 0.25;

        const custoSemGD = parseCurrency(newRow["Custo sem GD R$"]);
        const custoComGD = parseCurrency(newRow["Custo com GD R$"]);
        newRow["Economia R$"] = (custoComGD - custoSemGD).toFixed(2);

        const vencimentoVal = row["Data Vencimento"] || row["Vencimento"];
        const dataVencimento = parseExcelDate(vencimentoVal);

        let diasAtrasoCalc = 0;
        if (dataVencimento && !isNaN(dataVencimento.getTime())) {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            dataVencimento.setHours(0, 0, 0, 0);
            const diffTime = hoje - dataVencimento;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            diasAtrasoCalc = diffDays > 0 ? diffDays : 0;
        }
        // Preenche a coluna calculada 'Dias Atrasados'
        newRow["Dias Atrasados"] = diasAtrasoCalc;

        // Se desejar preencher também a coluna 'Dias de Atraso' com o mesmo valor:
        // newRow["Dias de Atraso"] = diasAtrasoCalc; 

        // Risco
        const status = String(newRow["Status"] || "").trim();
        let risco = "";
        if (status === "Em aberto") risco = "";
        else if (status === "Atrasado" || status === "Expirado") {
            if (diasAtrasoCalc <= 30) risco = "Baixo";
            else if (diasAtrasoCalc <= 90) risco = "Médio";
            else risco = "Alto";
        }
        newRow["Risco"] = risco;

        // Origem detalhada
        newRow["Arquivo Origem"] = `${fileName} [${sheetName}]`;

        // Critério para incluir a linha: ter pelo menos Instalação, CNPJ ou Nome
        if (newRow["Instalação"] || newRow["CNPJ/CPF"] || newRow["Nome"]) {
            processedRows.push(newRow);
        }
    });

    return processedRows;
};
