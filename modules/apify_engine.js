// =============================================
// modules/apify_engine.js
// Integração com a API v2 da Apify (Google Maps Scraper)
// =============================================
import axios from 'axios';
import fs from 'fs';
import { config } from '../config.js';

const CONFIG_PATH = './data/apify_config.json';
const LEADS_PATH  = './data/apify_leads.json';

export function sanitizarTokenApify(rawToken) {
  if (!rawToken) return '';
  let str = String(rawToken).trim();
  // Se o usuário colou uma URL inteira da Apify (ex: https://api.apify.com/v2/key-value-stores?token=apify_api_...)
  if (str.includes('token=')) {
    const match = str.match(/token=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) return match[1];
  }
  // Se colou algo que contenha apify_api_
  const matchApi = str.match(/(apify_api_[a-zA-Z0-9]+)/);
  if (matchApi && matchApi[1]) return matchApi[1];
  return str;
}

// Configuração local do Apify (Token, Ator padrão)
export function lerConfigApify() {
  const padrao = {
    token: config.apifyToken || '',
    actorId: 'compass~crawler-google-places',
  };
  if (!fs.existsSync(CONFIG_PATH)) return padrao;
  try {
    const json = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const tokenFinal = (json.token && json.token.trim()) ? sanitizarTokenApify(json.token) : padrao.token;
    return { ...padrao, ...json, token: tokenFinal };
  } catch {
    return padrao;
  }
}

export function salvarConfigApify(dados) {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  const atual = lerConfigApify();
  if (dados.token) dados.token = sanitizarTokenApify(dados.token);
  const nova  = { ...atual, ...dados };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(nova, null, 2));
  return nova;
}

// -----------------------------------------------
// Lista todos os atores da conta do usuário
// GET https://api.apify.com/v2/actors?token=...
// -----------------------------------------------
export async function listarAtoresApify(tokenParam) {
  const token = tokenParam || lerConfigApify().token;
  if (!token) throw new Error('Token da API Apify não foi configurado.');

  const url = `https://api.apify.com/v2/actors?token=${token}`;
  const response = await axios.get(url, { timeout: 15000 });
  return response.data?.data?.items || [];
}

// -----------------------------------------------
// Inicia execução do ator Google Maps no Apify
// POST https://api.apify.com/v2/acts/{actorId}/runs?token=...
// -----------------------------------------------
export async function iniciarScraperApify({ searchTerms, location, maxItems = 20, actorIdParam, tokenParam, countryCode = 'br', language = 'pt-BR' }) {
  const cfg = lerConfigApify();
  const token = tokenParam || cfg.token;
  if (!token) throw new Error('Token da API Apify não foi configurado.');

  const actorId = actorIdParam || cfg.actorId || 'compass~crawler-google-places';
  // Formata actorId para URL (substitui / por ~)
  const formattedActorId = actorId.replace('/', '~');

  const rawTerms = Array.isArray(searchTerms)
    ? searchTerms
    : (searchTerms || '').split(',').map(s => s.trim()).filter(Boolean);

  const termsArray = [];
  rawTerms.forEach(t => {
    if (location && location !== 'Brasil') {
      termsArray.push(`${t} in ${location}`);
    }
    termsArray.push(t);
  });

  const payload = {
    searchStringsArray: termsArray.length ? termsArray : ['services'],
    locationQuery: location || '',
    maxCrawledPlacesPerSearch: parseInt(maxItems) || 50,
    language: language || 'pt-BR',
    countryCode: (countryCode || 'br').toLowerCase(),
  };

  const url = `https://api.apify.com/v2/acts/${formattedActorId}/runs?token=${token}`;
  const response = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  const runData = response.data?.data;
  if (!runData?.id) throw new Error('Não foi possível iniciar o robô no Apify.');

  return {
    runId: runData.id,
    actorId: runData.actId,
    datasetId: runData.defaultDatasetId,
    status: runData.status,
    startedAt: runData.startedAt,
  };
}

// -----------------------------------------------
// Verifica status de uma execução (Run)
// GET https://api.apify.com/v2/actor-runs/{runId}?token=...
// -----------------------------------------------
export async function consultarRunApify(runId, tokenParam) {
  const token = tokenParam || lerConfigApify().token;
  if (!token) throw new Error('Token da API Apify não foi configurado.');

  const url = `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`;
  const response = await axios.get(url, { timeout: 15000 });
  const runData = response.data?.data;

  return {
    runId: runData.id,
    status: runData.status, // READY, RUNNING, SUCCEEDED, FAILED, ABORTED, TIMED-OUT
    datasetId: runData.defaultDatasetId,
    startedAt: runData.startedAt,
    finishedAt: runData.finishedAt,
    stats: runData.stats || {},
  };
}

// -----------------------------------------------
// Busca itens do dataset do Apify
// GET https://api.apify.com/v2/datasets/{datasetId}/items?token=...
// -----------------------------------------------
export async function obterItensDatasetApify(datasetId, tokenParam, filtros = {}) {
  const token = tokenParam || lerConfigApify().token;
  if (!token) throw new Error('Token da API Apify não foi configurado.');

  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&format=json&clean=true`;
  const response = await axios.get(url, { timeout: 30000 });
  let items = Array.isArray(response.data) ? response.data : [];

  // Normaliza dados para o padrão do WhatsApp Prospector
  let normalizados = items.map((item, idx) => {
    let rawPhone = item.phone || item.phoneNumber || item.phoneUnformatted || item.internationalPhoneNumber || '';
    let cleanPhone = rawPhone.replace(/\D/g, '');
    const countryCode = (filtros.countryCode || item.countryCode || '').toLowerCase();
    const addr = (item.address || item.street || item.location?.address || '').toLowerCase();

    // Formatação inteligente de DDI Internacional
    if (cleanPhone) {
      const isUS = countryCode === 'us' || countryCode === 'ca' ||
        /\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i.test(addr) ||
        addr.includes('usa') || addr.includes('united states') || addr.includes('san francisco') || addr.includes('los angeles') || addr.includes('new york') || addr.includes('miami');

      if (isUS) {
        // EUA / Canadá: DDI 1 (número completo de 10 dígitos vira 1 + 10 dígitos)
        if (cleanPhone.length === 10) {
          cleanPhone = '1' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
          // Já está correto
        }
      } else if (countryCode === 'pt' || addr.includes('portugal') || addr.includes('lisboa') || addr.includes('porto')) {
        // Portugal: DDI 351 (9 dígitos)
        if (cleanPhone.length === 9 && !cleanPhone.startsWith('351')) {
          cleanPhone = '351' + cleanPhone;
        }
      } else if (countryCode === 'es' || addr.includes('españa') || addr.includes('spain') || addr.includes('madrid') || addr.includes('barcelona')) {
        // Espanha: DDI 34 (9 dígitos)
        if (cleanPhone.length === 9 && !cleanPhone.startsWith('34')) {
          cleanPhone = '34' + cleanPhone;
        }
      } else if (countryCode === 'mx' || addr.includes('méxico') || addr.includes('mexico')) {
        // México: DDI 52 (10 dígitos)
        if (cleanPhone.length === 10 && !cleanPhone.startsWith('52')) {
          cleanPhone = '52' + cleanPhone;
        }
      } else if (countryCode === 'ar' || addr.includes('argentina') || addr.includes('buenos aires')) {
        // Argentina: DDI 54
        if (cleanPhone.length >= 10 && !cleanPhone.startsWith('54')) {
          cleanPhone = '54' + cleanPhone;
        }
      } else if (countryCode === 'gb' || addr.includes('uk') || addr.includes('united kingdom') || addr.includes('london')) {
        // Reino Unido: DDI 44
        if (cleanPhone.length >= 10 && cleanPhone.startsWith('0')) {
          cleanPhone = '44' + cleanPhone.substring(1);
        } else if (cleanPhone.length === 10 && !cleanPhone.startsWith('44')) {
          cleanPhone = '44' + cleanPhone;
        }
      } else if (countryCode === 'br' || addr.includes('brasil') || addr.includes('brazil') || (!countryCode && (cleanPhone.length === 10 || cleanPhone.length === 11))) {
        // Brasil: DDI 55
        if ((cleanPhone.length === 10 || cleanPhone.length === 11) && !cleanPhone.startsWith('55')) {
          cleanPhone = '55' + cleanPhone;
        }
      }
    }

    return {
      id: `apify_${item.placeId || item.id || idx}_${Date.now()}`,
      title: item.title || item.name || 'Empresa sem nome',
      phone: rawPhone,
      cleanPhone: cleanPhone,
      category: item.categoryName || item.categories?.[0] || item.subTitle || item.type || 'Não informada',
      address: item.address || item.street || item.location?.address || 'Endereço não disponível',
      city: item.city || '',
      state: item.state || '',
      website: item.website || item.domain || '',
      url: item.url || item.googleMapsUrl || (item.placeId ? `https://www.google.com/maps/place/?q=place_id:${item.placeId}` : ''),
      rating: parseFloat(item.totalScore || item.rating || item.stars || 0),
      reviewsCount: parseInt(item.reviewsCount || item.userRatingsTotal || 0),
      placeId: item.placeId || '',
      openingHours: item.openingHours || item.openingHoursRaw || item.popularTimes || null,
      imageUrl: item.imageUrl || item.photosSample?.[0]?.url || item.image || '',
      scrapedAt: new Date().toISOString(),
      fonte: 'Apify Google Maps',
    };
  });

  // Filtro de Website (sem_site / com_site)
  if (filtros.filtroSite === 'sem_site') {
    normalizados = normalizados.filter(l => !l.website || l.website.trim() === '');
  } else if (filtros.filtroSite === 'com_site') {
    normalizados = normalizados.filter(l => l.website && l.website.trim() !== '');
  }

  // Filtro de Nota Mínima
  const minNota = parseFloat(filtros.filtroNota || 0);
  if (minNota > 0) {
    normalizados = normalizados.filter(l => l.rating >= minNota);
  }

  // Filtro de Mínimo de Avaliações
  const minAval = parseInt(filtros.filtroAvaliacoes || 0);
  if (minAval > 0) {
    normalizados = normalizados.filter(l => l.reviewsCount >= minAval);
  }

  return normalizados;
}


// -----------------------------------------------
// Persistência local de leads do Apify
// -----------------------------------------------
export function lerLeadsApify() {
  if (!fs.existsSync(LEADS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(LEADS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

export function salvarLeadsApify(novosLeads) {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  const atuais = lerLeadsApify();
  // Evita duplicatas por telefone/placeId
  const mapa = new Map();
  atuais.forEach(l => mapa.set(l.cleanPhone || l.placeId || l.id, l));
  novosLeads.forEach(l => mapa.set(l.cleanPhone || l.placeId || l.id, l));

  const resultado = Array.from(mapa.values());
  fs.writeFileSync(LEADS_PATH, JSON.stringify(resultado, null, 2));
  return resultado;
}

export function limparLeadsApify() {
  if (fs.existsSync(LEADS_PATH)) {
    fs.writeFileSync(LEADS_PATH, JSON.stringify([], null, 2));
  }
  return [];
}
