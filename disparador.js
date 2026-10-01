// =============================================
// disparador.js — Motor principal de disparo
// Lê leads.csv e envia mensagens via Evolution API
// Uso: node disparador.js
// =============================================
import fs from 'fs';
import csv from 'csv-parser';
import { config, validarConfig } from './config.js';
import { enviarMensagem, verificarConexao, verificarNumero } from './modules/evolution.js';
import { gerarMensagemInicial, calcularDelayDigitacao, listarVariacoes } from './modules/messages.js';

// -----------------------------------------------
// Utilitários
// -----------------------------------------------

/** Delay em milissegundos */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Delay aleatório entre min e max segundos */
const delayAleatorio = () => {
  const seg = config.delayMin + Math.floor(Math.random() * (config.delayMax - config.delayMin));
  return { ms: seg * 1000, seg };
};

/** Cores no terminal */
const cor = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  vermelho: (t) => `\x1b[31m${t}\x1b[0m`,
  amarelo:  (t) => `\x1b[33m${t}\x1b[0m`,
  azul:     (t) => `\x1b[34m${t}\x1b[0m`,
  cinza:    (t) => `\x1b[90m${t}\x1b[0m`,
  negrito:  (t) => `\x1b[1m${t}\x1b[0m`,
};

/** Log com timestamp */
function log(msg) {
  const hora = new Date().toLocaleTimeString('pt-BR');
  console.log(`${cor.cinza(`[${hora}]`)} ${msg}`);
}

// -----------------------------------------------
// Carrega e filtra leads do CSV
// -----------------------------------------------
async function carregarLeads() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(config.paths.leads)) {
      reject(new Error(`Arquivo não encontrado: ${config.paths.leads}\nExecute primeiro: node scraper.js "sua busca"`));
      return;
    }

    const leads = [];
    fs.createReadStream(config.paths.leads)
      .pipe(csv())
      .on('data', (row) => {
        // Só inclui leads pendentes com telefone válido
        if (row.phone && row.phone.length >= 12 && row.status_envio !== 'enviado') {
          leads.push(row);
        }
      })
      .on('end', () => resolve(leads))
      .on('error', reject);
  });
}

// -----------------------------------------------
// Carrega registro de enviados (para não repetir)
// -----------------------------------------------
function carregarEnviados() {
  if (!fs.existsSync(config.paths.enviados)) return {};
  try {
    return JSON.parse(fs.readFileSync(config.paths.enviados, 'utf-8'));
  } catch { return {}; }
}

// -----------------------------------------------
// Salva registro de enviados
// -----------------------------------------------
function salvarEnviados(enviados) {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync(config.paths.enviados, JSON.stringify(enviados, null, 2));
}

// -----------------------------------------------
// Atualiza status no CSV original
// -----------------------------------------------
function atualizarStatusCSV(leads) {
  const cabecalho = 'title,phone,phone_raw,address,category,website,rating,reviews,scraped_at,status_envio\n';
  const linhas = leads.map(l => {
    const escapar = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
    return [
      escapar(l.title), escapar(l.phone), escapar(l.phone_raw || ''),
      escapar(l.address), escapar(l.category), escapar(l.website),
      escapar(l.rating), escapar(l.reviews), escapar(l.scraped_at),
      escapar(l.status_envio),
    ].join(',');
  });
  fs.writeFileSync(config.paths.leads, cabecalho + linhas.join('\n'));
}

// -----------------------------------------------
// Salva relatório final em JSON
// -----------------------------------------------
function salvarRelatorio(relatorio) {
  if (!fs.existsSync('./logs')) fs.mkdirSync('./logs', { recursive: true });
  let historico = [];
  if (fs.existsSync(config.paths.relatorio)) {
    try { historico = JSON.parse(fs.readFileSync(config.paths.relatorio, 'utf-8')); } catch {}
    if (!Array.isArray(historico)) historico = [historico]; // compatibilidade
  }
  historico.push(relatorio);
  fs.writeFileSync(config.paths.relatorio, JSON.stringify(historico, null, 2));
}

// -----------------------------------------------
// MAIN — Disparo principal
// -----------------------------------------------
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log(cor.negrito('  🚀 WHATSAPP PROSPECTOR — Disparador B2B'));
  console.log('═'.repeat(60));

  // 1. Valida configuração
  validarConfig();

  // 2. Verifica conexão com Evolution API
  log('Verificando conexão com Evolution API...');
  const conexao = await verificarConexao();
  if (!conexao.conectado) {
    console.error(cor.vermelho(`\n❌ WhatsApp não conectado! Estado: ${conexao.estado}`));
    console.error(cor.amarelo('   → Abra o painel da Evolution API e conecte o WhatsApp via QR Code.\n'));
    process.exit(1);
  }
  log(cor.verde(`✅ WhatsApp conectado! Estado: ${conexao.estado}`));

  // 3. Carrega leads
  let todos = [];
  try {
    todos = await carregarLeads();
  } catch (err) {
    console.error(cor.vermelho(`\n❌ ${err.message}\n`));
    process.exit(1);
  }

  const enviados  = carregarEnviados();
  const variacoes = listarVariacoes();

  // Filtra leads que já foram enviados
  const pendentes = todos.filter(l => !enviados[l.phone]);
  const limite    = config.limiteEnvios > 0 ? Math.min(config.limiteEnvios, pendentes.length) : pendentes.length;
  const fila      = pendentes.slice(0, limite);

  console.log('\n' + '─'.repeat(60));
  console.log(`  📋 Total no CSV    : ${cor.negrito(todos.length)} leads`);
  console.log(`  ✅ Já enviados     : ${cor.negrito(Object.keys(enviados).length)}`);
  console.log(`  📤 Fila de envio   : ${cor.negrito(fila.length)} (limite: ${limite})`);
  console.log(`  ⏱️  Delay           : ${config.delayMin}–${config.delayMax}s entre envios`);
  console.log(`  🎲 Variações msg   : ${variacoes.totalCombinacoes} combinações possíveis`);
  console.log('─'.repeat(60) + '\n');

  if (fila.length === 0) {
    console.log(cor.amarelo('  ⚠️  Nenhum lead pendente para enviar.'));
    console.log(cor.cinza('     Execute node scraper.js "sua busca" para coletar novos leads.\n'));
    process.exit(0);
  }

  // 4. Confirma antes de disparar
  console.log(cor.amarelo(`  ⚡ Pronto para disparar ${fila.length} mensagens.`));
  console.log(cor.cinza('  Pressione CTRL+C para cancelar a qualquer momento.\n'));
  await sleep(3000); // 3 segundos para cancelar

  // 5. Estatísticas da sessão
  const stats = { sucesso: 0, erro: 0, pulado: 0, inicio: new Date() };
  const resultados = [];

  // 6. Loop principal de disparo
  for (let i = 0; i < fila.length; i++) {
    const lead = fila[i];
    const pos  = `[${i + 1}/${fila.length}]`;

    process.stdout.write(`\n${cor.azul(pos)} ${cor.negrito(lead.title?.substring(0, 40) || 'Sem nome')} — ${cor.cinza(lead.phone)}`);

    try {
      // Verifica se número existe no WhatsApp (opcional, pode ser lento)
      // const check = await verificarNumero(lead.phone);
      // if (!check.existe) { ... pular ... }

      // Gera mensagem personalizada com variação
      const mensagem = gerarMensagemInicial(lead.title || 'empresa');
      const delayDigit = calcularDelayDigitacao(mensagem);

      // Envia mensagem
      await enviarMensagem(lead.phone, mensagem, delayDigit);

      // Registra sucesso
      enviados[lead.phone] = {
        nome:        lead.title,
        enviado_em:  new Date().toISOString(),
        mensagem:    mensagem,
        status:      'enviado',
      };
      lead.status_envio = 'enviado';
      stats.sucesso++;

      resultados.push({ phone: lead.phone, nome: lead.title, status: 'sucesso', erro: null });
      process.stdout.write(` ${cor.verde('✓ Enviado!')}`);

    } catch (err) {
      stats.erro++;
      lead.status_envio = 'erro';
      const mensagemErro = err.response?.data?.message || err.message;
      resultados.push({ phone: lead.phone, nome: lead.title, status: 'erro', erro: mensagemErro });
      process.stdout.write(` ${cor.vermelho(`✗ Erro: ${mensagemErro.substring(0, 50)}`)}`);
    }

    // Salva progresso a cada envio
    salvarEnviados(enviados);
    atualizarStatusCSV(todos);

    // Delay anti-ban (exceto no último)
    if (i < fila.length - 1) {
      const { ms, seg } = delayAleatorio();
      process.stdout.write(cor.cinza(` — aguardando ${seg}s...`));
      await sleep(ms);
    }
  }

  // 7. Relatório final
  const duracao = Math.round((new Date() - stats.inicio) / 1000);
  const relatorio = {
    sessao:     new Date().toISOString(),
    duracao_s:  duracao,
    total:      fila.length,
    sucesso:    stats.sucesso,
    erro:       stats.erro,
    taxa_ok:    `${((stats.sucesso / fila.length) * 100).toFixed(1)}%`,
    resultados,
  };

  salvarRelatorio(relatorio);

  console.log('\n\n' + '═'.repeat(60));
  console.log(cor.negrito('  📊 RELATÓRIO FINAL'));
  console.log('─'.repeat(60));
  console.log(`  ✅ Enviados com sucesso : ${cor.verde(stats.sucesso)}`);
  console.log(`  ❌ Erros               : ${cor.vermelho(stats.erro)}`);
  console.log(`  ⏱️  Duração da sessão   : ${Math.floor(duracao / 60)}min ${duracao % 60}s`);
  console.log(`  📁 Relatório salvo em  : ${config.paths.relatorio}`);
  console.log('═'.repeat(60) + '\n');
}

// Captura CTRL+C graciosamente
process.on('SIGINT', () => {
  console.log(cor.amarelo('\n\n  ⚠️  Disparo interrompido pelo usuário. Progresso salvo.\n'));
  process.exit(0);
});

main().catch(err => {
  console.error(cor.vermelho(`\n💥 Erro fatal: ${err.message}\n`));
  process.exit(1);
});
