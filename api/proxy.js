// api/proxy.js — Vercel Serverless Function

const CONFERI_USUARIO  = '7261';
const CONFERI_SENHA    = '13459377';

const NULLORISCO_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJ1bmlxdWVfbmFtZSI6IlZpc3RvcmlhZG9yT25saW5lIiwicm9sZSI6IkFSLUNPTlNVTFRBTEVJTEFPIiwibmFtZWlkIjoiRTIwNTE2NTgtRTUyMi00RUVCLUFENjMtOTM2QTQ2QUNGNDhCIiwibmJmIjoxNzMxOTU1MTg1LCJleHAiOjIwNDc0ODc5ODUsImlhdCI6MTczMTk1NTE4NX0.' +
  'uEDK5vY5xi2uV0LKgjZISpL7No_gMejGky9SODLG_5U';

const EFIPAY_CLIENT_ID     = '';
const EFIPAY_CLIENT_SECRET = '';
const EFIPAY_CHAVE_PIX     = '';
const PRECO_LAUDO          = '29.90';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tryJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function xmlToObj(str) {
  str = str.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[^>]*\?>/g, '').trim();

  function parseAttrs(attrStr) {
    const attrs = {};
    const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(attrStr)) !== null) attrs[m[1]] = m[2];
    return attrs;
  }

  function parseValue(s) {
    s = s.trim();
    const obj = {};

    const selfRe = /<([a-zA-Z_][\w:.-]*)(\s[^>]*)?\s*\/>/g;
    let match;
    while ((match = selfRe.exec(s)) !== null) {
      const [, tag, attrStr] = match;
      const attrs = attrStr ? parseAttrs(attrStr) : {};
      if (obj[tag] === undefined)
        obj[tag] = Object.keys(attrs).length ? { _attributes: attrs } : '';
    }

    const tagRe = /<([a-zA-Z_][\w:.-]*)(\s[^>]*)?>([^]*?)<\/\1>/g;
    while ((match = tagRe.exec(s)) !== null) {
      const [, tag, attrStr, inner] = match;
      const sub = parseValue(inner.trim());
      let val = (typeof sub === 'object' && Object.keys(sub).length) ? sub : inner.trim();
      if (attrStr) {
        const attrs = parseAttrs(attrStr);
        if (Object.keys(attrs).length)
          val = typeof val === 'string'
            ? (val ? { _text: val, _attributes: attrs } : { _attributes: attrs })
            : { ...val, _attributes: attrs };
      }
      if (obj[tag] !== undefined) {
        if (!Array.isArray(obj[tag])) obj[tag] = [obj[tag]];
        obj[tag].push(val);
      } else {
        obj[tag] = val;
      }
    }
    return Object.keys(obj).length ? obj : s;
  }

  return parseValue(str);
}

async function apiCall(url, method = 'POST', body = null, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    signal: AbortSignal.timeout(30000),
  };
  if (body !== null) opts.body = body;
  const res  = await fetch(url, opts);
  const text = await res.text();
  return { status: res.status, text };
}

function extractError(text, status) {
  const d = tryJson(text);
  if (typeof d === 'object' && d !== null) {
    const msg =
      d.message ?? d.error ?? d.mensagem ?? d.erro ??
      (Array.isArray(d.chassi) ? `chassi: ${d.chassi[0]}` : null) ??
      (Array.isArray(d.placa)  ? `placa: ${d.placa[0]}`   : null) ??
      Object.values(d).find(v => typeof v === 'string');
    if (msg) return String(msg);
  }
  return `HTTP ${status}`;
}

function makeResult(status, text) {
  const ok = status >= 200 && status < 300;
  const d  = tryJson(text);
  return { ok, data: d, ...(!ok && { error: extractError(text, status) }) };
}

// ─── Roteador ─────────────────────────────────────────────────────────────────
async function handleAction(action, placa, extra = {}) {
  let r, parsed;

  switch (action) {

    case 'preliminares': {
      const body = JSON.stringify({
        usuario: CONFERI_USUARIO, senha: CONFERI_SENHA,
        parametro: placa, tipo_parametro: 'placa', pesquisa: '6',
      });
      r = await apiCall(
        'https://webservice.companyconferi.com.br/sistema/producao/agregados/conferiAgregados.php',
        'POST', body, { Accept: 'application/xml' }
      );
      if (r.status >= 200 && r.status < 300) {
        parsed = xmlToObj(r.text);
        const urlV = `https://webservice.companyconferi.com.br/sistema/producao/pericia/conferiVeiculo.php`
          + `?usuario=${CONFERI_USUARIO}&senha=${CONFERI_SENHA}&pesquisa=6&tipo_parametro=placa&parametro=${encodeURIComponent(placa)}`;
        const rv = await apiCall(urlV, 'GET', null, {});
        const parsedV = xmlToObj(rv.text);
        const solV = (parsedV?.conferi ?? parsedV)?.solicitacao;
        const codigoConsulta = solV?._attributes?.codigoConsulta ?? solV?.codigoConsulta ?? null;
        if (codigoConsulta) {
          if (parsed?.conferi) parsed.conferi._codigoConsulta = String(codigoConsulta);
          else                 parsed._codigoConsulta = String(codigoConsulta);
        }
        return { ok: !!parsed, data: parsed };
      }
      return { ok: false, error: extractError(r.text, r.status) };
    }

    case 'conferi_leilao': {
      const body = JSON.stringify({ placa, usuario: CONFERI_USUARIO, senha: CONFERI_SENHA });
      r = await apiCall('https://webservice.companyconferi.com.br/api-clientes/conferi-leilao-completo/json', 'POST', body);
      return makeResult(r.status, r.text);
    }

    case 'gerar_pdf': {
      const codRaw = extra._codigoConsulta || extra.cod_consulta || extra.codigo_consulta || '';
      if (!codRaw) return { ok: false, error: 'PDF indisponível: consulta sem código ativo.' };
      const codConsulta = codRaw.startsWith('http') ? codRaw.split('/').pop() : codRaw;
      const body = JSON.stringify({ placa, usuario: CONFERI_USUARIO, senha: CONFERI_SENHA, codigo_consulta: codConsulta });
      r = await apiCall('https://webservice.companyconferi.com.br/gerar-pdf/', 'POST', body);
      const d = tryJson(r.text);
      const linkPdf = d?.conferi?.pdf?.link_pdf ?? d?.link_pdf ?? d?.url ?? d?.link ?? d?.pdf ?? null;
      const linkFinal = linkPdf ?? (r.text.trim().startsWith('http') ? r.text.trim() : null);
      return {
        ok: r.status < 400 && !!linkFinal,
        data: d ?? r.text,
        link_pdf: linkFinal,
        error: !linkFinal ? (extractError(r.text, r.status) || 'Link do PDF não retornado') : undefined,
      };
    }

    case 'leilao': {
      const chassi = extra.chassi ?? '';
      const body = JSON.stringify({ placa, ...(chassi && { chassi }) });
      r = await apiCall(
        'http://api.leilao.nullorisco.com.br/api/consulta/placachassi',
        'POST', body, { Authorization: `Bearer ${NULLORISCO_JWT}` }
      );
      if (!r.text.trim()) return { ok: true, data: [], semOcorrencias: true };
      if (r.status >= 400) return { ok: true, data: [], semOcorrencias: true };
      return makeResult(r.status, r.text);
    }

    case 'fotos': {
      const chassi = extra.chassi ?? '';
      const body = JSON.stringify({ placa, ...(chassi && { chassi }) });
      r = await apiCall(
        'http://api.adm.nullorisco.com.br/v1/imagem/consulta',
        'POST', body, { Authorization: `Bearer ${NULLORISCO_JWT}` }
      );
      if (!r.text.trim()) return { ok: true, data: [], semOcorrencias: true };
      if (r.status >= 400) return { ok: true, data: [], semOcorrencias: true };
      return makeResult(r.status, r.text);
    }

    case 'sinistro': {
      const chassi = extra.chassi ?? '';
      const body = JSON.stringify({ placa, ...(chassi && { chassi }) });
      r = await apiCall(
        'http://api.adm.nullorisco.com.br/v1/sinistro/consulta3',
        'POST', body, { Authorization: `Bearer ${NULLORISCO_JWT}` }
      );
      if (!r.text.trim()) return { ok: true, data: [], semOcorrencias: true };
      if (r.status >= 400) return { ok: true, data: [], semOcorrencias: true };
      return makeResult(r.status, r.text);
    }

    case 'gravame': {
      const body = JSON.stringify({ placa });
      r = await apiCall(
        'https://api.despachabrasil.com.br/v1/consultagravame/consulta',
        'POST', body, { Authorization: `Bearer ${NULLORISCO_JWT}` }
      );
      if (!r.text.trim()) return { ok: true, data: null, semGravame: true };
      if (r.status >= 400) return { ok: true, data: null, semGravame: true };
      return makeResult(r.status, r.text);
    }

    case 'criar_pix': {
      if (!EFIPAY_CLIENT_ID) return { ok: false, error: 'EfíPay não configurado.' };
      const cred = Buffer.from(`${EFIPAY_CLIENT_ID}:${EFIPAY_CLIENT_SECRET}`).toString('base64');
      const tok  = await apiCall('https://pix.api.efipay.com.br/oauth/token', 'POST', 'grant_type=client_credentials',
        { Authorization: `Basic ${cred}`, 'Content-Type': 'application/x-www-form-urlencoded' });
      const td = tryJson(tok.text);
      if (!td?.access_token) return { ok: false, error: 'Falha no token EfíPay' };
      const cob = await apiCall('https://pix.api.efipay.com.br/v2/cob', 'POST',
        JSON.stringify({ calendario: { expiracao: 3600 }, devedor: { cpf: (extra.cpf ?? '00000000000').replace(/\D/g,''), nome: extra.nome ?? 'Cliente' }, valor: { original: PRECO_LAUDO }, chave: EFIPAY_CHAVE_PIX, infoAdicionais: [{ nome: 'Placa', valor: placa }] }),
        { Authorization: `Bearer ${td.access_token}` });
      const cd = tryJson(cob.text);
      if (cd?.loc?.id) {
        const qr = await apiCall(`https://pix.api.efipay.com.br/v2/loc/${cd.loc.id}/qrcode`, 'GET', null, { Authorization: `Bearer ${td.access_token}` });
        cd.qrcode = tryJson(qr.text);
      }
      return { ok: !!cd?.txid, data: cd };
    }

    case 'verificar_pix': {
      if (!EFIPAY_CLIENT_ID || !extra.txid) return { ok: false, pago: false };
      const cred = Buffer.from(`${EFIPAY_CLIENT_ID}:${EFIPAY_CLIENT_SECRET}`).toString('base64');
      const tok  = await apiCall('https://pix.api.efipay.com.br/oauth/token', 'POST', 'grant_type=client_credentials',
        { Authorization: `Basic ${cred}`, 'Content-Type': 'application/x-www-form-urlencoded' });
      const td = tryJson(tok.text);
      if (!td?.access_token) return { ok: false, pago: false };
      const cv = await apiCall(`https://pix.api.efipay.com.br/v2/cob/${extra.txid}`, 'GET', null, { Authorization: `Bearer ${td.access_token}` });
      const cd = tryJson(cv.text);
      return { ok: true, pago: cd?.status === 'CONCLUIDA', data: cd };
    }

    default:
      return { ok: false, error: `Ação desconhecida: ${action}` };
  }
}

// ─── Handler Vercel ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }

  try {
    const input  = req.body ?? {};
    const placa  = (input.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const result = await handleAction(input.action, placa, input);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
