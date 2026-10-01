// =============================================
// relatorio.js — Painel de status e relatórios
// Uso: node relatorio.js
// =============================================
import fs from 'fs';
import { config } from './config.js';
import { verificarConexao } from './modules/evolution.js';

const cor = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  vermelho: (t) => `\x1b[31m${t}\x1b[0m`,
  amarelo:  (t) => `\x1b[33m${t}\x1b[0m`,
  azul:     (t) => `\x1b[34m${t}\x1b[0m`,
  ciano:    (t) => `\x1b[36m${t}\x1b[0m`,
  cinza:    (t) => `\x1b[90m${t}\x1b[0m`,
  negrito:  (t) => `\x1b[1m${t}\x1b[0m`,
};

// -----------------------------------------------
// Carrega arquivos de dados
// -----------------------------------------------
function carregarDados() {
  const dados = {
    enviados:    {},
    relatorios:  [],
    conversas:   {},
    totalLeads:  0,
    leadsEnviados: 0,
    leadsErro:   0,
    leadsPendentes: 0,
  };

  // Enviados
  if (fs.existsSync(config.paths.enviados)) {
    try { dados.enviados = JSON.parse(fs.readFileSync(config.paths.enviados, 'utf-8')); } catch {}
  }

  // Relatórios históricos
  if (fs.existsSync(config.paths.relatorio)) {
    try {
      const raw = JSON.parse(fs.readFileSync(config.paths.relatorio, 'utf-8'));
      dados.relatorios = Array.isArray(raw) ? raw : [raw];
    } catch {}
  }

  // Conversas
  if (fs.existsSync(config.paths.conversas)) {
    try { dados.conversas = JSON.parse(fs.readFileSync(config.paths.conversas, 'utf-8')); } catch {}
  }

  // CSV de leads
  if (fs.existsSync(config.paths.leads)) {
    const conteudo = fs.readFileSync(config.paths.leads, 'utf-8');
    const linhas   = conteudo.split('\n').filter(l => l.trim() && !l.startsWith('title'));
    dados.totalLeads     = linhas.length;
    dados.leadsEnviados  = linhas.filter(l => l.includes('"enviado"')).length;
    dados.leadsErro      = linhas.filter(l => l.includes('"erro"')).length;
    dados.leadsPendentes = linhas.filter(l => l.includes('"pendente"')).length;
  }

  return dados;
}

// -----------------------------------------------
// Formata data ISO para PT-BR
// -----------------------------------------------
function formatarData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

// -----------------------------------------------
// Gera painel completo
// -----------------------------------------------
async function mostrarRelatorio() {
  console.clear();
  console.log('\n' + '═'.repeat(65));
  console.log(cor.negrito('  📊 WHATSAPP PROSPECTOR — Painel de Status'));
  console.log(`  ${cor.cinza('Atualizado em: ' + new Date().toLocaleString('pt-BR'))}`);
  console.log('═'.repeat(65));

  // Status da conexão
  console.log('\n' + cor.negrito('  🔌 CONEXÃO WHATSAPP'));
  console.log('─'.repeat(65));
  try {
    const conexao = await verificarConexao();
    const icone = conexao.conectado ? cor.verde('● ONLINE') : cor.vermelho('● OFFLINE');
    console.log(`  Status    : ${icone}`);
    console.log(`  Estado    : ${conexao.estado}`);
    console.log(`  Instância : ${config.instanceName}`);
    console.log(`  API URL   : ${config.evolutionApiUrl}`);
  } catch {
    console.log(cor.vermelho('  ❌ Não foi possível verificar conexão'));
  }

  // Dados do CSV
  const dados = carregarDados();
  console.log('\n' + cor.negrito('  📋 LEADS (CSV)'));
  console.log('─'.repeat(65));
  console.log(`  Total coletados  : ${cor.negrito(dados.totalLeads)}`);
  console.log(`  ✅ Enviados       : ${cor.verde(dados.leadsEnviados)}`);
  console.log(`  ❌ Com erro       : ${cor.vermelho(dados.leadsErro)}`);
  console.log(`  ⏳ Pendentes      : ${cor.amarelo(dados.leadsPendentes)}`);

  // Sessões de disparo
  if (dados.relatorios.length > 0) {
    console.log('\n' + cor.negrito('  📤 SESSÕES DE DISPARO'));
    console.log('─'.repeat(65));

    // Últimas 5 sessões
    const ultimas = dados.relatorios.slice(-5).reverse();
    for (const r of ultimas) {
      const taxa = parseFloat(r.taxa_ok || '0');
      const corTaxa = taxa >= 80 ? cor.verde : taxa >= 50 ? cor.amarelo : cor.vermelho;
      console.log(
        `  ${cor.cinza(formatarData(r.sessao))} — ` +
        `${cor.verde(r.sucesso + '✓')} ${cor.vermelho(r.erro + '✗')} — ` +
        `Taxa: ${corTaxa(r.taxa_ok)} — ` +
        `${Math.floor(r.duracao_s / 60)}min`
      );
    }

    // Totais acumulados
    const totalEnviado  = dados.relatorios.reduce((a, r) => a + (r.sucesso || 0), 0);
    const totalErros    = dados.relatorios.reduce((a, r) => a + (r.erro || 0), 0);
    console.log('─'.repeat(65));
    console.log(`  Total acumulado  : ${cor.verde(totalEnviado + ' enviados')} | ${cor.vermelho(totalErros + ' erros')}`);
  }

  // Conversas ativas
  const numConversas = Object.keys(dados.conversas).length;
  if (numConversas > 0) {
    console.log('\n' + cor.negrito('  💬 CONVERSAS'));
    console.log('─'.repeat(65));
    console.log(`  Total de conversas : ${cor.negrito(numConversas)}`);

    // Analisa status das conversas
    const statusCount = {};
    const tempCount   = {};
    for (const [, conv] of Object.entries(dados.conversas)) {
      const s = conv.analise?.status || 'sem_resposta';
      const t = conv.analise?.temperatura || 'frio';
      statusCount[s] = (statusCount[s] || 0) + 1;
      tempCount[t]   = (tempCount[t]   || 0) + 1;
    }

    if (tempCount.quente) console.log(`  🔥 Quentes     : ${cor.vermelho(tempCount.quente)}`);
    if (tempCount.morno)  console.log(`  🟡 Mornas      : ${cor.amarelo(tempCount.morno)}`);
    if (tempCount.frio)   console.log(`  🧊 Frias       : ${cor.cinza(tempCount.frio)}`);

    // Top conversas mais ativas
    const ativas = Object.entries(dados.conversas)
      .sort((a, b) => (b[1].historico?.length || 0) - (a[1].historico?.length || 0))
      .slice(0, 5);

    if (ativas.length > 0) {
      console.log('\n  Top 5 mais ativas:');
      for (const [num, conv] of ativas) {
        const msgs = conv.historico?.length || 0;
        const ult  = formatarData(conv.ultima_atividade);
        const temp = conv.analise?.temperatura || '?';
        const icone = temp === 'quente' ? '🔥' : temp === 'morno' ? '🟡' : '🧊';
        console.log(`  ${icone} ${cor.cinza(num)} — ${msgs} msgs — ${cor.cinza(ult)}`);
      }
    }
  }

  // Configuração atual
  console.log('\n' + cor.negrito('  ⚙️  CONFIGURAÇÃO ATIVA'));
  console.log('─'.repeat(65));
  console.log(`  Delay entre envios : ${config.delayMin}–${config.delayMax} segundos`);
  console.log(`  Limite por sessão  : ${config.limiteEnvios || 'sem limite'}`);
  console.log(`  Webhook porta      : ${config.webhookPort}`);
  console.log(`  Gemini AI          : ${config.geminiApiKey ? cor.verde('configurado') : cor.vermelho('não configurado')}`);

  // Comandos úteis
  console.log('\n' + cor.negrito('  🛠️  COMANDOS ÚTEIS'));
  console.log('─'.repeat(65));
  console.log(`  ${cor.ciano('node scraper.js "psicólogos SP" 50')}  → Coletar leads`);
  console.log(`  ${cor.ciano('node disparador.js')}                  → Disparar mensagens`);
  console.log(`  ${cor.ciano('node listener.js')}                    → Responder automaticamente`);
  console.log(`  ${cor.ciano('node relatorio.js')}                   → Este painel`);
  console.log('\n' + '═'.repeat(65) + '\n');
}

mostrarRelatorio().catch(err => {
  console.error(`\n❌ Erro ao gerar relatório: ${err.message}\n`);
});
