// =============================================
// config.js — Configuração central
// =============================================
import 'dotenv/config';

export const config = {
  // --- Servidor ---
  panelPort:   parseInt(process.env.PORT         || '3000'),
  webhookPort: parseInt(process.env.WEBHOOK_PORT || '3001'),
  webhookUrl:  process.env.WEBHOOK_URL || 'http://localhost:3001/webhook',

  // --- Evolution API ---
  evolutionApiUrl: process.env.EVOLUTION_API_URL  || 'http://localhost:8081',
  instanceName:    process.env.EVOLUTION_INSTANCE || 'prospeccao',
  apiKey:          process.env.EVOLUTION_API_KEY  || '',

  // --- Gemini — até 5 chaves com rodízio ---
  geminiKeys: [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
  ].filter(k => k && k.trim()),

  // --- Mercado Pago ---
  mercadoPagoToken: (process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim(),

  // --- Disparo ---
  delayMin:     parseInt(process.env.DELAY_MIN     || '45'),
  delayMax:     parseInt(process.env.DELAY_MAX     || '90'),
  limiteEnvios: parseInt(process.env.LIMITE_ENVIOS || '0'),

  // --- Scraper ---
  scraperMaxResults: parseInt(process.env.SCRAPER_MAX_RESULTS || '50'),
  scraperHeadless:   process.env.SCRAPER_HEADLESS !== 'false',

  // --- Apify ---
  apifyToken: (process.env.APIFY_API_TOKEN || '').trim(),

  // --- Paths ---
  paths: {
    leads:      './data/leads_panel.json',
    apifyLeads: './data/apify_leads.json',
    enviados:   './data/enviados.json',
    relatorio:  './logs/relatorio_envios.json',
    conversas:  './data/conversas.json',
    negocios:   './data/negocios.json',
    clientes:   './data/clientes.json',
    gemini:     './data/gemini_config.json',
    mensagens:  './data/mensagens.json',
  },
};

export function validarConfig() {
  const avisos = [];
  if (!config.apiKey)                avisos.push('EVOLUTION_API_KEY não definida');
  if (!config.instanceName)          avisos.push('EVOLUTION_INSTANCE não definida');
  if (config.geminiKeys.length === 0) avisos.push('Nenhuma GEMINI_API_KEY_N definida — IA ficará inativa');
  if (!config.mercadoPagoToken)      avisos.push('MERCADO_PAGO_ACCESS_TOKEN não definida — pagamentos desativados');

  if (avisos.length > 0) {
    console.warn('\n⚠️  Avisos de configuração:');
    avisos.forEach(a => console.warn(`   → ${a}`));
    console.warn('');
  }
}
