// =============================================
// listener.js — Webhook contínuo de respostas
// Corrigido: @lid fix, rodízio Gemini, handover
// =============================================
import express from 'express';
import fs      from 'fs';
import { config }                 from './config.js';
import { enviarMensagem } from './modules/evolution.js';
import {
  gerarResposta, classificarIntencao,
  gerarRespostaSituacao, analisarConversa, geminiAtivo,
} from './modules/ai_responder.js';
import { gerarApresentacao }      from './modules/messages.js';
import { adicionarNegocio, listarNegocios } from './modules/negocios.js';

// SSE emitter injetado pelo server.js
let _emitirLog = null;
export function setEmitirLog(fn) { _emitirLog = fn; }

function log(tipo, msg, dados = {}) {
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);
  _emitirLog?.(tipo, msg, dados);
}

// -----------------------------------------------
// Helpers de estado
// -----------------------------------------------
function carregarConversas() {
  if (!fs.existsSync(config.paths.conversas)) return {};
  try { return JSON.parse(fs.readFileSync(config.paths.conversas, 'utf-8')); } catch { return {}; }
}
function salvarConversas(c) {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync(config.paths.conversas, JSON.stringify(c, null, 2));
}
function carregarLeads() {
  if (!fs.existsSync('./data/leads_panel.json')) return [];
  try { return JSON.parse(fs.readFileSync('./data/leads_panel.json', 'utf-8')); } catch { return []; }
}
function registrarMensagem(conv, numero, de, texto) {
  if (!conv[numero]) conv[numero] = { historico: [], ultima_atividade: null, status: 'novo' };
  conv[numero].historico.push({ de, texto, timestamp: new Date().toISOString() });
  conv[numero].ultima_atividade = new Date().toISOString();
  return conv;
}

// -----------------------------------------------
// Extrai número limpo — corrige @lid e @s.whatsapp.net
// -----------------------------------------------
function extrairNumero(jid) {
  if (!jid) return '';
  // Remove sufixos @s.whatsapp.net, @lid, @c.us, @g.us
  let num = jid.replace(/@.*$/, '').replace(/[^\d]/g, '');
  return num;
}

// -----------------------------------------------
// Monta JID correto para envio (sempre @s.whatsapp.net)
// -----------------------------------------------
function montarJid(numero) {
  const num = numero.replace(/[^\d]/g, '');
  return `${num}@s.whatsapp.net`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const recentes = new Set();

// -----------------------------------------------
// Processa uma mensagem recebida
// -----------------------------------------------
async function processarMensagem(numero, texto, jidOriginal, conv, leads) {
  // jidOriginal = destino exato para envio (pode ser @lid, @s.whatsapp.net etc.)
  const destino = jidOriginal || montarJid(numero);
  log('info', `📩 Mensagem de ${numero}: "${texto.substring(0, 80)}"`, { numero, texto });

  if (!conv[numero]) conv[numero] = { historico: [], ultima_atividade: null, status: 'novo' };

  // ── Número pausado: registra e notifica ──────────────────────────────
  if (conv[numero].status === 'aguardando_humano') {
    conv = registrarMensagem(conv, numero, 'cliente', texto);
    salvarConversas(conv);
    const lead2 = leads.find(l => l.phone === numero) || { title: numero };
    log('aviso', `⏸️  ${lead2.title} aguarda atendimento — nova msg registrada`, { numero });
    _emitirLog?.('negocio_novo', `🔔 ${lead2.title} mandou nova mensagem e aguarda você!`, {
      nome: lead2.title, phone: numero, tipo: 'lembrete',
    });
    return;
  }

  conv = registrarMensagem(conv, numero, 'cliente', texto);
  const lead = leads.find(l => l.phone === numero) || { title: 'Empresa', category: '', phone: numero };

  // ── Gemini inativo ────────────────────────────────────────────────────
  if (!geminiAtivo()) {
    log('aviso', `🤖 Gemini inativo — sem resposta para ${numero}`, { numero });
    salvarConversas(conv); return;
  }

  // ── Classifica intenção ───────────────────────────────────────────────
  const intencao = await classificarIntencao(texto);
  log('info', `🎯 Intenção: ${intencao}`, { numero, intencao });

  // Descarta apenas primeira mensagem totalmente fora de contexto
  if (intencao === 'FORA_CONTEXTO' && conv[numero].historico.length <= 1) {
    salvarConversas(conv); return;
  }

  // ── Respostas fixas (negativo, agressivo) ────────────────────────────
  const respostaFixa = await gerarRespostaSituacao(intencao, lead.title);
  if (respostaFixa) {
    if (['INTERESSE_NEGATIVO', 'MENSAGEM_AGRESSIVA'].includes(intencao)) conv[numero].status = 'encerrado';
    await sleep(2000 + Math.random() * 2000);
    await enviarMensagem(destino, respostaFixa, 2000);
    conv = registrarMensagem(conv, numero, 'bot', respostaFixa);
    salvarConversas(conv);
    return;
  }

  // ── Gera resposta com IA ─────────────────────────────────────────────
  let resposta = await gerarResposta(lead, conv[numero].historico);

  if (!resposta) {
    resposta = 'Oi! Recebi sua mensagem. Como posso ajudar? 😊';
    log('aviso', `Gemini sem resposta — usando fallback`, { numero });
  }

  // ── Detecta handover ─────────────────────────────────────────────────
  const querFechar    = ['FECHAR_NEGOCIO', 'PERGUNTA_PRECO'].includes(intencao) || resposta.includes('[FECHAR_NEGOCIO]');
  const respostaLimpa = resposta.replace('[FECHAR_NEGOCIO]', '').trim();

  // ── Envia resposta ────────────────────────────────────────────────────
  const tempoLeitura = 1500 + Math.random() * 2000;
  const tempoDigitar = Math.min(1000 + (respostaLimpa.length / 5) * 100, 8000);
  await sleep(tempoLeitura + tempoDigitar);

  try {
    await enviarMensagem(destino, respostaLimpa, tempoDigitar);
    conv = registrarMensagem(conv, numero, 'bot', respostaLimpa);
    log('sucesso', `📤 Respondido para ${numero}`, { numero });
  } catch(err) {
    log('erro', `❌ Erro ao enviar para ${numero}: ${err.message}`, { numero });
  }

  // ── Handover: pausa e notifica ────────────────────────────────────────
  if (querFechar) {
    conv[numero].status     = 'aguardando_humano';
    conv[numero].handover_em = new Date().toISOString();

    const jaExiste = listarNegocios().find(n => n.phone === numero);
    if (!jaExiste) {
      adicionarNegocio({
        nome:      lead.title,
        phone:     numero,
        categoria: lead.category,
        resumo:    '⚡ Cliente quente! Aguardando orçamento.',
        historico: conv[numero].historico,
      });
    }

    const alerta = `🔥 ${lead.title || numero} quer fechar! Assuma o atendimento agora.`;
    log('sucesso', alerta, { numero });
    _emitirLog?.('negocio_novo', alerta, {
      nome: lead.title, phone: numero, tipo: 'handover', urgente: true,
    });
  }

  // ── Análise periódica ─────────────────────────────────────────────────
  if (!querFechar && conv[numero].historico.length % 4 === 0) {
    const analise = await analisarConversa(conv[numero].historico, lead);
    conv[numero].analise = analise;
    if (['fechar_venda'].includes(analise.proxima_acao) || analise.status === 'quer_fechar') {
      const jaExiste = listarNegocios().find(n => n.phone === numero);
      if (!jaExiste) {
        adicionarNegocio({ nome: lead.title, phone: numero, categoria: lead.category, resumo: analise.resumo, historico: conv[numero].historico });
        _emitirLog?.('negocio_novo', `🔥 ${lead.title} detectado como lead quente!`, { nome: lead.title, phone: numero });
        conv[numero].status = 'aguardando_humano';
      }
    }
  }

  salvarConversas(conv);
}

// -----------------------------------------------
// App Express do listener
// -----------------------------------------------
export function criarListenerApp() {
  const app = express();
  app.use(express.json());

  // ── Webhook principal ───────────────────────────────────────────────
  app.post('/webhook', async (req, res) => {
    res.status(200).json({ ok: true });
    try {
      const body  = req.body;
      const event = body.event || body.type || '';

      // Log resumido do evento
      log('info', `📨 Evento: ${event} | keys: ${Object.keys(body).join(',')} | data_keys: ${Object.keys(body.data || {}).join(',')}`, {});

      // Aceita qualquer evento que contenha "message" ou "upsert"
      const eMensagem = !event || event.toLowerCase().includes('message') || event.toLowerCase().includes('upsert');
      if (!eMensagem) {
        log('info', `⏭️  Evento ignorado: ${event}`, {});
        return;
      }

      const data   = body.data || {};
      const fromMe = data.key?.fromMe ?? data.fromMe ?? false;
      if (fromMe === true) {
        log('info', `⏭️  Ignorando mensagem própria (fromMe=true)`, {});
        return;
      }

      // Número da instância (bot) — nunca usar como destino
      const botNumero = (body.sender || '').replace(/@.*$/, '').replace(/[^\d]/g, '');
      const jidRaw    = data.key?.remoteJid || '';

      log('info', `🔍 JID raw: "${jidRaw}" | bot: "${botNumero}" | fromMe: ${fromMe}`, {});

      if (jidRaw.includes('@g.us') || jidRaw.includes('@broadcast') || jidRaw.includes('@newsletter')) {
        log('info', `⏭️  Ignorando grupo/broadcast`, {}); return;
      }

      let numero = '';
      let destinoEnvio = '';

      if (jidRaw.includes('@lid')) {
        const lidDigitos = jidRaw.replace('@lid', '').replace(/[^\d]/g, '');
        if (lidDigitos === botNumero) {
          log('info', `⏭️  @lid é o próprio bot — ignorando`, {}); return;
        }

        let numeroReal = null;

        // Opção 1: lê o store local se o volume estiver mapeado (D:\evolution-store)
        try {
          const storePath = `D:/evolution-store/chats/${config.instanceName}/${jidRaw}.json`;
          if (fs.existsSync(storePath)) {
            const chat = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
            const phone = chat.phoneNumber || chat.number || chat.jidReal || '';
            if (phone && !phone.includes('@lid')) {
              numeroReal = phone.replace(/[^\d]/g, '');
              log('sucesso', `✅ @lid resolvido via store local: ${numeroReal}`, {});
            }
          }
        } catch { /* store não mapeado */ }

        // Opção 2: chama API da Evolution para buscar mensagens enviadas
        if (!numeroReal) {
          try {
            const { default: axios } = await import('axios');
            const r = await axios.post(
              `${config.evolutionApiUrl}/chat/findMessages/${config.instanceName}`,
              { where: { key: { remoteJid: jidRaw, fromMe: true } }, limit: 5 },
              { headers: { apikey: config.apiKey }, timeout: 5000 }
            );
            const msgs = r.data?.messages?.records || r.data?.records || [];
            for (const m of (Array.isArray(msgs) ? msgs : [])) {
              const jid2 = m?.key?.remoteJid || '';
              if (jid2.includes('@s.whatsapp.net')) {
                numeroReal = jid2.replace(/@.*$/, '').replace(/[^\d]/g, '');
                log('sucesso', `✅ @lid resolvido via mensagens enviadas: ${numeroReal}`, {});
                break;
              }
            }
          } catch { /* silencioso */ }
        }

        numero       = numeroReal || lidDigitos;
        destinoEnvio = numeroReal ? `${numeroReal}@s.whatsapp.net` : jidRaw;
        log('info', `📨 Destino: ${destinoEnvio}`, {});

      } else {
        numero       = jidRaw.replace(/@.*$/, '').replace(/[^\d]/g, '');
        destinoEnvio = jidRaw.includes('@') ? jidRaw : `${numero}@s.whatsapp.net`;
      }
      if (!numero || numero.length < 8 || numero === botNumero) {
        log('info', `⏭️  Número inválido ou é o próprio bot: "${numero}"`, {}); return;
      }

      // Extrai texto — Evolution API v1.8 coloca em data.message
      const msgObj = data.message || {};
      const texto  = msgObj.conversation
        || msgObj.extendedTextMessage?.text
        || msgObj.imageMessage?.caption
        || msgObj.videoMessage?.caption
        || msgObj.buttonsResponseMessage?.selectedDisplayText
        || msgObj.listResponseMessage?.title
        || data.body
        || data.text
        || body.text
        || '';

      log('info', `📝 Texto extraído: "${texto.substring(0, 80)}" (tipo: ${Object.keys(msgObj).join(',') || 'sem tipo'})`, {});

      if (!texto.trim()) {
        log('info', `⏭️  Sem texto — tipos disponíveis: ${Object.keys(msgObj).join(',')}`, {});
        return;
      }

      // Anti-duplicata
      const chave = `${numero}_${texto.substring(0, 30)}`;
      if (recentes.has(chave)) {
        log('info', `⏭️  Duplicata ignorada: ${chave}`, {});
        return;
      }
      recentes.add(chave);
      setTimeout(() => recentes.delete(chave), 8000);

      log('sucesso', `✅ Processando mensagem de ${numero}: "${texto.substring(0, 60)}"`, {});

      const conv  = carregarConversas();
      const leads = carregarLeads();
      processarMensagem(numero, texto, destinoEnvio, conv, leads).catch(err =>
        log('erro', `Erro ao processar: ${err.message}`, {}));

    } catch(err) {
      log('erro', `Erro no webhook: ${err.message}\n${err.stack}`, {});
    }
  });

  // ── Health check ────────────────────────────────────────────────────
  app.get('/health', (req, res) => res.json({
    status:  'online',
    gemini:  geminiAtivo(),
    chaves:  config.geminiKeys.length,
    ts:      new Date().toISOString(),
  }));

  // ── Teste manual (sem precisar do WhatsApp) ─────────────────────────
  app.post('/webhook/teste', async (req, res) => {
    const { numero, texto } = req.body;
    if (!numero || !texto) return res.status(400).json({ erro: 'numero e texto obrigatórios' });
    res.json({ ok: true, msg: 'Processando...' });
    const conv  = carregarConversas();
    const leads = carregarLeads();
    processarMensagem(numero, texto, `${numero}@s.whatsapp.net`, conv, leads).catch(err =>
      log('erro', `Erro no teste: ${err.message}`, {}));
  });

  return app;
}
