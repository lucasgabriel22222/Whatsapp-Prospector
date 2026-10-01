// =============================================
// modules/evolution.js — Integração Evolution API
// Funções de envio e consulta via WhatsApp
// =============================================
import axios from 'axios';
import { config } from '../config.js';

// Headers padrão para todas as requisições
const headers = () => ({
  'Content-Type': 'application/json',
  'apikey': config.apiKey,
});

// Cache de resolução @lid → número real (evita chamadas repetidas)
// Cache exportado para uso externo (listener pode consultar)
export const lidCache = new Map();

// -----------------------------------------------
// Resolve @lid para número real via GET /contact/profile
// (endpoint oficial Evolution API para resolver @lid)
// -----------------------------------------------
export async function resolverLid(lid) {
  const lidCompleto = lid.includes('@lid') ? lid : `${lid}@lid`;
  const lidDigitos  = lid.replace('@lid', '').replace(/[^\d]/g, '');

  if (lidCache.has(lidDigitos)) {
    console.log(`[LID] Cache hit: ${lidDigitos} → ${lidCache.get(lidDigitos)}`);
    return lidCache.get(lidDigitos);
  }

  const base = config.evolutionApiUrl;
  const inst = config.instanceName;

  const endpoints = [
    // Opção 1: GET /contact/profile/{instance} — endpoint oficial para resolver @lid
    async () => {
      const res = await axios.get(
        `${base}/contact/profile/${inst}`,
        { headers: headers(), params: { number: lidCompleto }, timeout: 8000 }
      );
      return extrairNumeroDeResposta(res.data);
    },
    // Opção 2: POST /contact/find/{instance}
    async () => {
      const res = await axios.post(
        `${base}/contact/find/${inst}`,
        { number: lidCompleto },
        { headers: headers(), timeout: 8000 }
      );
      return extrairNumeroDeResposta(res.data);
    },
    // Opção 3: POST /chat/findMessages — pega o sender real das mensagens da conversa
    async () => {
      const res = await axios.post(
        `${base}/chat/findMessages/${inst}`,
        { where: { key: { remoteJid: lidCompleto } }, limit: 5 },
        { headers: headers(), timeout: 8000 }
      );
      const msgs = res.data?.messages?.records || res.data?.records || res.data || [];
      for (const m of (Array.isArray(msgs) ? msgs : [])) {
        const jid = m?.key?.remoteJid || m?.pushName || '';
        if (jid && jid.includes('@s.whatsapp.net') && !jid.includes('@lid')) {
          return jid.replace(/@.*$/, '').replace(/[^\d]/g, '');
        }
      }
      return null;
    },
    // Opção 4: GET /chat/findChats — busca a conversa pelo @lid
    async () => {
      const res = await axios.post(
        `${base}/chat/findChats/${inst}`,
        {},
        { headers: headers(), timeout: 8000 }
      );
      const chats = Array.isArray(res.data) ? res.data : [];
      const chat  = chats.find(c => c.id === lidCompleto || c.remoteJid === lidCompleto);
      if (chat) {
        const jid = chat.jid || chat.remoteJid || chat.id || '';
        // Às vezes o chat tem o número real em outro campo
        const num = chat.phoneNumber || chat.phone || chat.number || '';
        if (num && num.length >= 10) return num.replace(/[^\d]/g, '');
      }
      return null;
    },
  ];

  for (let i = 0; i < endpoints.length; i++) {
    try {
      const numero = await endpoints[i]();
      if (numero && numero.length >= 10) {
        lidCache.set(lidDigitos, numero);
        console.log(`[LID] ✅ [opção ${i+1}] ${lidCompleto} → ${numero}`);
        return numero;
      }
    } catch (err) {
      console.warn(`[LID] Opção ${i+1} falhou: ${err.response?.status || ''} ${err.message?.substring(0,60)}`);
    }
  }

  console.warn(`[LID] ⚠️  Todas as opções falharam para ${lidCompleto}`);
  return null;
}

function extrairNumeroDeResposta(data) {
  if (!data) return null;
  const candidatos = [
    data.jid, data.wuid, data.number, data.remoteJid, data.id,
    data.phoneNumber, data.phone,
    Array.isArray(data) ? (data[0]?.jid || data[0]?.number || data[0]?.remoteJid) : null,
  ];
  for (const c of candidatos) {
    if (c && typeof c === 'string' && !c.includes('@lid')) {
      const num = c.replace(/@.*$/, '').replace(/[^\d]/g, '');
      if (num.length >= 10) return num;
    }
  }
  return null;
}

// -----------------------------------------------
// Envia mensagem de texto simples
// Aceita número puro (5543999354089) ou JID (@s.whatsapp.net)
// A Evolution API v1 espera só o número no campo "number"
// -----------------------------------------------
export async function enviarMensagem(numeroOuJid, mensagem, delayDigitacao = 3000) {
  // Evolution v1.8.2: passa o JID exatamente como recebido
  const number = numeroOuJid;

  console.log(`[EVO] Enviando para: ${number}`);

  const url = `${config.evolutionApiUrl}/message/sendText/${config.instanceName}`;
  const payload = {
    number,
    textMessage: { text: mensagem },
    options: { delay: delayDigitacao, presence: 'composing', linkPreview: false },
  };

  try {
    const response = await axios.post(url, payload, { headers: headers(), timeout: 30000 });
    return response.data;
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data;
    console.error(`[EVO] ❌ ${status} para "${number}":`, JSON.stringify(detail));
    throw err;
  }
}

// -----------------------------------------------
// Verifica se instância está conectada
// -----------------------------------------------
export async function verificarConexao() {
  try {
    const url = `${config.evolutionApiUrl}/instance/connectionState/${config.instanceName}`;
    const response = await axios.get(url, { headers: headers(), timeout: 10000 });
    return {
      conectado: response.data?.instance?.state === 'open',
      estado: response.data?.instance?.state || 'desconhecido',
      dados: response.data,
    };
  } catch (err) {
    return {
      conectado: false,
      estado: 'erro',
      erro: err.message,
    };
  }
}

// -----------------------------------------------
// Busca mensagens recebidas de um número
// -----------------------------------------------
export async function buscarMensagens(numero, limite = 20) {
  try {
    const url = `${config.evolutionApiUrl}/chat/findMessages/${config.instanceName}`;
    const payload = {
      where: {
        key: { remoteJid: `${numero}@s.whatsapp.net` },
      },
      limit: limite,
    };
    const response = await axios.post(url, payload, { headers: headers(), timeout: 15000 });
    return response.data || [];
  } catch (err) {
    return [];
  }
}

// -----------------------------------------------
// Verifica se número existe no WhatsApp
// -----------------------------------------------
export async function verificarNumero(numero) {
  try {
    const url = `${config.evolutionApiUrl}/chat/whatsappNumbers/${config.instanceName}`;
    const payload = { numbers: [numero] };
    const response = await axios.post(url, payload, { headers: headers(), timeout: 15000 });
    const resultado = response.data?.[0];
    return {
      existe: resultado?.exists === true,
      jid: resultado?.jid || null,
    };
  } catch (err) {
    // Se der erro na verificação, assume que existe e tenta enviar mesmo assim
    return { existe: true, jid: `${numero}@s.whatsapp.net` };
  }
}

// -----------------------------------------------
// Configura webhook para receber mensagens
// -----------------------------------------------
export async function configurarWebhook(webhookUrl) {
  try {
    const url = `${config.evolutionApiUrl}/webhook/set/${config.instanceName}`;
    const payload = {
      url: webhookUrl,
      webhook_by_events: false,
      webhook_base64: false,
      events: [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'CONNECTION_UPDATE',
      ],
    };
    const response = await axios.post(url, payload, { headers: headers(), timeout: 15000 });
    return { sucesso: true, dados: response.data };
  } catch (err) {
    return { sucesso: false, erro: err.message };
  }
}

// -----------------------------------------------
// Lista todas as instâncias disponíveis
// -----------------------------------------------
export async function listarInstancias() {
  try {
    const url = `${config.evolutionApiUrl}/instance/fetchInstances`;
    const response = await axios.get(url, { headers: headers(), timeout: 10000 });
    return response.data || [];
  } catch (err) {
    return [];
  }
}
