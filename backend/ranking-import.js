const XLSX = require('xlsx');

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toNumber(value) {
  if (value === '' || value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value).trim().replace(/\s+/g, '');
  if (!text) return null;
  text = text.replace(/[^\d,.-]/g, '');
  if (!text) return null;
  if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
  else if (text.includes(',')) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function findFirstRow(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows.find(row => Object.values(row).some(value => String(value).trim() !== '')) || null;
}

function pickHeader(headers, aliases) {
  return headers.find(header => aliases.includes(header)) || null;
}

function cell(row, ...names) {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim() !== '') return row[name];
  }
  return '';
}

function parseSheetRows(sheet, sheetName) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]).map(normalizeText);
  const map = {
    type: pickHeader(headers, ['type', 'tipo', 'registro', 'nivel', 'categoria']),
    id: pickHeader(headers, ['id', 'codigo']),
    name: pickHeader(headers, ['name', 'nome', 'vendedor', 'equipe', 'team', 'seller', 'colaborador']),
    route: pickHeader(headers, ['route', 'rota', 'regiao', 'cidade', 'area']),
    role: pickHeader(headers, ['role', 'cargo', 'funcao', 'perfil']),
    leader: pickHeader(headers, ['leader', 'lider', 'supervisor']),
    salesAmount: pickHeader(headers, ['sales_amount', 'faturamento', 'valor', 'realizado', 'vendas', 'venda_reais', 'total_reais']),
    targetAmount: pickHeader(headers, ['target_amount', 'meta', 'meta_reais', 'objetivo', 'target']),
    challengeTargetAmount: pickHeader(headers, ['challenge_target_amount', 'meta_desafio_reais', 'desafio_reais']),
    tons: pickHeader(headers, ['tons', 'ton', 'toneladas', 'realizado_ton', 'quantidade_ton']),
    targetTons: pickHeader(headers, ['target_tons', 'meta_ton', 'meta_toneladas']),
    challengeTargetTons: pickHeader(headers, ['challenge_target_tons', 'meta_desafio_ton', 'desafio_ton']),
    period: pickHeader(headers, ['period', 'periodo']),
    updatedAt: pickHeader(headers, ['updated_at', 'atualizado_em', 'data_atualizacao'])
  };

  return rows.map((row, index) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) normalized[normalizeText(key)] = value;
    return {
      rowIndex: index + 2,
      type: String(cell(normalized, map.type)).toLowerCase(),
      id: String(cell(normalized, map.id) || `${sheetName}-${index + 1}`),
      name: String(cell(normalized, map.name)),
      route: String(cell(normalized, map.route)),
      role: String(cell(normalized, map.role)),
      leader: String(cell(normalized, map.leader) || ''),
      salesAmount: toNumber(cell(normalized, map.salesAmount)),
      targetAmount: toNumber(cell(normalized, map.targetAmount)),
      challengeTargetAmount: toNumber(cell(normalized, map.challengeTargetAmount)),
      tons: toNumber(cell(normalized, map.tons)),
      targetTons: toNumber(cell(normalized, map.targetTons)),
      challengeTargetTons: toNumber(cell(normalized, map.challengeTargetTons)),
      period: String(cell(normalized, map.period) || '').trim(),
      updatedAt: String(cell(normalized, map.updatedAt) || '').trim()
    };
  }).filter(row => row.name || row.route || row.role || row.salesAmount != null || row.targetAmount != null);
}

function rankingFromXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets = workbook.SheetNames.map(name => ({ name, sheet: workbook.Sheets[name] })).filter(item => item.sheet && findFirstRow(item.sheet));
  if (!sheets.length) throw new Error('Planilha vazia');

  const allRows = sheets.flatMap(({ name, sheet }) => parseSheetRows(sheet, name));
  if (!allRows.length) throw new Error('Não foi possível ler dados da planilha');

  const teams = [];
  const sellers = [];
  const management = {};
  let period = '';
  let updatedAt = '';

  for (const row of allRows) {
    if (row.period && !period) period = row.period;
    if (row.updatedAt && !updatedAt) updatedAt = row.updatedAt;

    const type = row.type || '';
    const name = row.name.trim();
    if (!name) continue;

    const entry = {
      id: row.id,
      name,
      route: row.route || '',
      role: row.role || '',
      leader: row.leader || null,
      salesAmount: row.salesAmount,
      targetAmount: row.targetAmount,
      challengeTargetAmount: row.challengeTargetAmount,
      tons: row.tons,
      targetTons: row.targetTons,
      challengeTargetTons: row.challengeTargetTons
    };

    if (type.includes('team') || type.includes('equipe') || type.includes('rota')) teams.push(entry);
    else if (type.includes('seller') || type.includes('vendedor') || type.includes('vendedora') || type.includes('consultor')) sellers.push(entry);
    else if (type.includes('manager') || type.includes('gerente') || type.includes('supervisor') || type.includes('diretor') || type.includes('lider')) management[name.toLowerCase()] = name;
    else sellers.push(entry);
  }

  for (const team of teams) {
    for (const seller of sellers.filter(item => item.route && item.route === team.name)) {
      if (/externo/i.test(seller.role)) team.external = seller.name;
      else if (/especialista/i.test(seller.role)) team.specialist = seller.name;
      else if (/corporativo/i.test(seller.role)) team.corporate = seller.name;
      else if (/constru/i.test(seller.role)) team.construction = seller.name;
    }
  }

  return {
    updatedAt: updatedAt || new Date().toISOString(),
    period: period || 'Current period',
    management: {
      generalManager: management['diretor geral'] || management['gerente geral'] || management['general manager'] || 'Marcelo',
      salesManager: management['gerente de vendas'] || management['sales manager'] || 'Anderson',
      salesSupervisor: management['supervisor de vendas'] || management['sales supervisor'] || 'Rafael Pereira'
    },
    teams,
    sellers,
    source: 'spreadsheet'
  };
}

module.exports = { rankingFromXlsx };
