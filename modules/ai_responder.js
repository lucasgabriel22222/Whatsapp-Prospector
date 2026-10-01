// =============================================
// modules/ai_responder.js
// Rodízio automático de até 5 chaves Gemini
// Modelos: gemini-1.5-flash, gemini-1.5-flash-8b, gemini-1.5-pro
// =============================================
import axios from 'axios';
import { config } from '../config.js';
import { lerConfigGemini } from './gemini_config.js';

// Modelos em ordem de prioridade — do mais estável ao mais novo
// gemini-3.7-flash foi o único que respondeu OK nos testes
// Os outros são fallback caso 3.7 esteja com 429/503
const MODELOS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Índice da chave atual (rodízio)
let chaveIdx = 0;

function logLocal(msg) {
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);
}

// -----------------------------------------------
// Tenta gerar conteúdo com rodízio de chaves e modelos
// -----------------------------------------------
async function gerarComFallback(prompt) {
  const chaves = config.geminiKeys;
  if (!chaves.length) { logLocal('❌ Nenhuma chave Gemini configurada'); return null; }

  // Estratégia: tenta cada modelo com a chave atual primeiro
  // Se 429, avança para próxima chave no mesmo modelo
  // Se 404, avança para próximo modelo (modelo não existe nessa key)
  for (const modelo of MODELOS) {
    for (let i = 0; i < chaves.length; i++) {
      const idx   = (chaveIdx + i) % chaves.length;
      const chave = chaves[idx];
      const url   = `${BASE}/${modelo}:generateContent?key=${chave}`;
      try {
        const res = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
        }, { timeout: 30000 });

        const texto = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (texto) {
          logLocal(`✅ Gemini [chave ${idx + 1}][${modelo}] OK`);
          chaveIdx = idx; // mantém na chave que funcionou
          return texto;
        }
      } catch (err) {
        const status = err.response?.status;
        const msg    = err.response?.data?.error?.message || err.message;
        logLocal(`⚠️  Gemini [chave ${idx + 1}][${modelo}] ${status || 'ERR'}: ${msg?.substring(0, 80)}`);

        if (status === 404) break; // modelo não existe → tenta próximo modelo
        // 429, 503, timeout → tenta próxima chave no mesmo modelo
      }
    }
  }

  logLocal('❌ Todas as chaves/modelos Gemini falharam');
  return null;
}

// -----------------------------------------------
// Verifica se Gemini está ativo
// -----------------------------------------------
export function geminiAtivo() {
  return lerConfigGemini().ativo === true && config.geminiKeys.length > 0;
}

// -----------------------------------------------
// Classifica intenção
// -----------------------------------------------
export async function classificarIntencao(mensagem) {
  if (!geminiAtivo()) return 'RESPOSTA_GENERICA';

  const prompt = `Classifique esta mensagem em UMA categoria:
INTERESSE_POSITIVO - interesse ou curiosidade sobre o serviço
INTERESSE_NEGATIVO - não quer, pediu para parar
PERGUNTA_PRECO - perguntou sobre preço, valor, orçamento, quanto custa
PERGUNTA_SERVICO - quer saber mais sobre o serviço
FECHAR_NEGOCIO - quer contratar, fechar, pagar, gostou e quer avançar
RESPOSTA_GENERICA - ok, sim, não, oi, olá, vago
FORA_CONTEXTO - não relacionado ao serviço
MENSAGEM_AGRESSIVA - ofensas

Mensagem: "${mensagem}"
Responda APENAS com a categoria.`;

  const r = await gerarComFallback(prompt);
  return r ? r.toUpperCase().replace(/[^A-Z_]/g, '').trim() : 'RESPOSTA_GENERICA';
}

// -----------------------------------------------
// Gera resposta contextual
// -----------------------------------------------
export async function gerarResposta(dadosLead, historicoConversa) {
  if (!geminiAtivo()) return null;

  const cfg = lerConfigGemini();
  const contexto = `Lead: ${dadosLead.title || 'Empresa'} | Segmento: ${dadosLead.category || 'desconhecido'}`;
  const historico = (historicoConversa || [])
    .slice(-10)
    .map(m => `${m.de === 'bot' ? 'Rafael' : 'Cliente'}: ${m.texto}`)
    .join('\n');

  const prompt = `${cfg.prompt}

LEAD: ${contexto}
CONVERSA:
${historico}

Escreva a próxima resposta do Rafael. Se o cliente quiser contratar/fechar/saber preço, adicione [FECHAR_NEGOCIO] no final.
Responda APENAS com o texto da mensagem.`;

  return await gerarComFallback(prompt);
}

// -----------------------------------------------
// Respostas fixas para situações específicas
// -----------------------------------------------
export async function gerarRespostaSituacao(situacao, nomeEmpresa) {
  const fixas = {
    INTERESSE_NEGATIVO: `Tudo bem! Se mudar de ideia, é só chamar. Sucesso pra ${nomeEmpresa}! 🙌`,
    MENSAGEM_AGRESSIVA: `Entendo. Desculpe o incômodo. Tenha um bom dia!`,
    FORA_CONTEXTO:      null,
  };
  return fixas[situacao] ?? null;
}

// -----------------------------------------------
// Analisa conversa e retorna JSON
// -----------------------------------------------
export async function analisarConversa(historicoConversa, dadosLead) {
  if (!geminiAtivo()) {
    return { status: 'sem_resposta', temperatura: 'frio', proxima_acao: 'aguardar_resposta', resumo: 'Gemini inativo', nota: 0 };
  }

  const historico = (historicoConversa || [])
    .map(m => `${m.de === 'bot' ? 'Bot' : 'Cliente'}: ${m.texto}`)
    .join('\n');

  const prompt = `Analise esta conversa e retorne JSON:
{"status":"interessado|nao_interessado|em_negociacao|sem_resposta|quer_fechar","temperatura":"quente|morno|frio","proxima_acao":"aguardar_resposta|enviar_followup|marcar_demo|encerrar|fechar_venda","resumo":"uma frase","nota":5}

Lead: ${dadosLead.title} | ${dadosLead.category || ''}
${historico}

Retorne APENAS o JSON válido.`;

  try {
    const texto = await gerarComFallback(prompt);
    if (!texto) throw new Error('sem resposta');
    return JSON.parse(texto.replace(/```json\n?|\n?```/g, '').trim());
  } catch {
    return { status: 'sem_resposta', temperatura: 'frio', proxima_acao: 'enviar_followup', resumo: 'Erro', nota: 0 };
  }
}

// -----------------------------------------------
// Diagnóstico — testa todas as chaves e modelos
// -----------------------------------------------
export async function testarApiKey() {
  const chaves = config.geminiKeys;
  if (!chaves.length) return { ok: false, erro: 'Nenhuma chave configurada', resultados: {} };

  const resultados = {};
  for (let i = 0; i < chaves.length; i++) {
    const chave = chaves[i];
    resultados[`KEY_${i + 1}`] = {};
    for (const modelo of MODELOS) {
      const url = `${BASE}/${modelo}:generateContent?key=${chave}`;
      try {
        const res = await axios.post(url, {
          contents: [{ parts: [{ text: 'responda apenas: ok' }] }],
        }, { timeout: 15000 });
        const texto = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        resultados[`KEY_${i + 1}`][modelo] = `✅ OK — "${texto}"`;
      } catch(err) {
        const status = err.response?.status;
        const msg    = err.response?.data?.error?.message || err.message;
        resultados[`KEY_${i + 1}`][modelo] = `❌ ${status} ${msg}`.substring(0, 100);
      }
    }
  }

  const algumOk = Object.values(resultados).some(k => Object.values(k).some(v => v.startsWith('✅')));
  return { ok: algumOk, totalChaves: chaves.length, resultados };
}

// -----------------------------------------------
// Gerador de Kit de Prospecção Completo para Lead do Apify
// (Abordagem WhatsApp, Proposta Comercial e Prompt para Criar Site)
// -----------------------------------------------
export async function gerarKitProspeccaoApify(lead, horaAtual, langParam) {
  const nome = lead.title || 'Empresa';
  const categoria = lead.category || 'Serviços';
  const endereco = lead.address || 'Local';
  const notaVal = lead.rating ? lead.rating.toFixed(1) : '5';
  const numAvaliacoes = lead.reviewsCount || 0;

  // Extrai nome da cidade da string do endereço
  let cidade = 'sua região';
  if (lead.address) {
    const partes = lead.address.split(',');
    if (partes.length >= 2) {
      cidade = partes[partes.length - 2].trim();
    } else {
      cidade = lead.address.split('-').pop()?.trim() || 'sua região';
    }
  }

  // Detecta código de idioma (ex: en, es, pt, fr, de, it)
  let rawLang = (langParam || lead.language || lead.countryCode || '').toLowerCase();
  const addr = (lead.address || '').toLowerCase();
  if (!rawLang || rawLang === 'pt' || rawLang === 'br') {
    if (addr.includes('usa') || addr.includes('united states') || addr.includes(' ca ') || addr.includes(' ny ') || addr.includes(' tx ') || addr.includes(' fl ') || addr.includes(', us')) {
      rawLang = 'en';
    }
  }

  let lang = 'pt';
  if (rawLang.startsWith('en') || ['us','gb','ca','au','nz','ie'].includes(rawLang)) lang = 'en';
  else if (rawLang.startsWith('es') || ['es','mx','ar','co','cl','pe','ve','ec','gt','cub','do','bo','hn','py','sv','ni','cr','pa','uy'].includes(rawLang)) lang = 'es';
  else if (rawLang.startsWith('fr') || ['fr','be','ch','ca-qc'].includes(rawLang)) lang = 'fr';
  else if (rawLang.startsWith('de') || ['de','at','ch'].includes(rawLang)) lang = 'de';
  else if (rawLang.startsWith('it') || ['it'].includes(rawLang)) lang = 'it';

  const hora = (horaAtual !== undefined && horaAtual !== null) ? parseInt(horaAtual) : new Date().getHours();

  let saudacao = 'Bom dia';
  let msg1 = '', msg2 = '', msg3 = '', diagnostico = '';

  if (lang === 'en') {
    saudacao = hora >= 12 && hora < 18 ? 'Good afternoon' : (hora >= 18 || hora < 5 ? 'Good evening' : 'Good morning');
    msg1 = `${saudacao}! Am I speaking with the owner of *${nome}*?`;
    msg2 = `I noticed on your Google profile that you don't have an official website yet to serve customers searching for ${categoria.toLowerCase()} in the area.`;
    msg3 = `I build high-converting websites designed to drive leads straight to WhatsApp. If you're open to it, I can create a free preview with *${nome}*'s info and branding for you to check out. What do you think?`;
    diagnostico = `${nome} has a ${notaVal} rating on Google. Multi-language outreach sequence generated in English.`;
  } else if (lang === 'es') {
    saudacao = hora >= 12 && hora < 18 ? 'Buenas tardes' : (hora >= 18 || hora < 5 ? 'Buenas noches' : 'Buenos días');
    msg1 = `¡${saudacao}! ¿Hablo con el responsable de *${nome}*?`;
    msg2 = `Noté aquí en su perfil de Google que aún no tienen una página oficial para atender a los clientes que buscan ${categoria.toLowerCase()} en la zona.`;
    msg3 = `Desarrollo páginas enfocadas en convertir esas búsquedas directamente a WhatsApp. Si le parece bien, puedo crear una muestra con la información e identidad visual de *${nome}* sin ningún costo para que la revise. ¿Qué le parece?`;
    diagnostico = `${nome} tiene una excelente nota ${notaVal} en Google Maps. Secuencia en español lista.`;
  } else if (lang === 'fr') {
    saudacao = hora >= 18 || hora < 5 ? 'Bonsoir' : 'Bonjour';
    msg1 = `${saudacao} ! Est-ce que je m'adresse au responsable de *${nome}* ?`;
    msg2 = `J'ai remarqué sur votre profil Google que vous n'avez pas encore de site officiel pour servir les clients qui recherchent ${categoria.toLowerCase()} dans la région.`;
    msg3 = `Je développe des sites conçus pour convertir ces recherches directement sur WhatsApp. Si vous le souhaitez, je peux créer un aperçu gratuit avec les informations et l'identité visuelle de *${nome}* pour que vous puissiez jeter un œil. Qu'en pensez-vous ?`;
    diagnostico = `${nome} a une note de ${notaVal} sur Google. Séquence en français prête.`;
  } else if (lang === 'de') {
    saudacao = hora >= 12 && hora < 18 ? 'Guten Tag' : (hora >= 18 || hora < 5 ? 'Guten Abend' : 'Guten Morgen');
    msg1 = `${saudacao}! Spreche ich mit dem Verantwortlichen von *${nome}*?`;
    msg2 = `Ich habe auf Ihrem Google-Profil bemerkt, dass Sie noch keine offizielle Website haben, um Kunden zu bedienen, die nach ${categoria.toLowerCase()} in der Region suchen.`;
    msg3 = `Ich erstelle Websites, die darauf ausgelegt sind, diese Anfragen direkt auf WhatsApp zu konvertieren. Wenn Sie möchten, erstelle ich eine kostenlose Vorschau mit den Informationen und der visuellen Identität von *${nome}*. Was halten Sie davon?`;
    diagnostico = `${nome} hat eine Bewertung von ${notaVal} auf Google. Deutsche Sequenz bereit.`;
  } else if (lang === 'it') {
    saudacao = hora >= 18 || hora < 5 ? 'Buonasera' : 'Buongiorno';
    msg1 = `${saudacao}! Parlo con il responsabile di *${nome}*?`;
    msg2 = `Ho notato sul vostro profilo Google che non avete ancora un sito ufficiale per servire i clienti che cercano ${categoria.toLowerCase()} nella zona.`;
    msg3 = `Sviluppo pagine focalizzate nel convertire queste ricerche direttamente su WhatsApp. Se vi fa piacere, posso creare una demo gratuita con le informazioni e l'identità visiva di *${nome}* da farvi visionare. Che ne dice?`;
    diagnostico = `${nome} ha una valutazione di ${notaVal} su Google. Sequenza in italiano pronta.`;
  } else {
    // Português (padrão)
    saudacao = hora >= 12 && hora < 18 ? 'Boa tarde' : (hora >= 18 || hora < 5 ? 'Boa noite' : 'Bom dia');
    msg1 = `${saudacao}! Eu falo com o responsável da *${nome}*?`;
    msg2 = `Notei aqui no perfil de vocês no Google que vocês ainda não tem uma página oficial para atender os clientes que pesquisam por ${categoria.toLowerCase()} na região.`;
    msg3 = `Eu desenvolvo páginas focadas em converter essas buscas direto no WhatsApp. Se você topar, monto uma amostra com as informações e a identidade visual da *${nome}* sem custo nenhum para você dar uma olhada. O que acha?`;
    diagnostico = `${nome} possui nota ${notaVal} no Google Maps. Sequência de prospecção pronta para envio.`;
  }

  const abordagem = `${msg1}\n\n${msg2}\n\n${msg3}`;
  const proposta = `Proposta Comercial / Proposal for ${nome}\n\nObjetivo / Goal:\nCriar uma presença digital profissional para aumentar a confiança dos clientes e facilitar contatos pelo WhatsApp.\n\nEntrega / Deliverables:\n- Landing page responsiva / Responsive landing page\n- Botão de WhatsApp em destaque / Direct WhatsApp CTA\n- Apresentação da empresa & serviços / Services showcase\n- Avaliações & localização / Reviews & Location\n\nPrazo / Timeline: 3-5 dias úteis / business days.`;
  const promptSite = `Crie uma landing page profissional para a empresa ${nome} (${categoria}), localizada em ${cidade}. Tom moderno e responsivo com foco em conversão para WhatsApp.`;

  return {
    lang,
    saudacao,
    msg1,
    msg2,
    msg3,
    abordagem,
    proposta,
    promptSite,
    diagnostico
  };
}

