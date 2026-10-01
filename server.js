// =============================================
// server.js — Painel Web completo
// Atualizado: novas variáveis .env, rodízio Gemini,
// MERCADO_PAGO_ACCESS_TOKEN, PORT/WEBHOOK_PORT
// =============================================
import express    from 'express';
import multer     from 'multer';
import fs         from 'fs';
import http       from 'http';
import os         from 'os';
import path       from 'path';
import { fileURLToPath } from 'url';
import { config, validarConfig }                               from './config.js';
import { verificarConexao, configurarWebhook, enviarMensagem } from './modules/evolution.js';
import { iniciarDisparo, pararDisparo, getEstado }             from './modules/disparador_engine.js';
import { criarListenerApp, setEmitirLog }                      from './listener.js';
import { lerConfigGemini, salvarConfigGemini }                 from './modules/gemini_config.js';
import { criarCobrancaPix, consultarPagamento, formatarBRL }   from './modules/pagamento.js';
import {
  listarNegocios, adicionarNegocio, atualizarNegocio, removerNegocio,
  listarClientes, adicionarCliente, atualizarCliente, removerCliente,
} from './modules/negocios.js';
import {
  listarAgendamentos, criarAgendamento, atualizarAgendamento,
  cancelarAgendamento, removerAgendamento, verificarPendentes,
} from './modules/agendamento.js';
import {
  executarScraper, inicializarDados as inicializarScraper,
  lerFavoritos, salvarFavorito, removerFavorito,
  lerListas, criarLista, adicionarItemLista, removerLista,
} from './modules/scraper_engine.js';
import {
  lerConfigApify, salvarConfigApify, listarAtoresApify,
  iniciarScraperApify, consultarRunApify, obterItensDatasetApify,
  lerLeadsApify, salvarLeadsApify, limparLeadsApify,
} from './modules/apify_engine.js';
import { gerarKitProspeccaoApify } from './modules/ai_responder.js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app       = express();
const upload    = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// =============================================
// SSE — logs em tempo real
// =============================================
const sseClientes = new Set();

export function emitirLog(tipo, mensagem, dados = {}) {
  const ev = JSON.stringify({ tipo, mensagem, dados, ts: new Date().toISOString() });
  for (const res of sseClientes) {
    try { res.write(`data: ${ev}\n\n`); } catch { sseClientes.delete(res); }
  }
}

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ tipo: 'estado_inicial', dados: getEstado(), ts: new Date().toISOString() })}\n\n`);
  sseClientes.add(res);
  req.on('close', () => sseClientes.delete(res));
});

// Injeta emitirLog no listener
setEmitirLog(emitirLog);

// =============================================
// LISTENER INTERNO — sobe automaticamente
// =============================================
let listenerServer = null;
let listenerAtivo  = false;

function iniciarListener() {
  if (listenerAtivo) return { ok: true, msg: 'Listener já está rodando.' };
  try {
    const lApp = criarListenerApp();
    listenerServer = http.createServer(lApp);
    listenerServer.listen(config.webhookPort, () => {
      listenerAtivo = true;
      emitirLog('sucesso', `🤖 Listener ativo na porta ${config.webhookPort}`, { porta: config.webhookPort });
      console.log(`✅ Listener webhook ativo na porta ${config.webhookPort}`);
    });
    listenerServer.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        listenerAtivo = true;
        emitirLog('aviso', `⚠️  Porta ${config.webhookPort} já em uso — assumindo listener ativo`, {});
      } else {
        listenerAtivo = false;
        emitirLog('erro', `Listener erro: ${err.message}`, {});
      }
    });
    return { ok: true, msg: `Listener iniciado na porta ${config.webhookPort}` };
  } catch(err) {
    return { ok: false, msg: err.message };
  }
}

function pararListener() {
  if (!listenerAtivo || !listenerServer) return { ok: false, msg: 'Listener não está rodando.' };
  listenerServer.close(() => {
    listenerAtivo = false;
    emitirLog('aviso', '🛑 Listener parado.', {});
  });
  listenerServer = null;
  return { ok: true, msg: 'Listener parado.' };
}

// Inicia listener ao subir
iniciarListener();

// Inicializa arquivos do scraper
inicializarScraper();

// ── Verifica agendamentos pendentes a cada minuto ─────────────────
setInterval(async () => {
  try {
    const pendentes = verificarPendentes();
    for (const ag of pendentes) {
      // Marca como executando
      atualizarAgendamento(ag.id, { status: 'executando', executadoEm: new Date().toISOString() });
      emitirLog('info', `⏰ Iniciando agendamento: ${ag.nome}`, { id: ag.id });

      // Salva os leads do agendamento como fila de disparo
      if (ag.leads?.length > 0) {
        if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
        fs.writeFileSync('./data/leads_panel.json', JSON.stringify(ag.leads, null, 2));

        // Inicia o disparo
        try {
          const conexao = await verificarConexao();
          if (conexao.conectado) {
            iniciarDisparo({
              delayMin: ag.delayMin,
              delayMax: ag.delayMax,
              limite:   ag.limite,
              emitirLog,
            });
            atualizarAgendamento(ag.id, { status: 'concluido' });
            emitirLog('sucesso', `✅ Agendamento "${ag.nome}" iniciado — ${ag.leads.length} leads`, { id: ag.id });
          } else {
            atualizarAgendamento(ag.id, { status: 'erro', resultado: 'WhatsApp desconectado' });
            emitirLog('erro', `❌ Agendamento "${ag.nome}" falhou: WhatsApp desconectado`, { id: ag.id });
          }
        } catch(err) {
          atualizarAgendamento(ag.id, { status: 'erro', resultado: err.message });
          emitirLog('erro', `❌ Agendamento "${ag.nome}" falhou: ${err.message}`, { id: ag.id });
        }
      }
    }
  } catch {}
}, 60 * 1000); // verifica a cada 1 minuto

// -----------------------------------------------
// Detecta IP local real da máquina (IPv4, rede local)
// -----------------------------------------------
function getIpLocal() {
  const interfaces = os.networkInterfaces();
  for (const nome of Object.keys(interfaces)) {
    for (const iface of interfaces[nome]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address; // ex: 192.168.18.X
      }
    }
  }
  return 'localhost'; // fallback
}

// Configura webhook na Evolution API automaticamente após 3s
// Usa o IP local real para que mensagens do WhatsApp cheguem ao servidor
setTimeout(async () => {
  try {
    const ipLocal    = getIpLocal();
    const webhookUrl = `http://${ipLocal}:${config.webhookPort}/webhook`;

    console.log(`📡 IP local detectado: ${ipLocal}`);
    console.log(`📡 Registrando webhook: ${webhookUrl}`);

    const r = await configurarWebhook(webhookUrl);
    if (r.sucesso) {
      console.log(`✅ Webhook registrado: ${webhookUrl}`);
      emitirLog('sucesso', `📡 Webhook ativo: ${webhookUrl}`, {});
    } else {
      console.warn(`⚠️  Webhook não registrado: ${r.erro}`);
      emitirLog('aviso', `⚠️  Webhook: ${r.erro}`, {});
    }
  } catch(err) {
    console.warn(`⚠️  Webhook auto-config erro: ${err.message}`);
  }
}, 3000);

// =============================================
// ROTAS — Status
// =============================================
app.get('/api/status', async (req, res) => {
  try {
    const conexao = await verificarConexao();
    res.json({ conexao, estado: getEstado(), listenerAtivo, gemini: lerConfigGemini(), chaves: config.geminiKeys.length });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/webhook/status', async (req, res) => {
  try {
    const { default: axios } = await import('axios');
    const url = `${config.evolutionApiUrl}/webhook/find/${config.instanceName}`;
    const r   = await axios.get(url, {
      headers: { 'Content-Type': 'application/json', 'apikey': config.apiKey },
      timeout: 8000,
    });
    const atual    = r.data?.url || null;
    const esperado = config.webhookUrl;
    res.json({ configurado: !!atual, url_atual: atual, url_esperada: esperado, correto: atual === esperado });
  } catch(err) {
    res.json({ configurado: false, erro: err.message });
  }
});

app.post('/api/listener/iniciar',  (req, res) => res.json(iniciarListener()));
app.post('/api/listener/parar',    (req, res) => res.json(pararListener()));
app.get('/api/listener/status',    (req, res) => res.json({ ativo: listenerAtivo, porta: config.webhookPort }));

app.post('/api/listener/configurar-webhook', async (req, res) => {
  try {
    const url = req.body.url || config.webhookUrl;
    const r   = await configurarWebhook(url);
    res.json(r);
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// Teste manual — chama /webhook/teste do listener
app.post('/api/listener/teste', async (req, res) => {
  try {
    const { numero, texto } = req.body;
    if (!numero || !texto) return res.status(400).json({ erro: 'Informe numero e texto.' });
    const { default: http2 } = await import('http');
    const postData = JSON.stringify({ numero, texto });
    const req2 = http2.request({
      hostname: 'localhost',
      port:     config.webhookPort,
      path:     '/webhook/teste',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    }, r => {
      let data = '';
      r.on('data', d => data += d);
      r.on('end', () => res.json({ ok: true, msg: 'Simulação enviada! Verifique o log.' }));
    });
    req2.on('error', () => {
      emitirLog('aviso', `🧪 TESTE: ${numero} — "${texto}"`, {});
      res.json({ ok: true, msg: 'Simulação registrada no log.' });
    });
    req2.write(postData);
    req2.end();
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// =============================================
// ROTAS — CSV Upload
// =============================================
app.post('/api/upload-csv', upload.single('csv'), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
  const conteudo  = req.file.buffer.toString('utf-8');
  const leads = [], erros = [];
  const linhas    = conteudo.split('\n');
  if (linhas.length < 2) return res.status(400).json({ erro: 'CSV vazio ou inválido.' });
  const cab       = linhas[0].split(',').map(c => c.trim().replace(/^"|"$/g, '').toLowerCase());
  const iPhone    = cab.indexOf('phone');
  const iTitle    = cab.indexOf('title');
  const iAddr     = cab.indexOf('address');
  const iCat      = cab.indexOf('category');
  if (iPhone === -1) return res.status(400).json({ erro: 'Coluna "phone" não encontrada.' });
  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i].trim(); if (!linha) continue;
    const cols  = linha.match(/(".*?"|[^,]+)(?=,|$)/g)?.map(c => c.replace(/^"|"$/g, '').trim()) || linha.split(',');
    const phone = formatarTelefone(cols[iPhone] || '');
    if (!phone) { erros.push({ linha: i + 1, motivo: 'Telefone inválido', raw: cols[iPhone] }); continue; }
    leads.push({ title: cols[iTitle] || 'Empresa', phone, address: cols[iAddr] || '', category: cols[iCat] || '', status: 'pendente' });
  }
  const unicos = [...new Map(leads.map(l => [l.phone, l])).values()];
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync('./data/leads_panel.json', JSON.stringify(unicos, null, 2));
  // Remove enviados que estão neste CSV
  try {
    const ep = './data/enviados.json';
    if (fs.existsSync(ep)) {
      const env   = JSON.parse(fs.readFileSync(ep, 'utf-8'));
      const phones = new Set(unicos.map(l => l.phone));
      phones.forEach(p => delete env[p]);
      fs.writeFileSync(ep, JSON.stringify(env, null, 2));
    }
  } catch {}
  res.json({ total: unicos.length, invalidos: erros.length, amostra: unicos.slice(0, 5), erros: erros.slice(0, 10) });
});

// =============================================
// ROTAS — Disparo
// =============================================
app.post('/api/iniciar', async (req, res) => {
  const estado = getEstado();
  if (estado.rodando) return res.status(400).json({ erro: 'Disparo já em andamento.' });
  if (!fs.existsSync('./data/leads_panel.json')) return res.status(400).json({ erro: 'Nenhum CSV carregado.' });
  const conexao = await verificarConexao();
  if (!conexao.conectado) return res.status(400).json({ erro: `WhatsApp não conectado (${conexao.estado}).` });
  iniciarDisparo({ delayMin: parseInt(req.body.delayMin || config.delayMin), delayMax: parseInt(req.body.delayMax || config.delayMax), limite: parseInt(req.body.limite || 0), emitirLog });
  res.json({ ok: true });
});
app.post('/api/parar', (req, res) => { pararDisparo(); res.json({ ok: true }); });
app.get('/api/estado', (req, res) => res.json(getEstado()));

// =============================================
// ROTAS — Gemini
// =============================================
app.get('/api/gemini',         (req, res) => res.json(lerConfigGemini()));
app.post('/api/gemini',        (req, res) => res.json(salvarConfigGemini(req.body)));
app.post('/api/gemini/toggle', (req, res) => {
  const atual = lerConfigGemini();
  const nova  = salvarConfigGemini({ ativo: !atual.ativo });
  emitirLog(nova.ativo ? 'sucesso' : 'aviso', `🤖 Gemini ${nova.ativo ? 'ATIVADO' : 'DESATIVADO'}`, { ativo: nova.ativo });
  if (nova.ativo && !listenerAtivo) iniciarListener();
  res.json(nova);
});
app.get('/api/gemini/diagnostico', async (req, res) => {
  try {
    const { testarApiKey } = await import('./modules/ai_responder.js');
    res.json(await testarApiKey());
  } catch(err) { res.status(500).json({ erro: err.message }); }
});
app.post('/api/gemini/teste', async (req, res) => {
  try {
    const { mensagem } = req.body;
    if (!mensagem?.trim()) return res.status(400).json({ erro: 'Mensagem vazia.' });
    const { gerarResposta } = await import('./modules/ai_responder.js');
    const resposta = await gerarResposta(
      { title: 'Empresa Teste', category: 'Teste' },
      [{ de: 'cliente', texto: mensagem, timestamp: new Date().toISOString() }]
    );
    res.json({ resposta: resposta || '(sem resposta)' });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// =============================================
// ROTAS — Conversas
// =============================================
app.get('/api/conversas', (req, res) => {
  try { res.json(fs.existsSync(config.paths.conversas) ? JSON.parse(fs.readFileSync(config.paths.conversas, 'utf-8')) : {}); }
  catch { res.json({}); }
});

app.get('/api/conversas/:phone', (req, res) => {
  try {
    const { phone } = req.params;
    const p    = config.paths.conversas;
    const conv = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
    if (!conv[phone]) return res.status(404).json({ erro: 'Conversa não encontrada' });
    res.json(conv[phone]);
  } catch(err) { res.status(500).json({ erro: err.message }); }
});
app.post('/api/conversas/retomar', (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ erro: 'phone obrigatório' });
    const p  = config.paths.conversas;
    const conv = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
    if (!conv[phone]) return res.status(404).json({ erro: 'Conversa não encontrada' });
    conv[phone].status = 'retomado';
    delete conv[phone].handover_em;
    fs.writeFileSync(p, JSON.stringify(conv, null, 2));
    emitirLog('sucesso', `▶ Bot retomado para ${phone}`, { phone });
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});
app.post('/api/conversas/resetar', (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ erro: 'phone obrigatório' });
    const p    = config.paths.conversas;
    const conv = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
    delete conv[phone];
    fs.writeFileSync(p, JSON.stringify(conv, null, 2));
    emitirLog('info', `🔄 Conversa resetada para ${phone}`, { phone });
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// =============================================
// ROTAS — Pagamento standalone & Dashboard Financial Stats
// =============================================
const COBRANCAS_PATH = './data/cobrancas.json';

function lerCobrancas() {
  if (!fs.existsSync(COBRANCAS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(COBRANCAS_PATH, 'utf-8')); }
  catch { return []; }
}

function salvarCobrancas(cobrancas) {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync(COBRANCAS_PATH, JSON.stringify(cobrancas, null, 2));
}

app.post('/api/pagamento/gerar', async (req, res) => {
  try {
    const { valor, descricao, nomeCliente, emailCliente, numeroEnvio } = req.body;
    if (!valor || parseFloat(valor) <= 0) return res.status(400).json({ erro: 'Valor inválido.' });

    const pix = await criarCobrancaPix({
      valor,
      descricao:   descricao   || 'Serviço de desenvolvimento web',
      nomeCliente: nomeCliente || 'Cliente',
      emailCliente: emailCliente || 'cliente@email.com',
    });

    const itemCobranca = {
      id: pix.id,
      valor: pix.valor,
      descricao: descricao || 'Serviço de desenvolvimento web',
      nomeCliente: nomeCliente || 'Cliente',
      emailCliente: emailCliente || 'cliente@email.com',
      numeroEnvio: numeroEnvio || '',
      status: pix.status || 'pending',
      criadoEm: pix.criadoEm || new Date().toISOString(),
      pagoEm: null,
      initPoint: pix.initPoint || pix.ticketUrl || '',
    };

    const cobrancas = lerCobrancas();
    cobrancas.unshift(itemCobranca);
    salvarCobrancas(cobrancas);

    // Se informou número, envia a mensagem de cobrança pelo WhatsApp
    let enviado = false;
    if (numeroEnvio && numeroEnvio.trim()) {
      try {
        const num = numeroEnvio.replace(/\D/g, '');
        const msg =
          `Olá! Segue o link de pagamento para finalizar a contratação 😊\n\n` +
          `💰 *Valor:* ${formatarBRL(valor)}\n` +
          `📋 *Descrição:* ${descricao || 'Serviço de desenvolvimento web'}\n\n` +
          `💳 *Pague via PIX, Cartão de Crédito, Boleto ou Mercado Pago:*\n` +
          `${pix.initPoint || pix.ticketUrl}\n\n` +
          `Após a confirmação do pagamento, iniciamos o projeto imediatamente! 🚀`;

        await enviarMensagem(num, msg, 3000);
        enviado = true;
        emitirLog('sucesso', `💰 Link Checkout Pro enviado para ${num} — ${formatarBRL(valor)}`, {});
      } catch(envErr) {
        console.error('[PIX] Erro ao enviar:', envErr.message);
      }
    }

    res.json({ ok: true, pix, enviado });
  } catch(err) {
    emitirLog('erro', `Erro ao gerar PIX: ${err.message}`, {});
    res.status(500).json({ erro: err.message });
  }
});

// Consulta status de um pagamento PIX
app.get('/api/pagamento/:id/status', async (req, res) => {
  try {
    const cobrancas = lerCobrancas();
    const item = cobrancas.find(c => String(c.id) === String(req.params.id));
    const status = await consultarPagamento(req.params.id, item?.valor, item?.descricao);

    if (item) {
      if (status.pago) {
        item.status = 'approved';
        if (!item.pagoEm) item.pagoEm = new Date().toISOString();
      } else {
        item.status = status.status || item.status;
      }
      salvarCobrancas(cobrancas);
    }
    res.json(status);
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// Webhook / IPN do Mercado Pago para notificação de pagamentos
app.post('/webhook/mercadopago', async (req, res) => {
  try {
    const { type, action, data } = req.body;
    const paymentId = data?.id || req.query['data.id'] || req.query.id;
    if (paymentId) {
      const status = await consultarPagamento(paymentId);
      const cobrancas = lerCobrancas();
      const idx = cobrancas.findIndex(c => String(c.id) === String(paymentId) || (c.initPoint && c.initPoint.includes(paymentId)));
      if (idx !== -1) {
        if (status.pago) {
          cobrancas[idx].status = 'approved';
          if (!cobrancas[idx].pagoEm) cobrancas[idx].pagoEm = new Date().toISOString();
        } else {
          cobrancas[idx].status = status.status || cobrancas[idx].status;
        }
        salvarCobrancas(cobrancas);
        emitirLog('sucesso', `💰 Pagamento ${paymentId} confirmado via Webhook Mercado Pago!`, {});
      }
    }
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// Endpoint de estatísticas financeiras e dados do gráfico por período
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const { periodo = '30d', dataInicio, dataFim } = req.query;
    let cobrancas = lerCobrancas();

    // Auto-verifica no Mercado Pago as cobranças pendentes para atualizar pagamentos aprovados
    let houveAtualizacao = false;
    for (let c of cobrancas) {
      if (c.status !== 'approved' && c.id) {
        try {
          const st = await consultarPagamento(c.id, c.valor, c.descricao);
          if (st && st.pago) {
            c.status = 'approved';
            c.pagoEm = new Date().toISOString();
            houveAtualizacao = true;
          }
        } catch(e) {}
      }
    }
    if (houveAtualizacao) {
      salvarCobrancas(cobrancas);
    }

    const hoje = new Date();

    let inicio;
    let fim = new Date();

    if (periodo === 'hoje') {
      inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0);
    } else if (periodo === 'ontem') {
      inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1, 0, 0, 0);
      fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1, 23, 59, 59);
    } else if (periodo === '7d') {
      inicio = new Date();
      inicio.setDate(hoje.getDate() - 7);
      inicio.setHours(0,0,0,0);
    } else if (periodo === '30d' || periodo === '1m') {
      inicio = new Date();
      inicio.setDate(hoje.getDate() - 30);
      inicio.setHours(0,0,0,0);
    } else if (periodo === 'custom' && dataInicio && dataFim) {
      inicio = new Date(`${dataInicio}T00:00:00`);
      fim = new Date(`${dataFim}T23:59:59`);
    } else {
      inicio = new Date(0); // tudo
    }

    const cobrancasNoPeriodo = cobrancas.filter(c => {
      const d = new Date(c.pagoEm || c.criadoEm);
      return d >= inicio && d <= fim;
    });

    const pagasNoPeriodo = cobrancasNoPeriodo.filter(c => c.status === 'approved' || c.pago === true);
    const pendentesNoPeriodo = cobrancasNoPeriodo.filter(c => c.status !== 'approved');

    const totalFaturado = pagasNoPeriodo.reduce((acc, c) => acc + (parseFloat(c.valor) || 0), 0);
    const totalPendente = pendentesNoPeriodo.reduce((acc, c) => acc + (parseFloat(c.valor) || 0), 0);
    const qtdVendas = pagasNoPeriodo.length;

    // Calcular conversão
    const totalCobrancas = cobrancasNoPeriodo.length;
    const taxaConversao = totalCobrancas > 0 ? ((qtdVendas / totalCobrancas) * 100).toFixed(1) : 0;

    // Agrupar dados para o gráfico (por dia ou mês conforme intervalo)
    const diffDias = Math.ceil((fim - inicio) / (1000 * 60 * 60 * 24));

    const pontosGrafico = [];

    if (periodo === 'hoje' || periodo === 'ontem') {
      // Agrupa por hora do dia (00:00, 04:00, 08:00, 12:00, 16:00, 20:00, 23:00)
      const horas = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '23:59'];
      const horasMap = new Map();

      horas.forEach(h => horasMap.set(h, { label: h, value: 0, count: 0 }));

      pagasNoPeriodo.forEach(c => {
        const d = new Date(c.pagoEm || c.criadoEm);
        const hora = d.getHours();

        let bucket = '00:00';
        if (hora >= 22) bucket = '23:59';
        else if (hora >= 18) bucket = '20:00';
        else if (hora >= 14) bucket = '16:00';
        else if (hora >= 10) bucket = '12:00';
        else if (hora >= 6)  bucket = '08:00';
        else if (hora >= 2)  bucket = '04:00';

        const item = horasMap.get(bucket);
        if (item) {
          item.value += parseFloat(c.valor) || 0;
          item.count += 1;
        }
      });

      horasMap.forEach((v) => pontosGrafico.push(v));
    } else if (diffDias <= 31) {
      // Agrupa por dia
      const diasMap = new Map();
      const tempDate = new Date(inicio);
      while (tempDate <= fim) {
        const key = tempDate.toISOString().split('T')[0];
        const label = tempDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        diasMap.set(key, { label, value: 0, count: 0 });
        tempDate.setDate(tempDate.getDate() + 1);
      }

      pagasNoPeriodo.forEach(c => {
        const key = (c.pagoEm || c.criadoEm).split('T')[0];
        if (diasMap.has(key)) {
          const item = diasMap.get(key);
          item.value += parseFloat(c.valor) || 0;
          item.count += 1;
        }
      });

      diasMap.forEach((v) => pontosGrafico.push(v));
    } else {
      // Agrupa por mês
      const mesesMap = new Map();
      pagasNoPeriodo.forEach(c => {
        const d = new Date(c.pagoEm || c.criadoEm);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).toUpperCase();
        if (!mesesMap.has(key)) mesesMap.set(key, { label, value: 0, count: 0 });
        const item = mesesMap.get(key);
        item.value += parseFloat(c.valor) || 0;
        item.count += 1;
      });
      mesesMap.forEach((v) => pontosGrafico.push(v));
    }

    res.json({
      ok: true,
      summary: {
        totalFaturado,
        totalPendente,
        qtdVendas,
        totalCobrancas,
        taxaConversao: `${taxaConversao}%`,
      },
      chartData: pontosGrafico,
      recent: cobrancas.slice(0, 10),
    });
  } catch(err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// =============================================
// ROTAS — Agendamentos
// =============================================
app.get('/api/agendamentos', (req, res) => res.json(listarAgendamentos()));

app.post('/api/agendamentos', upload.single('csv'), (req, res) => {
  try {
    const body = req.body;
    let leads = [];
    let csvNome = '';

    // Processa CSV se enviado
    if (req.file) {
      csvNome = req.file.originalname;
      const conteudo = req.file.buffer.toString('utf-8');
      const linhas   = conteudo.split('\n');
      const cab      = linhas[0].split(',').map(c => c.trim().replace(/^"|"$/g,'').toLowerCase());
      const iPhone   = cab.indexOf('phone');
      const iTitle   = cab.indexOf('title');
      const iCat     = cab.indexOf('category');
      if (iPhone !== -1) {
        for (let i = 1; i < linhas.length; i++) {
          const linha = linhas[i].trim(); if (!linha) continue;
          const cols  = linha.match(/(".*?"|[^,]+)(?=,|$)/g)?.map(c=>c.replace(/^"|"$/g,'').trim()) || linha.split(',');
          const phone = formatarTelefone(cols[iPhone] || '');
          if (!phone) continue;
          leads.push({ title: cols[iTitle]||'Empresa', phone, category: cols[iCat]||'', status:'pendente' });
        }
      }
      // Remove duplicatas
      leads = [...new Map(leads.map(l=>[l.phone,l])).values()];
    }

    const ag = criarAgendamento({
      nome:     body.nome,
      csvNome,
      leads,
      dataHora: body.dataHora,
      delayMin: parseInt(body.delayMin || 45),
      delayMax: parseInt(body.delayMax || 90),
      limite:   parseInt(body.limite   || 0),
    });

    res.json({ ok: true, agendamento: ag });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

app.delete('/api/agendamentos/:id', (req, res) => {
  cancelarAgendamento(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/agendamentos/:id/remover', (req, res) => {
  removerAgendamento(req.params.id);
  res.json({ ok: true });
});

// =============================================
// ROTAS — Negócios
// =============================================
app.get('/api/negocios',        (req, res) => res.json(listarNegocios()));
app.post('/api/negocios',       (req, res) => res.json(adicionarNegocio(req.body)));
app.put('/api/negocios/:id',    (req, res) => res.json(atualizarNegocio(req.params.id, req.body)));
app.delete('/api/negocios/:id', (req, res) => { removerNegocio(req.params.id); res.json({ ok: true }); });

app.post('/api/negocios/:id/cobrar', async (req, res) => {
  try {
    const negocio = listarNegocios().find(n => n.id === req.params.id);
    if (!negocio) return res.status(404).json({ erro: 'Negócio não encontrado.' });
    const { valor, descricao } = req.body;
    if (!valor || parseFloat(valor) <= 0) return res.status(400).json({ erro: 'Valor inválido.' });

    const cobranca = await criarCobrancaPix({
      valor,
      descricao:   descricao || `Serviço — ${negocio.nome}`,
      nomeCliente: negocio.nome,
      emailCliente: req.body.email || 'cliente@email.com',
    });

    atualizarNegocio(negocio.id, { status: 'cobranca_enviada', pagamento: cobranca });

    // Monta mensagem no formato exato solicitado
    const valorFmt = formatarBRL(valor);
    const desc     = descricao || 'Serviço de desenvolvimento web';

    let msg = `Olá! Segue o link de pagamento para finalizar a contratação 😊\n\n`;
    msg    += `💰 *Valor:* ${valorFmt}\n`;
    msg    += `📋 *Descrição:* ${desc}\n\n`;
    msg    += `💳 *Pague via PIX, Cartão de Crédito, Boleto ou Mercado Pago:*\n`;
    msg    += `${cobranca.initPoint || cobranca.ticketUrl}\n\n`;
    msg    += `Após a confirmação do pagamento, iniciamos o projeto imediatamente! 🚀`;

    await enviarMensagem(`${negocio.phone}@s.whatsapp.net`, msg, 3000);
    emitirLog('sucesso', `💰 Cobrança enviada para ${negocio.nome} — ${valorFmt}`, {});
    res.json({ ok: true, pix: cobranca });
  } catch(err) {
    emitirLog('erro', `Erro ao gerar cobrança: ${err.message}`, {});
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/negocios/:id/verificar-pagamento', async (req, res) => {
  try {
    const negocio = listarNegocios().find(n => n.id === req.params.id);
    if (!negocio?.pagamento?.id) return res.status(400).json({ erro: 'Nenhuma cobrança gerada.' });
    const status = await consultarPagamento(negocio.pagamento.id);
    if (status.pago) {
      atualizarNegocio(negocio.id, { status: 'pago' });
      const cliente = adicionarCliente({ negocio, pagamento: { ...negocio.pagamento, ...status }, tipoSite: '', observacoes: '' });
      emitirLog('sucesso', `✅ Pago! ${negocio.nome} → Clientes`, {});
      res.json({ ok: true, pago: true, cliente });
    } else {
      res.json({ ok: true, pago: false, status: status.status });
    }
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// =============================================
// ROTAS — Clientes
// =============================================
app.get('/api/clientes',        (req, res) => res.json(listarClientes()));
app.put('/api/clientes/:id',    (req, res) => res.json(atualizarCliente(req.params.id, req.body)));
app.delete('/api/clientes/:id', (req, res) => { removerCliente(req.params.id); res.json({ ok: true }); });

// =============================================
// ROTAS — Mensagens
// =============================================
app.get('/api/mensagens', (req, res) => {
  const p = './data/mensagens.json';
  try { res.json(fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : { grupos: [], config: {} }); } catch { res.json({}); }
});
app.post('/api/mensagens', (req, res) => {
  try { fs.writeFileSync('./data/mensagens.json', JSON.stringify(req.body, null, 2)); res.json({ ok: true }); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

// =============================================
// ROTAS — Relatórios
// =============================================
app.get('/api/relatorios', (req, res) => {
  try {
    if (!fs.existsSync(config.paths.relatorio)) return res.json([]);
    const raw = JSON.parse(fs.readFileSync(config.paths.relatorio, 'utf-8'));
    res.json(Array.isArray(raw) ? raw.slice(-20).reverse() : [raw]);
  } catch { res.json([]); }
});

// =============================================
// ROTAS — Config .env (leitura e escrita)
// =============================================
app.get('/api/config/env', (req, res) => {
  const mask = (v) => v ? `••••${v.slice(-6)}` : '';
  res.json({
    EVOLUTION_API_URL:       process.env.EVOLUTION_API_URL  || '',
    EVOLUTION_INSTANCE:      process.env.EVOLUTION_INSTANCE || '',
    EVOLUTION_API_KEY_REAL:  process.env.EVOLUTION_API_KEY  || '',
    EVOLUTION_API_KEY:       mask(process.env.EVOLUTION_API_KEY),
    GEMINI_API_KEY_1_REAL:   process.env.GEMINI_API_KEY_1   || '',
    GEMINI_API_KEY_1:        mask(process.env.GEMINI_API_KEY_1),
    GEMINI_API_KEY_2:        mask(process.env.GEMINI_API_KEY_2),
    GEMINI_API_KEY_3:        mask(process.env.GEMINI_API_KEY_3),
    GEMINI_API_KEY_4:        mask(process.env.GEMINI_API_KEY_4),
    GEMINI_API_KEY_5:        mask(process.env.GEMINI_API_KEY_5),
    GEMINI_API_KEY_2_REAL:   process.env.GEMINI_API_KEY_2   || '',
    GEMINI_API_KEY_3_REAL:   process.env.GEMINI_API_KEY_3   || '',
    GEMINI_API_KEY_4_REAL:   process.env.GEMINI_API_KEY_4   || '',
    GEMINI_API_KEY_5_REAL:   process.env.GEMINI_API_KEY_5   || '',
    MERCADO_PAGO_REAL:       process.env.MERCADO_PAGO_ACCESS_TOKEN || '',
    MERCADO_PAGO:            mask(process.env.MERCADO_PAGO_ACCESS_TOKEN),
    DELAY_MIN:               process.env.DELAY_MIN    || '45',
    DELAY_MAX:               process.env.DELAY_MAX    || '90',
    LIMITE_ENVIOS:           process.env.LIMITE_ENVIOS || '50',
    WEBHOOK_PORT:            process.env.WEBHOOK_PORT  || '3001',
    PORT:                    process.env.PORT           || '3000',
    WEBHOOK_URL:             process.env.WEBHOOK_URL    || '',
    totalChavesGemini:       config.geminiKeys.length,
  });
});

app.post('/api/config/env', (req, res) => {
  try {
    let conteudo = fs.existsSync('./.env') ? fs.readFileSync('./.env', 'utf-8') : '';

    function set(chave, valor) {
      if (!valor || valor.includes('••')) return; // ignora mascarados
      valor = valor.replace(/[\r\n]/g, '').trim();
      const re = new RegExp(`^${chave}=.*$`, 'm');
      conteudo = re.test(conteudo) ? conteudo.replace(re, `${chave}=${valor}`) : conteudo + `\n${chave}=${valor}`;
    }

    const b = req.body;
    set('EVOLUTION_API_URL',          b.EVOLUTION_API_URL);
    set('EVOLUTION_INSTANCE',         b.EVOLUTION_INSTANCE);
    set('EVOLUTION_API_KEY',          b.EVOLUTION_API_KEY);
    set('GEMINI_API_KEY_1',           b.GEMINI_API_KEY_1);
    set('GEMINI_API_KEY_2',           b.GEMINI_API_KEY_2);
    set('GEMINI_API_KEY_3',           b.GEMINI_API_KEY_3);
    set('GEMINI_API_KEY_4',           b.GEMINI_API_KEY_4);
    set('GEMINI_API_KEY_5',           b.GEMINI_API_KEY_5);
    set('MERCADO_PAGO_ACCESS_TOKEN',  b.MERCADO_PAGO);
    set('DELAY_MIN',                  b.DELAY_MIN);
    set('DELAY_MAX',                  b.DELAY_MAX);
    set('LIMITE_ENVIOS',              b.LIMITE_ENVIOS);
    set('WEBHOOK_PORT',               b.WEBHOOK_PORT);
    set('WEBHOOK_URL',                b.WEBHOOK_URL);

    fs.writeFileSync('./.env', conteudo);

    // Atualiza em memória imediatamente
    if (b.EVOLUTION_API_URL)         config.evolutionApiUrl = b.EVOLUTION_API_URL;
    if (b.EVOLUTION_INSTANCE)        config.instanceName    = b.EVOLUTION_INSTANCE;
    if (b.EVOLUTION_API_KEY && !b.EVOLUTION_API_KEY.includes('••')) config.apiKey = b.EVOLUTION_API_KEY;
    if (b.DELAY_MIN)    config.delayMin     = parseInt(b.DELAY_MIN);
    if (b.DELAY_MAX)    config.delayMax     = parseInt(b.DELAY_MAX);
    if (b.LIMITE_ENVIOS)config.limiteEnvios = parseInt(b.LIMITE_ENVIOS);

    emitirLog('sucesso', '⚙️ Configurações salvas no .env', {});
    res.json({ ok: true, msg: 'Salvo! Reinicie para aplicar mudanças de porta.' });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/leads/reset', (req, res) => {
  try {
    if (fs.existsSync('./data/enviados.json')) fs.writeFileSync('./data/enviados.json', '{}');
    if (fs.existsSync('./data/leads_panel.json')) {
      const leads = JSON.parse(fs.readFileSync('./data/leads_panel.json', 'utf-8'));
      leads.forEach(l => l.status = 'pendente');
      fs.writeFileSync('./data/leads_panel.json', JSON.stringify(leads, null, 2));
    }
    emitirLog('sucesso', '🔄 Leads resetados', {});
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// =============================================
// ROTAS — Scraper Google Maps
// =============================================

// Sessões ativas de scraping (SSE por sessão)
const scraperSessoes = new Map();

// Inicia scraper (SSE — progresso em tempo real)
app.get('/api/scraper/buscar', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const params = {
    query:    req.query.query    || '',
    cidade:   req.query.cidade   || '',
    estado:   req.query.estado   || '',
    pais:     req.query.pais     || 'BR',
    paisNome: req.query.paisNome || 'Brasil',
    limite:   Math.min(parseInt(req.query.limite || '20'), 100),
    headless: true,
  };

  if (!params.query) {
    res.write(`data: ${JSON.stringify({ tipo: 'erro', mensagem: 'Informe um termo de busca.' })}\n\n`);
    res.end();
    return;
  }

  const sessionId = `sc_${Date.now()}`;
  scraperSessoes.set(sessionId, true);

  const enviar = (dados) => {
    try { res.write(`data: ${JSON.stringify(dados)}\n\n`); } catch {}
  };

  req.on('close', () => scraperSessoes.delete(sessionId));

  try {
    const leads = await executarScraper(params, enviar);
    emitirLog('sucesso', `Scraper: ${leads.length} empresas em "${params.query}"`, {});
  } catch (err) {
    enviar({ tipo: 'erro', mensagem: err.message });
    emitirLog('erro', `Scraper erro: ${err.message}`, {});
  }

  scraperSessoes.delete(sessionId);
  res.end();
});

// Favoritos
app.get('/api/scraper/favoritos', (req, res) => {
  try { res.json(Object.values(lerFavoritos())); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/scraper/favoritos', (req, res) => {
  try {
    const fav = salvarFavorito(req.body);
    emitirLog('info', `Favoritado: ${fav.title}`, {});
    res.json({ ok: true, favorito: fav });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

app.delete('/api/scraper/favoritos/:id', (req, res) => {
  try { removerFavorito(req.params.id); res.json({ ok: true }); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

// Listas de leads
app.get('/api/scraper/listas', (req, res) => {
  try { res.json(lerListas()); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/scraper/listas', (req, res) => {
  try {
    const lista = criarLista(req.body.nome || 'Nova Lista');
    res.json({ ok: true, lista });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

app.delete('/api/scraper/listas/:id', (req, res) => {
  try { removerLista(req.params.id); res.json({ ok: true }); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/scraper/listas/:id/adicionar', (req, res) => {
  try {
    const lista = adicionarItemLista(req.params.id, req.body);
    res.json({ ok: true, lista });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// Exportar lista como CSV
app.get('/api/scraper/listas/:id/exportar', (req, res) => {
  try {
    const listas = lerListas();
    const lista  = listas.find(l => l.id === req.params.id);
    if (!lista) return res.status(404).json({ erro: 'Lista não encontrada' });

    const header = 'title,phone,address,category,website,rating,reviews\n';
    const rows   = lista.itens.map(i =>
      [i.title, i.phone, i.address, i.category, i.website, i.rating, i.reviews]
        .map(v => `"${(v||'').toString().replace(/"/g,'""')}"`)
        .join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${lista.nome.replace(/[^a-z0-9]/gi,'_')}.csv"`);
    res.send('\uFEFF' + header + rows); // BOM para Excel
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// =============================================
// APIFY REST API — Google Maps Scraper & IA
// =============================================
app.get('/api/apify/config', (req, res) => {
  try { res.json(lerConfigApify()); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/apify/config', (req, res) => {
  try {
    const salva = salvarConfigApify(req.body);
    emitirLog('sucesso', 'Configurações do Apify salvas', {});
    res.json({ ok: true, config: salva });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/apify/actors', async (req, res) => {
  try {
    const token = req.query.token;
    const atores = await listarAtoresApify(token);
    res.json({ ok: true, atores });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

app.post('/api/apify/run', async (req, res) => {
  try {
    const resultado = await iniciarScraperApify(req.body);
    emitirLog('info', `🚀 Robô Apify iniciado — Run ID: ${resultado.runId}`, { runId: resultado.runId });
    res.json({ ok: true, ...resultado });
  } catch(err) {
    emitirLog('erro', `Erro ao iniciar Apify: ${err.message}`, {});
    res.status(500).json({ ok: false, erro: err.message });
  }
});

app.get('/api/apify/run/:runId', async (req, res) => {
  try {
    const status = await consultarRunApify(req.params.runId, req.query.token);
    res.json({ ok: true, ...status });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

app.get('/api/apify/dataset/:datasetId', async (req, res) => {
  try {
    const filtros = {
      filtroSite: req.query.filtroSite,
      filtroNota: req.query.filtroNota,
      filtroAvaliacoes: req.query.filtroAvaliacoes,
      countryCode: req.query.countryCode,
    };
    const leads = await obterItensDatasetApify(req.params.datasetId, req.query.token, filtros);
    salvarLeadsApify(leads);
    emitirLog('sucesso', `✅ Apify: ${leads.length} leads qualificados importados!`, {});
    res.json({ ok: true, count: leads.length, leads });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

app.get('/api/apify/leads', (req, res) => {
  try { res.json({ ok: true, leads: lerLeadsApify() }); }
  catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

app.delete('/api/apify/leads', (req, res) => {
  try {
    limparLeadsApify();
    emitirLog('aviso', 'Leads do Apify zerados', {});
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

app.post('/api/apify/gerar-kit', async (req, res) => {
  try {
    const { lead, hora, lang } = req.body;
    if (!lead) return res.status(400).json({ ok: false, erro: 'Lead não fornecido' });
    const kit = await gerarKitProspeccaoApify(lead, hora, lang);
    res.json({ ok: true, kit });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

app.post('/api/apify/enviar-whatsapp', async (req, res) => {
  try {
    const { telefone, mensagem } = req.body;
    if (!telefone || !mensagem) return res.status(400).json({ ok: false, erro: 'Telefone e mensagem são obrigatórios' });

    const numFormatado = formatarTelefone(telefone);
    if (!numFormatado) return res.status(400).json({ ok: false, erro: 'Número de telefone inválido' });

    const resWA = await enviarMensagem(numFormatado, mensagem);
    emitirLog('sucesso', `📱 Mensagem enviada para ${numFormatado} via WhatsApp`, {});
    res.json({ ok: true, resposta: resWA });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

// -----------------------------------------------
// ROTAS: PASTAS DE LEADS & CHECKPOINT
// -----------------------------------------------
const PASTAS_PATH = './data/pastas_leads.json';

function lerPastasLeads() {
  if (!fs.existsSync(PASTAS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(PASTAS_PATH, 'utf-8')); }
  catch { return []; }
}

function salvarPastasLeads(pastas) {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync(PASTAS_PATH, JSON.stringify(pastas, null, 2));
}

app.get('/api/apify/pastas', (req, res) => {
  try {
    const pastas = lerPastasLeads();
    // Retorna resumo de cada pasta sem enviar todo o array pesado de leads para performance
    const resumos = pastas.map(p => ({
      id: p.id,
      nome: p.nome,
      nichoInfo: p.nichoInfo,
      localizacao: p.localizacao,
      criadoEm: p.criadoEm,
      totalLeads: (p.leads || []).length,
      enviadosCount: (p.leads || []).filter(l => l.statusEnvio === 'enviado').length,
      ultimoCheckpointId: p.ultimoCheckpointId || null,
      ultimoCheckpointNome: p.ultimoCheckpointNome || null,
      ultimoCheckpointData: p.ultimoCheckpointData || null,
    }));
    res.json({ ok: true, pastas: resumos });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

app.post('/api/apify/pastas', (req, res) => {
  try {
    const { nome, nichoInfo, localizacao, leads } = req.body;
    if (!nome || !Array.isArray(leads)) {
      return res.status(400).json({ ok: false, erro: 'Nome da pasta e lista de leads são obrigatórios' });
    }

    const pastas = lerPastasLeads();
    const novaPasta = {
      id: `pasta_${Date.now()}`,
      nome: nome.trim(),
      nichoInfo: nichoInfo || 'Sem informações',
      localizacao: localizacao || 'Brasil',
      criadoEm: new Date().toISOString(),
      ultimoCheckpointId: null,
      ultimoCheckpointNome: null,
      ultimoCheckpointData: null,
      leads: leads.map(l => ({
        ...l,
        statusEnvio: l.statusEnvio || 'pendente',
        enviadoEm: l.enviadoEm || null,
      })),
    };

    pastas.unshift(novaPasta);
    salvarPastasLeads(pastas);
    emitirLog('sucesso', `📁 Pasta "${novaPasta.nome}" criada com ${leads.length} leads!`, {});
    res.json({ ok: true, pasta: novaPasta });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

app.get('/api/apify/pastas/:id', (req, res) => {
  try {
    const pastas = lerPastasLeads();
    const pasta = pastas.find(p => p.id === req.params.id);
    if (!pasta) return res.status(404).json({ ok: false, erro: 'Pasta não encontrada' });
    res.json({ ok: true, pasta });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

app.delete('/api/apify/pastas/:id', (req, res) => {
  try {
    let pastas = lerPastasLeads();
    const filtradas = pastas.filter(p => p.id !== req.params.id);
    salvarPastasLeads(filtradas);
    emitirLog('aviso', `📁 Pasta ${req.params.id} removida`, {});
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

app.post('/api/apify/pastas/:id/envio', (req, res) => {
  try {
    const { leadId } = req.body;
    const pastas = lerPastasLeads();
    const pasta = pastas.find(p => p.id === req.params.id);
    if (!pasta) return res.status(404).json({ ok: false, erro: 'Pasta não encontrada' });

    const lead = (pasta.leads || []).find(l => l.id === leadId);
    if (!lead) return res.status(404).json({ ok: false, erro: 'Lead não encontrado na pasta' });

    lead.statusEnvio = 'enviado';
    lead.enviadoEm = new Date().toISOString();

    pasta.ultimoCheckpointId = lead.id;
    pasta.ultimoCheckpointNome = lead.title;
    pasta.ultimoCheckpointData = lead.enviadoEm;

    salvarPastasLeads(pastas);
    res.json({ ok: true, pasta, lead });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

app.post('/api/apify/pastas/:id/checkpoint', (req, res) => {
  try {
    const { leadId } = req.body;
    const pastas = lerPastasLeads();
    const pasta = pastas.find(p => p.id === req.params.id);
    if (!pasta) return res.status(404).json({ ok: false, erro: 'Pasta não encontrada' });

    const lead = (pasta.leads || []).find(l => l.id === leadId);
    if (!lead) return res.status(404).json({ ok: false, erro: 'Lead não encontrado na pasta' });

    pasta.ultimoCheckpointId = lead.id;
    pasta.ultimoCheckpointNome = lead.title;
    pasta.ultimoCheckpointData = new Date().toISOString();

    salvarPastasLeads(pastas);
    res.json({ ok: true, pasta, lead });
  } catch(err) { res.status(500).json({ ok: false, erro: err.message }); }
});

// =============================================
// Utilitários
// =============================================
function formatarTelefone(raw) {
  if (!raw) return null;
  let num = raw.replace(/\D/g, '');
  if (num.startsWith('55') && num.length > 12) num = num.slice(2);
  if (num.length < 10 || num.length > 11) return null;
  return `55${num}`;
}

// =============================================
// Inicia servidor
// =============================================
validarConfig();
const PORT = config.panelPort;
app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(55));
  console.log('  🚀 WHATSAPP PROSPECTOR — Painel Web');
  console.log('═'.repeat(55));
  console.log(`  🌐 Painel    : http://localhost:${PORT}`);
  console.log(`  📡 Webhook   : ${config.webhookUrl}`);
  console.log(`  🔑 Gemini    : ${config.geminiKeys.length} chave(s) configurada(s)`);
  console.log('═'.repeat(55) + '\n');
});
