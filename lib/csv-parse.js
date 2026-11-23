/**
 * Minimal CSV parser with quoted-field support.
 * Returns { headers: string[], rows: Record<string, string>[] }
 */
function parseCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  if (!raw.trim()) return { headers: [], rows: [] };

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field.trim());
      field = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field.trim());
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field.trim());
  if (row.some((c) => c !== '')) rows.push(row);

  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => String(h || '').trim());
  const data = rows.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      obj[h] = cols[idx] != null ? String(cols[idx]).trim() : '';
      obj[h.toLowerCase()] = obj[h];
    });
    return obj;
  });

  return { headers, rows: data };
}

function pick(row, ...keys) {
  for (const key of keys) {
    if (!key) continue;
    const direct = row[key];
    if (direct != null && String(direct).trim() !== '') return String(direct).trim();
    const lower = row[String(key).toLowerCase()];
    if (lower != null && String(lower).trim() !== '') return String(lower).trim();
  }
  return '';
}

function escapeCsv(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

module.exports = { parseCsv, pick, escapeCsv };
