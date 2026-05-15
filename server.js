/**
 * server.js — Servidor local para VistoriadorOnline Replica
 * Node.js 18+ (sem dependências externas)
 *
 * Uso: node server.js
 * Depois abra: http://localhost:3000
 */
import http from 'http';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir  = path.dirname(fileURLToPath(import.meta.url));
const PORT   = 3000;

// ─── Credenciais ─────────────────────────────────────────────────────────────
const CONFERI_USUARIO  = '7261';
const CONFERI_SENHA    = '13459377';

const NULLORISCO_JWT   =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJ1bmlxdWVfbmFtZSI6IlZpc3RvcmlhZG9yT25saW5lIiwicm9sZSI6IkFSLUNPTlNVTFRBTEVJTEFPIiwibmFtZWlkIjoiRTIwNTE2NTgtRTUyMi00RUVCLUFENjMtOTM2QTQ2QUNGNDhCIiwibmJmIjoxNzMxOTU1MTg1LCJleHAiOjIwNDc0ODc5ODUsImlhdCI6MTczMTk1NTE4NX0.' +
  'uEDK5vY5xi2uV0LKgjZISpL7No_gMejGky9SODLG_5U';

// EfíPay — preencha se quiser usar PIX real
const EFIPAY_CLIENT_ID     = '';
const EFIPAY_CLIENT_SECRET = '';
const EFIPAY_CHAVE_PIX     = '';
const PRECO_LAUDO          = '29.90';

// ─── Parser XML simples (sem dependências) ────────────────────────────────────
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

    // Self-closing tags: <tag attr="v"/> — captura campos vazios e atributos
    const selfRe = /<([a-zA-Z_][\w:.-]*)(\s[^>]*)?\s*\/>/g;
    let match;
    while ((match = selfRe.exec(s)) !== null) {
      const [, tag, attrStr] = match;
      const attrs = attrStr ? parseAttrs(attrStr) : {};
      if (obj[tag] === undefined)
        obj[tag] = Object.keys(attrs).length ? { _attributes: attrs } : '';
    }

    // Tags normais: <tag attr="v">content</tag>
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

// ─── Chamadas às APIs externas ───────────────────────────────────────────────
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

// Extrai mensagem de erro legível de uma resposta JSON qualquer
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

// Monta resultado padronizado: sempre tem ok, data, e error quando !ok
function makeResult(status, text, extra = {}) {
  const ok = status >= 200 && status < 300;
  const d  = tryJson(text);
  return {
    ok,
    data: d,
    ...(extra),
    ...(!ok && { error: extractError(text, status) }),
  };
}

// ─── Roteador de ações ───────────────────────────────────────────────────────
async function handleAction(action, placa, extra = {}) {
  const auth  = `Authorization: Bearer ${NULLORISCO_JWT}`;
  let   r, text, parsed;

  switch (action) {

    // 1. Dados básicos
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
        // Busca codigoConsulta em conferiVeiculo.php (retorna como atributo XML)
        const urlV = `https://webservice.companyconferi.com.br/sistema/producao/pericia/conferiVeiculo.php`
          + `?usuario=${CONFERI_USUARIO}&senha=${CONFERI_SENHA}&pesquisa=6&tipo_parametro=placa&parametro=${encodeURIComponent(placa)}`;
        const rv = await apiCall(urlV, 'GET', null, {});
        console.log('[DEBUG conferiVeiculo raw]:', rv.text.slice(0, 500));
        const parsedV = xmlToObj(rv.text);
        const solV = (parsedV?.conferi ?? parsedV)?.solicitacao;
        const codigoConsulta =
          solV?._attributes?.codigoConsulta ?? solV?.codigoConsulta ?? null;
        console.log('[DEBUG codigoConsulta]:', codigoConsulta ?? '(nenhum)');
        if (codigoConsulta) {
          if (parsed?.conferi) parsed.conferi._codigoConsulta = String(codigoConsulta);
          else                 parsed._codigoConsulta = String(codigoConsulta);
        }
        return { ok: !!parsed, data: parsed };
      }
      return { ok: false, error: extractError(r.text, r.status) };
    }

    // 2. Conferi — código
    case 'conferi_codigo': {
      const url = `https://webservice.companyconferi.com.br/sistema/producao/pericia/conferiVeiculo.php`
                + `?usuario=${CONFERI_USUARIO}&senha=${CONFERI_SENHA}&pesquisa=6&tipo_parametro=placa&parametro=${encodeURIComponent(placa)}`;
      r = await apiCall(url, 'GET', null, {});
      parsed = xmlToObj(r.text);
      return r.status < 400 ? { ok: true, data: parsed }
                            : { ok: false, error: extractError(r.text, r.status) };
    }

    // 3. Conferi — emissão
    case 'conferi_emissao': {
      const url = `https://webservice.companyconferi.com.br/sistema/producao/pericia/conferiVeiculoAtualizaXML.php`
                + `?usuario=${CONFERI_USUARIO}&senha=${CONFERI_SENHA}&pesquisa=6&tipo_parametro=placa`
                + `&parametro=${encodeURIComponent(placa)}&codigo_consulta=${encodeURIComponent(extra.cod_consulta ?? '')}`;
      r = await apiCall(url, 'GET', null, {});
      parsed = xmlToObj(r.text);
      return r.status < 400 ? { ok: true, data: parsed }
                            : { ok: false, error: extractError(r.text, r.status) };
    }

    // 4. Conferi — leilão completo
    case 'conferi_leilao': {
      const body = JSON.stringify({ placa, usuario: CONFERI_USUARIO, senha: CONFERI_SENHA });
      r = await apiCall(
        'https://webservice.companyconferi.com.br/api-clientes/conferi-leilao-completo/json',
        'POST', body
      );
      return makeResult(r.status, r.text);
    }

    // 5. Conferi — gravame
    case 'conferi_gravame': {
      const body = JSON.stringify({ placa, usuario: CONFERI_USUARIO, senha: CONFERI_SENHA });
      r = await apiCall(
        'https://webservice.companyconferi.com.br/api-clientes/conferi-gravame/json',
        'POST', body
      );
      return makeResult(r.status, r.text);
    }

    // 6. Conferi — gerar PDF
    case 'gerar_pdf': {
      const codRaw = extra._codigoConsulta || extra.cod_consulta || extra.codigo_consulta || '';
      if (!codRaw) return { ok: false, error: 'PDF indisponível: consulta não possui código ativo. Tente outra placa.' };
      const codConsulta = codRaw.startsWith('http') ? codRaw.split('/').pop() : codRaw;
      const body = JSON.stringify({
        placa,
        usuario:          CONFERI_USUARIO,
        senha:            CONFERI_SENHA,
        codigo_consulta:  codConsulta,
      });
      r = await apiCall('https://webservice.companyconferi.com.br/gerar-pdf/', 'POST', body);
      console.log('[DEBUG gerar_pdf] status:', r.status, '| body:', r.text.slice(0, 500));
      const d = tryJson(r.text);
      // 201 = PDF aceito/enfileirado — tenta extrair link de qualquer campo
      const linkPdf = d?.conferi?.pdf?.link_pdf ?? d?.link_pdf ?? d?.url ?? d?.link ?? d?.pdf ?? null;
      // Se vier URL direto como texto puro
      const linkFinal = linkPdf ?? (r.text.trim().startsWith('http') ? r.text.trim() : null);
      return {
        ok: r.status < 400 && !!linkFinal,
        data: d ?? r.text,
        link_pdf: linkFinal,
        error: !linkFinal ? (extractError(r.text, r.status) || 'Link do PDF não retornado') : undefined,
      };
    }

    // 7. NulloRisco — Leilão (placa + chassi)
    case 'leilao': {
      const chassi = extra.chassi ?? '';
      const body = JSON.stringify({ placa, ...(chassi && { chassi }) });
      r = await apiCall(
        'http://api.leilao.nullorisco.com.br/api/consulta/placachassi',
        'POST', body, { Authorization: `Bearer ${NULLORISCO_JWT}` }
      );
      if (!r.text.trim()) return { ok: true, data: [], semOcorrencias: true };
      if (r.status >= 400) return { ok: true, data: [], semOcorrencias: true, aviso: extractError(r.text, r.status) };
      console.log('[DEBUG leilao] status:', r.status, '| body:', r.text.slice(0, 600));
      return makeResult(r.status, r.text);
    }

    // 8. NulloRisco — Fotos (requer placa + chassi)
    case 'fotos': {
      const chassi = extra.chassi ?? '';
      const body = JSON.stringify({ placa, ...(chassi && { chassi }) });
      r = await apiCall(
        'http://api.adm.nullorisco.com.br/v1/imagem/consulta',
        'POST', body, { Authorization: `Bearer ${NULLORISCO_JWT}` }
      );
      if (!r.text.trim()) return { ok: true, data: [], semOcorrencias: true };
      if (r.status >= 400) return { ok: true, data: [], semOcorrencias: true, aviso: extractError(r.text, r.status) };
      return makeResult(r.status, r.text);
    }

    // 9. NulloRisco — Sinistro (requer placa + chassi)
    case 'sinistro': {
      const chassi = extra.chassi ?? '';
      const body = JSON.stringify({ placa, ...(chassi && { chassi }) });
      r = await apiCall(
        'http://api.adm.nullorisco.com.br/v1/sinistro/consulta3',
        'POST', body, { Authorization: `Bearer ${NULLORISCO_JWT}` }
      );
      if (!r.text.trim()) return { ok: true, data: [], semOcorrencias: true };
      if (r.status >= 400) return { ok: true, data: [], semOcorrencias: true, aviso: extractError(r.text, r.status) };
      return makeResult(r.status, r.text);
    }

    // 10. DespachasBrasil — Gravame
    case 'gravame': {
      const body = JSON.stringify({ placa });
      r = await apiCall(
        'https://api.despachabrasil.com.br/v1/consultagravame/consulta',
        'POST', body, { Authorization: `Bearer ${NULLORISCO_JWT}` }
      );
      if (!r.text.trim()) return { ok: true, data: null, semGravame: true };
      // 4xx sem autenticação correta = sem dados disponíveis (tratar como sem gravame)
      if (r.status >= 400) return { ok: true, data: null, semGravame: true, aviso: extractError(r.text, r.status) };
      return makeResult(r.status, r.text);
    }

    // 11. PIX — criar cobrança
    case 'criar_pix': {
      if (!EFIPAY_CLIENT_ID) return { ok: false, error: 'EfíPay não configurado. Preencha EFIPAY_CLIENT_ID no server.js.' };
      const cred = Buffer.from(`${EFIPAY_CLIENT_ID}:${EFIPAY_CLIENT_SECRET}`).toString('base64');
      const tok  = await apiCall(
        'https://pix.api.efipay.com.br/oauth/token',
        'POST', 'grant_type=client_credentials',
        { Authorization: `Basic ${cred}`, 'Content-Type': 'application/x-www-form-urlencoded' }
      );
      const td = tryJson(tok.text);
      if (!td?.access_token) return { ok: false, error: 'Falha no token EfíPay' };
      const cob = await apiCall(
        'https://pix.api.efipay.com.br/v2/cob',
        'POST',
        JSON.stringify({
          calendario: { expiracao: 3600 },
          devedor: { cpf: (extra.cpf ?? '00000000000').replace(/\D/g,''), nome: extra.nome ?? 'Cliente' },
          valor: { original: PRECO_LAUDO },
          chave: EFIPAY_CHAVE_PIX,
          infoAdicionais: [{ nome: 'Placa', valor: placa }],
        }),
        { Authorization: `Bearer ${td.access_token}` }
      );
      const cd = tryJson(cob.text);
      if (cd?.loc?.id) {
        const qr = await apiCall(
          `https://pix.api.efipay.com.br/v2/loc/${cd.loc.id}/qrcode`,
          'GET', null, { Authorization: `Bearer ${td.access_token}` }
        );
        cd.qrcode = tryJson(qr.text);
      }
      return { ok: !!cd?.txid, data: cd };
    }

    // 12. PIX — verificar
    case 'verificar_pix': {
      if (!EFIPAY_CLIENT_ID || !extra.txid) return { ok: false, pago: false, error: 'Não configurado' };
      const cred = Buffer.from(`${EFIPAY_CLIENT_ID}:${EFIPAY_CLIENT_SECRET}`).toString('base64');
      const tok  = await apiCall(
        'https://pix.api.efipay.com.br/oauth/token',
        'POST', 'grant_type=client_credentials',
        { Authorization: `Basic ${cred}`, 'Content-Type': 'application/x-www-form-urlencoded' }
      );
      const td = tryJson(tok.text);
      if (!td?.access_token) return { ok: false, pago: false, error: 'Falha no token' };
      const cv = await apiCall(
        `https://pix.api.efipay.com.br/v2/cob/${extra.txid}`,
        'GET', null, { Authorization: `Bearer ${td.access_token}` }
      );
      const cd = tryJson(cv.text);
      return { ok: true, pago: cd?.status === 'CONCLUIDA', data: cd };
    }

    default:
      return { ok: false, error: `Ação desconhecida: ${action}` };
  }
}

function tryJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ─── MIME types ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

// ─── Servidor HTTP ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;

  // ── CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Proxy API
  if (url === '/proxy.php' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      try {
        const input  = JSON.parse(body);
        const placa  = (input.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const result = await handleAction(input.action, placa, input);
        console.log(`[API] ${input.action} ${placa} → ${result.ok ? 'OK' : 'ERRO: ' + result.error}`);
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('[ERRO]', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // ── Arquivos estáticos
  const filePath = path.join(__dir, url.split('?')[0]);
  const ext      = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + url);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('\n═══════════════════════════════════════════════');
  console.log(`  🚗  Vistoriador Online — Servidor iniciado`);
  console.log(`  🌐  Abra: http://localhost:${PORT}`);
  console.log('═══════════════════════════════════════════════\n');
  console.log('  Pressione Ctrl+C para encerrar.\n');
});
