// =============================================
// scraper.js — Scraper Google Maps com Playwright
// Uso: node scraper.js "psicólogos São Paulo" 50
// =============================================
import { chromium } from 'playwright';
import { createObjectCsvWriter } from 'csv-writer';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';

// Pega argumentos da linha de comando
const args = process.argv.slice(2);
const BUSCA = args[0] || 'clínicas médicas São Paulo';
const MAX   = parseInt(args[1] || config.scraperMaxResults);

// Garante que pasta data existe
if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });

// -----------------------------------------------
// Formata número de telefone para padrão BR
// -----------------------------------------------
function formatarTelefone(raw) {
  if (!raw) return null;
  // Remove tudo que não for dígito
  let num = raw.replace(/\D/g, '');

  // Remove DDI 55 se já tiver (vamos re-adicionar)
  if (num.startsWith('55') && num.length > 12) {
    num = num.slice(2);
  }

  // Valida tamanho mínimo (DDD + 8 ou 9 dígitos = 10 ou 11)
  if (num.length < 10 || num.length > 11) return null;

  // Adiciona DDI Brasil
  return `55${num}`;
}

// -----------------------------------------------
// Scraper principal
// -----------------------------------------------
async function scrapeGoogleMaps(busca, maxResultados) {
  console.log(`\n🔍 Iniciando scraper Google Maps`);
  console.log(`   Busca: "${busca}"`);
  console.log(`   Limite: ${maxResultados} resultados\n`);

  const browser = await chromium.launch({
    headless: config.scraperHeadless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    geolocation: { latitude: -23.55, longitude: -46.63 },
    permissions: ['geolocation'],
  });

  const page = await context.newPage();
  const leads = [];
  const urlBusca = `https://www.google.com/maps/search/${encodeURIComponent(busca)}`;

  try {
    await page.goto(urlBusca, { waitUntil: 'networkidle', timeout: 30000 });

    // Aguarda lista de resultados carregar
    await page.waitForSelector('[role="feed"]', { timeout: 15000 }).catch(() => {});

    let tentativas = 0;
    const maxTentativas = 30;

    while (leads.length < maxResultados && tentativas < maxTentativas) {
      tentativas++;

      // Pega todos os cards visíveis
      const cards = await page.$$('[role="feed"] > div[jsaction]');

      for (const card of cards) {
        if (leads.length >= maxResultados) break;

        try {
          // Clica no card para abrir detalhes
          await card.click({ timeout: 5000 });
          await page.waitForTimeout(1500 + Math.random() * 1000);

          // Extrai dados do painel lateral
          const dados = await page.evaluate(() => {
            const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
            const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || null;

            // Nome da empresa
            const nome = getText('h1.DUwDvf') || getText('[data-attrid="title"]') || null;

            // Telefone — tenta vários seletores
            const telefoneEl = document.querySelector('button[data-tooltip="Copiar número de telefone"]')
              || document.querySelector('[data-item-id*="phone"]')
              || [...document.querySelectorAll('button[aria-label]')]
                  .find(b => b.getAttribute('aria-label')?.match(/^\+?[\d\s\(\)\-]{8,}$/));
            const telefone = telefoneEl?.getAttribute('aria-label')
              || telefoneEl?.getAttribute('data-item-id')?.replace('phone:', '')
              || null;

            // Endereço
            const enderecoEl = document.querySelector('button[data-tooltip="Copiar endereço"]')
              || document.querySelector('[data-item-id*="address"]');
            const endereco = enderecoEl?.getAttribute('aria-label') || null;

            // Categoria / segmento
            const categoria = getText('button.DkEaL') || null;

            // Website
            const website = getAttr('a[data-item-id*="authority"]', 'href') || null;

            // Avaliação
            const avaliacao = getText('.F7nice span[aria-hidden="true"]') || null;

            // Número de avaliações
            const numAvaliacoes = getText('.F7nice span[aria-label]') || null;

            return { nome, telefone, endereco, categoria, website, avaliacao, numAvaliacoes };
          });

          if (!dados.nome) continue;

          const telefoneFormatado = formatarTelefone(dados.telefone);

          // Só adiciona se tiver nome e telefone válido
          if (dados.nome && telefoneFormatado) {
            // Verifica duplicata
            const jaTem = leads.some(l => l.phone === telefoneFormatado);
            if (!jaTem) {
              leads.push({
                title:          dados.nome,
                phone:          telefoneFormatado,
                phone_raw:      dados.telefone || '',
                address:        dados.endereco || '',
                category:       dados.categoria || '',
                website:        dados.website || '',
                rating:         dados.avaliacao || '',
                reviews:        dados.numAvaliacoes || '',
                scraped_at:     new Date().toISOString(),
                status_envio:   'pendente',
              });

              const pct = ((leads.length / maxResultados) * 100).toFixed(0);
              process.stdout.write(`\r   📌 [${leads.length}/${maxResultados}] ${pct}% — ${dados.nome.substring(0, 40)}`);
            }
          }
        } catch (_) {
          // Ignora erros em cards individuais e continua
        }
      }

      // Scroll para carregar mais resultados
      if (leads.length < maxResultados) {
        await page.evaluate(() => {
          const feed = document.querySelector('[role="feed"]');
          if (feed) feed.scrollTop += 2000;
        });
        await page.waitForTimeout(2000);

        // Verifica se chegou ao fim da lista
        const fimLista = await page.$('span.HlvSq');
        if (fimLista) {
          console.log('\n   ⚠️  Fim dos resultados do Google Maps atingido.');
          break;
        }
      }
    }

  } catch (err) {
    console.error(`\n❌ Erro durante scraping: ${err.message}`);
  } finally {
    await browser.close();
  }

  return leads;
}

// -----------------------------------------------
// Salva leads no CSV
// -----------------------------------------------
async function salvarCSV(leads) {
  const outputPath = config.paths.leads;

  // Verifica se já existe CSV e faz backup
  if (fs.existsSync(outputPath)) {
    const backupPath = `./data/leads_backup_${Date.now()}.csv`;
    fs.copyFileSync(outputPath, backupPath);
    console.log(`\n   💾 Backup do CSV anterior salvo em: ${backupPath}`);
  }

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: 'title',        title: 'title' },
      { id: 'phone',        title: 'phone' },
      { id: 'phone_raw',    title: 'phone_raw' },
      { id: 'address',      title: 'address' },
      { id: 'category',     title: 'category' },
      { id: 'website',      title: 'website' },
      { id: 'rating',       title: 'rating' },
      { id: 'reviews',      title: 'reviews' },
      { id: 'scraped_at',   title: 'scraped_at' },
      { id: 'status_envio', title: 'status_envio' },
    ],
  });

  await csvWriter.writeRecords(leads);
  console.log(`\n\n✅ CSV salvo: ${outputPath} (${leads.length} leads)\n`);
}

// -----------------------------------------------
// MAIN
// -----------------------------------------------
(async () => {
  const leads = await scrapeGoogleMaps(BUSCA, MAX);

  if (leads.length === 0) {
    console.log('\n⚠️  Nenhum lead encontrado. Tente outra busca.');
    process.exit(0);
  }

  await salvarCSV(leads);

  console.log('📊 Resumo do Scraping:');
  console.log(`   Total coletado : ${leads.length} empresas`);
  console.log(`   Com telefone   : ${leads.filter(l => l.phone).length}`);
  console.log(`   Com website    : ${leads.filter(l => l.website).length}`);
  console.log('\n🚀 Próximo passo: execute   node disparador.js\n');
})();
