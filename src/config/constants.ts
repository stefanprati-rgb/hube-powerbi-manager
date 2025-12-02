// src/config/constants.ts

export const FINAL_HEADERS: readonly string[] = [
    "PROJETO",
    "Instalação", "Nome", "CNPJ/CPF", "Distribuidora",
    "Cep", "Endereço", "Cidade", "UF",
    "Tipo de Pagamento", "Tipo Contrato", "Desconto contrato (%)", "Condição Comercial",
    "Data de Vencimento", "Mês de Referência", "Base para cálculo", "Tipo Cobrança",
    "Origem do cálculo", "Aprovação", "Data de Emissão", "Vencimento", "Crédito kWh",
    "Tarifa aplicada R$", "Valor Bruto R$", "Desconto extra", "Ajuste retroativo R$",
    "Valor Final R$", "Custo com GD R$", "Custo sem GD R$", "Economia R$",
    "Número da conta", "Nº da cobrança", "Data de Pagamento", "Pagamento via",
    "Dias de Atraso", "Juros e Multa", "Valor da cobrança R$", "Valor Pago",
    "Valor creditado R$", "ID Boleto/Pix", "Instituição bancária", "Conta vinculada",
    "Status", "Cancelada", "Data de Cancelamento", "Motivo do Cancelamento",
    "Cancelamento", "Dias Atrasados", "Risco"
] as const;

export const EGS_MAPPING: Record<string, string> = {
    "Região": "Região",
    "Instalação": "Instalação",
    "CNPJ": "CNPJ/CPF",
    "Distribuidora": "Distribuidora",
    "Razão Social": "Nome",
    "Referência": "Mês de Referência",

    // Mapeamentos Financeiros (Base EGS)
    "CUSTO_S_GD": "Custo sem GD R$",
    "CUSTO_S_GD ": "Custo sem GD R$",
    "CUSTO_C_GD": "Custo com GD R$",
    "CUSTO_C_GD ": "Custo com GD R$",

    "Data emissão": "Data de Emissão",
    "Data Vencimento": "Vencimento",
    "Valor emitido": "Valor Final R$",
    "Status Pagamento": "Status",

    "Valor Pago": "Valor Pago",
    "Multa/Juros": "Juros e Multa",
    "Data Pagamento": "Data de Pagamento",

    "Créd. Consumido": "Crédito kWh",
    "Credito kWh": "Crédito kWh",
    "Telefone": "Telefone",
    "E-MAIL DO PAGADOR": "E-mail",
    "COD": "ID Boleto/Pix",
    "COD BOLETO": "ID Boleto/Pix"
};

export const VALID_PROJECT_CODES = ['LNV', 'ALA', 'EGS', 'MTX', 'EMG', 'ESP'];

export const PROJECT_MAPPING: Record<string, string> = {
    // Lua Nova
    'LN': 'LNV', 'LNV': 'LNV', 'LUA NOVA': 'LNV', 'LUA NOVA ENERGIA': 'LNV',
    // Alagoas
    'ALA': 'ALA', 'ALAGOAS': 'ALA', 'ALAGOAS ENERGIA': 'ALA',
    // E3 / EGS
    'EGS': 'EGS', 'E3': 'EGS', 'E3 ENERGIA': 'EGS',
    // Matrix
    'MX': 'MTX', 'MTX': 'MTX', 'MATRIX': 'MTX',
    // Era Verde (Mapeamentos diretos)
    'EMG': 'EMG', 'ERA VERDE ENERGIA - MG': 'EMG',
    'ESP': 'ESP', 'ERA VERDE ENERGIA - SP': 'ESP',
    // Era Verde (Genéricos para resolução via Distribuidora/UF)
    'EVD': 'EVD', 'ERA VERDE': 'EVD'
};