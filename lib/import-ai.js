/**
 * Extract supplier/client records from PDF text via OpenAI-compatible chat API.
 * Requires OPENAI_API_KEY (optional OPENAI_BASE_URL, OPENAI_MODEL).
 */

async function extractPdfText(buffer) {
  // pdf-parse is CommonJS; load lazily so missing install fails clearly at runtime.
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch {
    throw new Error('PDF parsing is not installed. Run: npm install pdf-parse');
  }
  const data = await pdfParse(buffer);
  return String(data.text || '').trim();
}

function buildPrompt(type, text) {
  const kind = type === 'suppliers' ? 'supplier / manufacturer / exporter companies' : 'client / buyer / customer companies';
  return `You extract ${kind} from business document text.
Return ONLY valid JSON (no markdown) with this shape:
{"records":[{"companyName":"","country":"","city":"","province":"","address":"","postCode":"","tel":"","mobile":"","email":"","web":"","notes":"","contacts":[{"name":"","department":"","email":"","tel":"","mobile":"","whatsapp":"","wechat":""}]}]}

Rules:
- Include every distinct company you can identify.
- Prefer real company names over person names for companyName.
- Put people into contacts[].
- Leave unknown fields as "".
- If nothing found, return {"records":[]}.

Document text:
"""
${text.slice(0, 24000)}
"""`;
}

async function extractEntitiesWithAi(type, text) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'AI import is not configured. Set OPENAI_API_KEY (or AI_API_KEY) in the server environment.',
    );
  }
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a careful CRM data extraction assistant. Output JSON only.',
        },
        { role: 'user', content: buildPrompt(type, text) },
      ],
    }),
  });

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`AI provider returned invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `AI request failed (${res.status})`;
    throw new Error(msg);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI returned an empty response');

  let parsed;
  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : content;
  } catch {
    throw new Error('AI response was not valid JSON');
  }

  const records = Array.isArray(parsed?.records) ? parsed.records : [];
  return records
    .map((r) => ({
      companyName: String(r.companyName || r.company || '').trim(),
      country: String(r.country || '').trim(),
      city: String(r.city || '').trim(),
      province: String(r.province || '').trim(),
      address: String(r.address || '').trim(),
      postCode: String(r.postCode || r.postalCode || '').trim(),
      tel: String(r.tel || r.phone || '').trim(),
      mobile: String(r.mobile || '').trim(),
      email: String(r.email || '').trim(),
      web: String(r.web || r.website || '').trim(),
      notes: String(r.notes || '').trim(),
      contacts: Array.isArray(r.contacts)
        ? r.contacts
            .map((c) => ({
              name: String(c.name || '').trim(),
              department: String(c.department || '').trim(),
              email: String(c.email || '').trim(),
              tel: String(c.tel || '').trim(),
              mobile: String(c.mobile || '').trim(),
              whatsapp: String(c.whatsapp || '').trim(),
              wechat: String(c.wechat || '').trim(),
            }))
            .filter((c) => c.name || c.email)
        : [],
    }))
    .filter((r) => r.companyName);
}

module.exports = { extractPdfText, extractEntitiesWithAi };
