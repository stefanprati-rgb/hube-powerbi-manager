sheetData.forEach(row => {
    let rawProj = "";
    if (hasProjectCol) rawProj = row["Projeto"] || row["PROJETO"];
    if (!rawProj) rawProj = manualCode;

    const finalProj = normalizeProject(rawProj, row);
    if (!finalProj) return;
    if (targetProject && finalProj !== targetProject) return;

    // Normalização Robusta das Colunas
    const normalizedRow: any = { ...row };
    Object.entries(EGS_MAPPING).forEach(([orig, dest]) => {
        const val = findValueInRow(row, orig);
        if (val !== undefined) normalizedRow[dest] = val;
    });

    // Status - Normalização com primeira letra maiúscula
    let status = String(normalizedRow["Status"] || "").trim();
    const statusLower = status.toLowerCase();

    if (finalProj === 'EGS') {
        if (statusLower.includes('quitado parc')) status = 'Negociado';
        else if (statusLower.includes('pago') || statusLower.includes('quitado')) status = 'Pago';
        else if (statusLower.includes('atrasado') || statusLower.includes('atraso')) status = 'Atrasado';
        else if (statusLower.includes('acordo') || statusLower.includes('negociado')) status = 'Negociado';
        else return;
    } else {
        if (statusLower.includes("cancelad")) return;
    }

    // Garante capitalização padrão
    status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

    const refDate = parseExcelDate(normalizedRow["Mês de Referência"] || normalizedRow["Referência"]);
    const skipCheck = shouldSkipRow(refDate, cutoffDate, status);
    if (skipCheck.shouldSkip) return;

    const newRow: Record<string, any> = {};
    newRow["PROJETO"] = finalProj;

    FINAL_HEADERS.forEach(key => {
        if (key !== "PROJETO") newRow[key] = normalizedRow[key] !== undefined ? normalizedRow[key] : "";
    });

    newRow["Status"] = status;

    // Filtro 3: Ignora faturas não emitidas
    const dataEmissaoRaw = normalizedRow["Data de Emissão"];
    if (!dataEmissaoRaw || dataEmissaoRaw === "" || dataEmissaoRaw === "-") {
        return;
    }

    if (newRow["Instalação"]) newRow["Instalação"] = normalizeInstallation(newRow["Instalação"]);
    if (newRow["Distribuidora"]) newRow["Distribuidora"] = normalizeDistributor(newRow["Distribuidora"]);
    if (refDate) newRow["Mês de Referência"] = formatDateToBR(refDate);

    const dataEmissao = parseExcelDate(newRow["Data de Emissão"]);
    if (dataEmissao) newRow["Data de Emissão"] = formatDateToBR(dataEmissao);
    const dataVencimento = parseExcelDate(newRow["Vencimento"]);
    if (dataVencimento) newRow["Vencimento"] = formatDateToBR(dataVencimento);

    if (!newRow["Instalação"] && !newRow["CNPJ/CPF"]) return;

    if (finalProj === 'EGS') newRow["Desconto contrato (%)"] = 0.25;
    else if (!newRow["Desconto contrato (%)"]) newRow["Desconto contrato (%)"] = 0;

    // Cálculos
    const cSem = parseCurrency(newRow["Custo sem GD R$"]);
    const cCom = parseCurrency(newRow["Custo com GD R$"]);

    newRow["Custo sem GD R$"] = cSem;
    newRow["Custo com GD R$"] = cCom;

    if (newRow["Valor Final R$"]) newRow["Valor Final R$"] = parseCurrency(newRow["Valor Final R$"]);

    let ecoVal = newRow["Economia R$"];
    if (ecoVal && String(ecoVal).trim() !== "") {
        newRow["Economia R$"] = String(ecoVal).replace("R$", "").trim();
    } else {
        newRow["Economia R$"] = calculateEconomySafe(cCom, cSem);
    }

    // Calcula dias atrasados apenas se não estiver pago
    let dias = 0;
    const statusPago = ['pago', 'quitado'].some(p => status.toLowerCase().includes(p));

    if (!statusPago) {
        dias = newRow["Dias Atrasados"] ? Number(newRow["Dias Atrasados"]) : calculateDaysLate(dataVencimento);
        if (isNaN(dias)) dias = calculateDaysLate(dataVencimento);
    }

    newRow["Dias Atrasados"] = dias;

    if (!newRow["Risco"]) newRow["Risco"] = determineRisk(status, dias);

    newRow["Arquivo Origem"] = `${fileName} [${sheetName}]`;
    processedRows.push(newRow);
});