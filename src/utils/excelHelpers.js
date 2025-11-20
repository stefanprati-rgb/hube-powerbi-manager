import * as XLSX from 'xlsx';

export const FINAL_HEADERS = [
    "PROJETO", "Instalação", "CNPJ/CPF", "Distribuidora", "Nome", "Mês de Referência",
    "Custo sem GD R$", "Custo com GD R$", "Data de Emissão", "Vencimento", "Valor Final R$",
    "Status", "Valor Pago", "Juros e Multa", "Data de Pagamento", "Desconto contrato (%)",
    "Economia R$", "Dias Atrasados", "Risco", "Região", "Arquivo Origem"
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
    "Data Vencimento": "Vencimento",
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
    const cutoffDate = new Date(2025, 5, 1);

    sheetData.forEach(row => {
        // 1. Molde Vazio
        const newRow = {};
        FINAL_HEADERS.forEach(header => newRow[header] = "");

        // Validação de Data (se aplicável)
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

        // Mapeamento Inteligente
        Object.entries(EGS_MAPPING).forEach(([origem, destino]) => {
            if (row[origem] !== undefined) newRow[destino] = row[origem];
        });

        Object.keys(row).forEach(key => {
            if (FINAL_HEADERS.includes(key) && !newRow[key]) {
                newRow[key] = row[key];
            }
        });

        // 3. Cálculos
        newRow["Desconto contrato (%)"] = 0.25;

        const custoSemGD = parseCurrency(newRow["Custo sem GD R$"]);
        const custoComGD = parseCurrency(newRow["Custo com GD R$"]);
        newRow["Economia R$"] = (custoComGD - custoSemGD).toFixed(2);

        const vencimentoVal = row["Data Vencimento"] || row["Vencimento"];
        const dataVencimento = parseExcelDate(vencimentoVal);

        let diasAtraso = 0;
        if (dataVencimento && !isNaN(dataVencimento.getTime())) {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            dataVencimento.setHours(0, 0, 0, 0);
            const diffTime = hoje - dataVencimento;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            diasAtraso = diffDays > 0 ? diffDays : 0;
        }
        newRow["Dias Atrasados"] = diasAtraso;

        // Risco
        const status = String(newRow["Status"] || "").trim();
        let risco = "";
        if (status === "Em aberto") risco = "";
        else if (status === "Atrasado" || status === "Expirado") {
            if (diasAtraso <= 30) risco = "Baixo";
            else if (diasAtraso <= 90) risco = "Médio";
            else risco = "Alto";
        }
        newRow["Risco"] = risco;

        // Origem detalhada: Arquivo + Aba
        newRow["Arquivo Origem"] = `${fileName} [${sheetName}]`;

        if (newRow["Instalação"] || newRow["CNPJ/CPF"] || newRow["Nome"]) {
            processedRows.push(newRow);
        }
    });

    return processedRows;
};
