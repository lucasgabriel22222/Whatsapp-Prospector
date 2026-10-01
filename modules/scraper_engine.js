// =============================================
// modules/scraper_engine.js  — v3
// Scraper Google Maps rápido
// Estratégia: axios para busca em lote + Playwright só para detalhes
// =============================================
import axios from 'axios';
import fs    from 'fs';

const PATHS = {
  resultados: './data/scraper_resultados.json',
  favoritos:  './data/scraper_favoritos.json',
  listas:     './data/scraper_listas.json',
};

export function inicializarDados() {
  for (const p of Object.values(PATHS))
    if (!fs.existsSync(p))
      fs.writeFileSync(p, JSON.stringify(p.includes('listas') ? [] : {}, null, 2));
}

// ---- CRUD Favoritos ----
export function lerFavoritos() {
  try { return JSON.parse(fs.readFileSync(PATHS.favoritos, 'utf-8')); } catch { return {}; }
}
export function salvarFavorito(emp) {
  const favs = lerFavoritos();
  const id   = emp.id || `fav_${Date.now()}`;
  favs[id]   = { ...emp, id, favoritadoEm: new Date().toISOString() };
  fs.writeFileSync(PATHS.favoritos, JSON.stringify(favs, null, 2));
  return favs[id];
}
export function removerFavorito(id) {
  const favs = lerFavoritos(); delete favs[id];
  fs.writeFileSync(PATHS.favoritos, JSON.stringify(favs, null, 2));
}

// ---- CRUD Listas ----
export function lerListas() {
  try { return JSON.parse(fs.readFileSync(PATHS.listas, 'utf-8')); } catch { return []; }
}
export function criarLista(nome) {
  const listas = lerListas();
  const lista  = { id: `lista_${Date.now()}`, nome, criadaEm: new Date().toISOString(), itens: [] };
  listas.push(lista);
  fs.writeFileSync(PATHS.listas, JSON.stringify(listas, null, 2));
  return lista;
}
export function adicionarItemLista(listaId, emp) {
  const listas = lerListas();
  const lista  = listas.find(l => l.id === listaId);
  if (!lista) throw new Error('Lista não encontrada');
  if (!lista.itens.some(i => i.phone && i.phone === emp.phone))
    lista.itens.push({ ...emp, adicionadoEm: new Date().toISOString() });
  fs.writeFileSync(PATHS.listas, JSON.stringify(listas, null, 2));
  return lista;
}
export function removerLista(id) {
  fs.writeFileSync(PATHS.listas, JSON.stringify(lerListas().filter(l => l.id !== id), null, 2));
}

// ---- Helpers ----
function gerarId() {
  return `emp_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
}

function ddi(pais) {
  return ({ BR:'55',US:'1',CO:'57',MX:'52',AR:'54',CL:'56',PE:'51',
    UY:'598',PY:'595',BO:'591',EC:'593',VE:'58',PT:'351',ES:'34',
    FR:'33',DE:'49',IT:'39',GB:'44',CA:'1',AU:'61',JP:'81',
    CN:'86',AE:'971',ZA:'27',NG:'234' })[pais] || '';
}

function normalizarTel(raw, pais) {
  if (!raw) return null;
  let n = raw.replace(/\D/g,'');
  if (!n || n.length < 6) return null;
  const d = ddi(pais);
  if (d && !n.startsWith(d)) n = d + n;
  return n;
}

function montarQuery({ query, cidade, estado, pais, paisNome }) {
  return [query, cidade, estado, pais !== 'BR' ? (paisNome || pais) : '']
    .filter(Boolean).join(' ').trim();
}

// =============================================
// MÉTODO PRINCIPAL — Google Maps via Playwright
// Otimizado: sem headless delay, carrega só o feed,
// extrai dados do DOM sem clicar card a card
// =============================================
export async function executarScraper(params, onProgress) {
  const {
    query, cidade = '', estado = '', pais = 'BR', paisNome = 'Brasil',
    limite = 20,
  } = params;

  const lim        = Number(limite);
  const queryFinal = montarQuery({ query, cidade, estado, pais, paisNome });
  const leads      = [];
  const vistos     = new Set();

  const emit = (tipo, msg, extra = {}) =>
    onProgress?.({ tipo, mensagem: msg, total: lim, encontrados: leads.length, ...extra });

  emit('inicio', `Buscando "${queryFinal}" no Google Maps...`);

  const { chromium } = await import('playwright');

  // Tenta usar o browser do sistema primeiro (mais rápido de iniciar)
  let browser;
  try {
    // Tenta conectar ao Chrome do sistema
    browser = await chromium.launch({
      headless: true,
      channel: 'chrome', // usa o Chrome instalado — mais rápido de abrir
      args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
             '--disable-extensions','--no-first-run','--disable-default-apps'],
    });
  } catch {
    // Fallback: Chromium do Playwright
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
             '--disable-extensions','--no-first-run'],
    });
  }

  emit('progresso', 'Browser aberto. Carregando Google Maps...', { encontrados: 0 });

  const ctx  = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'pt-BR',
  });

  // Bloqueia recursos desnecessários — acelera bastante o carregamento
  await ctx.route('**', (route) => {
    const url = route.request().url();
    const bloqueado = [
      'googlevideo', 'doubleclick', 'googletagmanager', 'analytics',
      'google-analytics', 'adservice', 'gstatic.com/mapfiles', 'streetviewpixels',
    ].some(b => url.includes(b));
    if (bloqueado) return route.abort();

    const tipo = route.request().resourceType();
    if (['image','media','font'].includes(tipo)) return route.abort();

    return route.continue();
  });

  const page = await ctx.newPage();

  try {
    const url = `https://www.google.com/maps/search/${encodeURIComponent(queryFinal)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Aceita cookies rapidamente
    for (const sel of [
      'button[aria-label*="Accept all"]',
      'button[aria-label*="Aceitar tudo"]',
      'form[action*="consent"] button',
      '#L2AGLb', // ID do botão de aceitar do Google
    ]) {
      await page.click(sel, { timeout: 1500 }).catch(() => {});
    }

    // Aguarda o feed de resultados
    await page.waitForSelector('[role="feed"]', { timeout: 12000 }).catch(() => {});

    emit('progresso', 'Resultados carregados. Coletando dados...', { encontrados: 0 });

    let semNovos = 0;

    while (leads.length < lim && semNovos < 5) {
      // Extrai todos os cards visíveis de uma vez (sem clicar — lê o DOM direto)
      const novos = await page.evaluate((vistosList) => {
        const resultados = [];
        const feed = document.querySelector('[role="feed"]');
        if (!feed) return resultados;

        // Seleciona todos os items do feed
        const cards = feed.querySelectorAll('a[href*="/maps/place/"]');

        cards.forEach(a => {
          try {
            const href   = a.href || '';
            const parent = a.closest('[jsaction]') || a.parentElement;
            if (!parent) return;

            // Nome — pega do aria-label do link ou do heading
            const nome = a.getAttribute('aria-label')
              || parent.querySelector('[class*="fontHeadline"]')?.textContent?.trim()
              || parent.querySelector('div[class*="qBF1Pd"]')?.textContent?.trim()
              || null;

            if (!nome || nome.length < 2) return;
            if (vistosList.includes(nome)) return;

            // Endereço
            const spans = [...parent.querySelectorAll('span')].map(s => s.textContent?.trim()).filter(Boolean);
            const endereco = spans.find(s => s.match(/\d|Rua|Av|St|Ave|Blvd|Dr|Calle|Carrera/i)) || '';

            // Avaliação
            const notaEl   = parent.querySelector('[aria-label*="stars"], [aria-label*="estrelas"], span[role="img"]');
            const notaText = notaEl?.getAttribute('aria-label') || '';
            const notaNum  = notaText.match(/[\d,\.]+/)?.[0]?.replace(',','.') || null;

            // Número de avaliações
            const avalText = [...parent.querySelectorAll('span')].find(s => s.textContent?.match(/^\([\d,\.]+\)$/));
            const numAval  = avalText?.textContent?.replace(/[(),.]/g,'').trim() || null;

            // Categoria
            const catEl  = parent.querySelector('div[class*="W4Efsd"] span:last-child, [class*="category"]');
            const catText = catEl?.textContent?.trim() || '';

            resultados.push({
              nome,
              endereco: endereco.substring(0,120),
              nota:     notaNum ? parseFloat(notaNum) : null,
              numAval:  numAval ? parseInt(numAval)   : null,
              categoria: catText.substring(0,60),
              mapsUrl:  href,
            });
          } catch {}
        });

        return resultados;
      }, [...vistos]);

      if (novos.length === 0) {
        semNovos++;
      } else {
        semNovos = 0;
        for (const d of novos) {
          if (leads.length >= lim) break;
          if (vistos.has(d.nome)) continue;
          vistos.add(d.nome);

          const emp = {
            id:         gerarId(),
            title:      d.nome,
            phone:      null,
            phone_raw:  '',
            address:    d.endereco || '',
            category:   d.categoria || '',
            website:    '',
            rating:     d.nota,
            reviews:    d.numAval,
            maps_url:   d.mapsUrl || `https://www.google.com/maps/search/${encodeURIComponent(d.nome)}`,
            pais,
            scraped_at: new Date().toISOString(),
            favorito:   false,
          };

          leads.push(emp);
          emit('progresso', `[${leads.length}/${lim}] ${d.nome}`, { empresa: emp });
        }
      }

      // Scroll para carregar mais
      if (leads.length < lim) {
        const scrollou = await page.evaluate(() => {
          const f = document.querySelector('[role="feed"]');
          if (!f) return false;
          f.scrollTop += 2000;
          return true;
        });
        if (!scrollou) break;

        await page.waitForTimeout(1200);

        const fim = await page.$('span.HlvSq, [class*="noResultsText"]').catch(() => null);
        if (fim) break;
      }
    }

    // Segunda passada: enriquece com detalhes (telefone, site) clicando nos top N
    // Faz só se tiver leads sem telefone — e só nos primeiros para não demorar
    const semTel = leads.filter(l => !l.phone).slice(0, Math.min(leads.length, lim));
    if (semTel.length > 0) {
      emit('progresso', `Coletando telefones de ${semTel.length} empresas...`);
      await enriquecerDetalhes(page, leads, pais, lim, emit);
    }

  } finally {
    await browser.close();
  }

  emit('concluido', `Concluído: ${leads.length} empresas encontradas`);

  // Salva cache resumido
  try {
    const cache = fs.existsSync(PATHS.resultados)
      ? JSON.parse(fs.readFileSync(PATHS.resultados, 'utf-8')) : {};
    const chave = `${queryFinal}_${Date.now()}`;
    cache[chave] = { dados: leads, ts: new Date().toISOString() };
    const chaves = Object.keys(cache);
    if (chaves.length > 10) delete cache[chaves[0]];
    fs.writeFileSync(PATHS.resultados, JSON.stringify(cache, null, 2));
  } catch {}

  return leads;
}

// ---- Enriquece detalhes clicando nos cards (telefone + site) ----
async function enriquecerDetalhes(page, leads, pais, lim, emit) {
  let enriquecidos = 0;

  for (let i = 0; i < leads.length && enriquecidos < lim; i++) {
    const emp = leads[i];
    if (emp.phone) continue; // já tem telefone

    try {
      // Navega para a URL do Maps Place
      if (!emp.maps_url || !emp.maps_url.includes('/maps/place/')) continue;

      await page.goto(emp.maps_url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(800);

      const detalhes = await page.evaluate(() => {
        const telEl = [...document.querySelectorAll('[data-item-id],[data-tooltip]')]
          .find(el => {
            const id  = el.getAttribute('data-item-id') || '';
            const tip = el.getAttribute('data-tooltip') || '';
            return id.startsWith('phone:') || tip.toLowerCase().includes('telefone') || tip.toLowerCase().includes('phone');
          });
        const sitEl = document.querySelector('a[data-item-id*="authority"]');
        return {
          telefone: telEl?.getAttribute('data-item-id')?.replace('phone:','')
            || telEl?.getAttribute('aria-label') || null,
          website: sitEl?.href || null,
        };
      });

      const phone = normalizarTel(detalhes.telefone, pais);
      if (phone && !leads.some(l => l.phone === phone)) {
        emp.phone     = phone;
        emp.phone_raw = detalhes.telefone || '';
      }
      if (detalhes.website) emp.website = detalhes.website;

      enriquecidos++;
      emit('progresso', `[${i+1}/${leads.length}] Detalhes: ${emp.title}`, { empresa: { ...emp } });

    } catch { /* ignora */ }
  }
}
