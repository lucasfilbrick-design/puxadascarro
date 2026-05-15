<?php
/**
 * proxy.php — Backend proxy para APIs do VistoriadorOnline
 * Coloque este arquivo no mesmo servidor que o index.html
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ─── Credenciais ──────────────────────────────────────────────────────────────
define('CONFERI_USUARIO', '7261');
define('CONFERI_SENHA',   '13459377');

define('NULLORISCO_JWT',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' .
    'eyJ1bmlxdWVfbmFtZSI6IlZpc3RvcmlhZG9yT25saW5lIiwicm9sZSI6IkFSLUNPTlNVTFRBTEVJTEFPIiwibmFtZWlkIjoiRTIwNTE2NTgtRTUyMi00RUVCLUFENjMtOTM2QTQ2QUNGNDhCIiwibmJmIjoxNzMxOTU1MTg1LCJleHAiOjIwNDc0ODc5ODUsImlhdCI6MTczMTk1NTE4NX0.' .
    'uEDK5vY5xi2uV0LKgjZISpL7No_gMejGky9SODLG_5U'
);

// ─── PIX (EfíPay) — preencha com suas credenciais ────────────────────────────
define('EFIPAY_CLIENT_ID',     '');   // preencha
define('EFIPAY_CLIENT_SECRET', '');   // preencha
define('EFIPAY_CHAVE_PIX',     '');   // sua chave PIX
define('PRECO_LAUDO',          29.90);

// ─── Helper cURL ─────────────────────────────────────────────────────────────
function api_call(string $url, string $method = 'POST', $body = null, array $headers = []): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
    ]);

    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
    } elseif ($method === 'GET') {
        curl_setopt($ch, CURLOPT_HTTPGET, true);
    }

    if ($headers) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }

    $response  = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error     = curl_error($ch);
    curl_close($ch);

    return ['raw' => $response, 'code' => $http_code, 'curl_error' => $error];
}

function xml_to_array(string $xml): ?array {
    libxml_use_internal_errors(true);
    $obj = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NOCDATA);
    if ($obj === false) return null;
    return json_decode(json_encode($obj), true);
}

// ─── Roteador ────────────────────────────────────────────────────────────────
$input = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $input['action'] ?? '';
$placa  = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $input['placa'] ?? ''));
$chassi = $input['chassi'] ?? '';
$cod    = $input['cod_consulta'] ?? '';

$out = ['ok' => false, 'action' => $action, 'data' => null, 'error' => null];

switch ($action) {

    // ── 1. Preliminares (dados básicos) ──────────────────────────────────────
    case 'preliminares':
        $body = json_encode([
            'usuario'         => CONFERI_USUARIO,
            'senha'           => CONFERI_SENHA,
            'parametro'       => $placa,
            'tipo_parametro'  => 'placa',
            'pesquisa'        => '6',
        ]);
        $r = api_call(
            'https://webservice.companyconferi.com.br/sistema/producao/agregados/conferiAgregados.php',
            'POST', $body,
            ['Content-Type: application/json', 'Accept: application/xml']
        );
        if ($r['code'] === 200 && $r['raw']) {
            $arr = xml_to_array($r['raw']);
            $out['ok']   = ($arr !== null);
            $out['data'] = $arr ?? ['raw' => $r['raw']];
        } else {
            $out['error'] = "HTTP {$r['code']}: {$r['curl_error']}";
        }
        break;

    // ── 2. Conferi — obter código (inicia perícia) ───────────────────────────
    case 'conferi_codigo':
        $url = 'https://webservice.companyconferi.com.br/sistema/producao/pericia/conferiVeiculo.php'
             . '?usuario=' . urlencode(CONFERI_USUARIO)
             . '&senha='   . urlencode(CONFERI_SENHA)
             . '&pesquisa=6&tipo_parametro=placa&parametro=' . urlencode($placa);
        $r = api_call($url, 'GET', null, ['Accept: application/xml']);
        if ($r['code'] === 200 && $r['raw']) {
            $arr = xml_to_array($r['raw']);
            $out['ok']   = ($arr !== null);
            $out['data'] = $arr ?? ['raw' => $r['raw']];
        } else {
            $out['error'] = "HTTP {$r['code']}: {$r['curl_error']}";
        }
        break;

    // ── 3. Conferi — emissão (PDF/laudo final) ───────────────────────────────
    case 'conferi_emissao':
        $url = 'https://webservice.companyconferi.com.br/sistema/producao/pericia/conferiVeiculoAtualizaXML.php'
             . '?usuario=' . urlencode(CONFERI_USUARIO)
             . '&senha='   . urlencode(CONFERI_SENHA)
             . '&pesquisa=6&tipo_parametro=placa&parametro=' . urlencode($placa)
             . '&codigo_consulta=' . urlencode($cod);
        $r = api_call($url, 'GET', null, ['Accept: application/xml']);
        if ($r['code'] === 200 && $r['raw']) {
            $arr = xml_to_array($r['raw']);
            $out['ok']   = ($arr !== null);
            $out['data'] = $arr ?? ['raw' => $r['raw']];
        } else {
            $out['error'] = "HTTP {$r['code']}: {$r['curl_error']}";
        }
        break;

    // ── 4. Conferi — Leilão Completo ─────────────────────────────────────────
    case 'conferi_leilao':
        $body = json_encode(['placa' => $placa,
                             'usuario' => CONFERI_USUARIO,
                             'senha'   => CONFERI_SENHA]);
        $r = api_call(
            'https://webservice.companyconferi.com.br/api-clientes/conferi-leilao-completo/json',
            'POST', $body,
            ['Content-Type: application/json']
        );
        $out['ok']   = ($r['code'] >= 200 && $r['code'] < 300);
        $out['data'] = json_decode($r['raw'], true) ?? ['raw' => $r['raw']];
        if (!$out['ok']) $out['error'] = "HTTP {$r['code']}";
        break;

    // ── 5. Conferi — Gravame ─────────────────────────────────────────────────
    case 'conferi_gravame':
        $body = json_encode(['placa' => $placa,
                             'usuario' => CONFERI_USUARIO,
                             'senha'   => CONFERI_SENHA]);
        $r = api_call(
            'https://webservice.companyconferi.com.br/api-clientes/conferi-gravame/json',
            'POST', $body,
            ['Content-Type: application/json']
        );
        $out['ok']   = ($r['code'] >= 200 && $r['code'] < 300);
        $out['data'] = json_decode($r['raw'], true) ?? ['raw' => $r['raw']];
        if (!$out['ok']) $out['error'] = "HTTP {$r['code']}";
        break;

    // ── 6. Conferi — Gerar PDF ───────────────────────────────────────────────
    case 'gerar_pdf':
        $body = json_encode(['placa' => $placa,
                             'usuario' => CONFERI_USUARIO,
                             'senha'   => CONFERI_SENHA,
                             'cod_consulta' => $cod]);
        $r = api_call(
            'https://webservice.companyconferi.com.br/gerar-pdf/',
            'POST', $body,
            ['Content-Type: application/json']
        );
        $out['ok']   = ($r['code'] >= 200 && $r['code'] < 300);
        $out['data'] = json_decode($r['raw'], true) ?? ['raw' => $r['raw']];
        if (!$out['ok']) $out['error'] = "HTTP {$r['code']}";
        break;

    // ── 7. NulloRisco — Leilão por placa/chassi ──────────────────────────────
    case 'leilao':
        $body = json_encode(['placa' => $placa]);
        $r = api_call(
            'http://api.leilao.nullorisco.com.br/api/consulta/placachassi',
            'POST', $body,
            ['Content-Type: application/json', 'Authorization: Bearer ' . NULLORISCO_JWT]
        );
        $out['ok']   = ($r['code'] >= 200 && $r['code'] < 300);
        $out['data'] = json_decode($r['raw'], true) ?? ['raw' => $r['raw']];
        if (!$out['ok']) $out['error'] = "HTTP {$r['code']}";
        break;

    // ── 8. NulloRisco — Fotos do veículo ─────────────────────────────────────
    case 'fotos':
        $body = json_encode(['placa' => $placa]);
        $r = api_call(
            'http://api.adm.nullorisco.com.br/v1/imagem/consulta',
            'POST', $body,
            ['Content-Type: application/json', 'Authorization: Bearer ' . NULLORISCO_JWT]
        );
        $out['ok']   = ($r['code'] >= 200 && $r['code'] < 300);
        $out['data'] = json_decode($r['raw'], true) ?? ['raw' => $r['raw']];
        if (!$out['ok']) $out['error'] = "HTTP {$r['code']}";
        break;

    // ── 9. NulloRisco — Sinistro ─────────────────────────────────────────────
    case 'sinistro':
        $body = json_encode(['placa' => $placa]);
        $r = api_call(
            'http://api.adm.nullorisco.com.br/v1/sinistro/consulta3',
            'POST', $body,
            ['Content-Type: application/json', 'Authorization: Bearer ' . NULLORISCO_JWT]
        );
        $out['ok']   = ($r['code'] >= 200 && $r['code'] < 300);
        $out['data'] = json_decode($r['raw'], true) ?? ['raw' => $r['raw']];
        if (!$out['ok']) $out['error'] = "HTTP {$r['code']}";
        break;

    // ── 10. DespachasBrasil — Gravame ────────────────────────────────────────
    case 'gravame':
        $body = json_encode(['placa' => $placa]);
        $r = api_call(
            'https://api.despachabrasil.com.br/v1/consultagravame/consulta',
            'POST', $body,
            ['Content-Type: application/json', 'Authorization: Bearer ' . NULLORISCO_JWT]
        );
        $out['ok']   = ($r['code'] >= 200 && $r['code'] < 300);
        $out['data'] = json_decode($r['raw'], true) ?? ['raw' => $r['raw']];
        if (!$out['ok']) $out['error'] = "HTTP {$r['code']}";
        break;

    // ── 11. PIX — criar cobrança (EfíPay) ────────────────────────────────────
    case 'criar_pix':
        if (!EFIPAY_CLIENT_ID) {
            $out['error'] = 'EfíPay não configurado. Preencha EFIPAY_CLIENT_ID e EFIPAY_CLIENT_SECRET no proxy.php.';
            break;
        }
        // OAuth
        $auth = base64_encode(EFIPAY_CLIENT_ID . ':' . EFIPAY_CLIENT_SECRET);
        $token_r = api_call(
            'https://pix.api.efipay.com.br/oauth/token',
            'POST',
            'grant_type=client_credentials',
            [
                'Authorization: Basic ' . $auth,
                'Content-Type: application/x-www-form-urlencoded',
            ]
        );
        $token_data = json_decode($token_r['raw'], true);
        if (empty($token_data['access_token'])) {
            $out['error'] = 'Falha ao obter token EfíPay';
            break;
        }
        $bearer = $token_data['access_token'];
        // Criar cobrança
        $cpf      = preg_replace('/\D/', '', $input['cpf'] ?? '00000000000');
        $nome     = $input['nome'] ?? 'Cliente';
        $cob_body = json_encode([
            'calendario'  => ['expiracao' => 3600],
            'devedor'     => ['cpf' => $cpf, 'nome' => $nome],
            'valor'       => ['original' => number_format(PRECO_LAUDO, 2, '.', '')],
            'chave'       => EFIPAY_CHAVE_PIX,
            'infoAdicionais' => [['nome' => 'Placa', 'valor' => $placa]],
        ]);
        $cob_r = api_call(
            'https://pix.api.efipay.com.br/v2/cob',
            'POST', $cob_body,
            ['Content-Type: application/json', 'Authorization: Bearer ' . $bearer]
        );
        $cob = json_decode($cob_r['raw'], true);
        if (isset($cob['loc']['id'])) {
            // obter QR Code
            $qr_r = api_call(
                "https://pix.api.efipay.com.br/v2/loc/{$cob['loc']['id']}/qrcode",
                'GET', null,
                ['Authorization: Bearer ' . $bearer]
            );
            $qr = json_decode($qr_r['raw'], true);
            $cob['qrcode'] = $qr;
        }
        $out['ok']   = isset($cob['txid']);
        $out['data'] = $cob;
        if (!$out['ok']) $out['error'] = "Falha ao criar cobrança PIX";
        break;

    // ── 12. PIX — verificar pagamento ────────────────────────────────────────
    case 'verificar_pix':
        $txid = $input['txid'] ?? '';
        if (!EFIPAY_CLIENT_ID || !$txid) {
            $out['error'] = 'EfíPay não configurado ou txid ausente';
            break;
        }
        $auth = base64_encode(EFIPAY_CLIENT_ID . ':' . EFIPAY_CLIENT_SECRET);
        $token_r = api_call(
            'https://pix.api.efipay.com.br/oauth/token',
            'POST', 'grant_type=client_credentials',
            ['Authorization: Basic ' . $auth, 'Content-Type: application/x-www-form-urlencoded']
        );
        $token_data = json_decode($token_r['raw'], true);
        if (empty($token_data['access_token'])) {
            $out['error'] = 'Falha ao obter token EfíPay';
            break;
        }
        $cob_r = api_call(
            "https://pix.api.efipay.com.br/v2/cob/{$txid}",
            'GET', null,
            ['Authorization: Bearer ' . $token_data['access_token']]
        );
        $cob = json_decode($cob_r['raw'], true);
        $out['ok']   = true;
        $out['data'] = $cob;
        $out['pago'] = ($cob['status'] ?? '') === 'CONCLUIDA';
        break;

    default:
        http_response_code(400);
        $out['error'] = "Ação desconhecida: {$action}";
}

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
