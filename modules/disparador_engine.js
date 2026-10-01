// =============================================
// modules/disparador_engine.js
// Motor de disparo chamável pelo servidor web
// Mantém estado em memória e emite eventos SSE
// =============================================
import fs from 'fs';
import { config } from '../config.js';
import { enviarMensagem, verificarConexao } from './evolution.js';
import { gerarMensagemInicial, calcularDelayDigitacao } from './messages.js';

// -----------------------------------------------
// Estado global do disparo
// -----------------------------------------------
let estado = {
  rodando:    false,
  pausado:    false,
  total:      0,
  enviados:   0,
  erros:      0,
  pulados:    0,
  atual:      null,       // lead sendo processado agora
  inicio:     null,
  fim:        null,
  logs:       [],         // últimos 200 logs em memória
  leads:      [],
};

let pararFlag  = false;
let emitirFn   = null;    // função SSE injetada pelo server.js

// -----------------------------------------------
// Getters
// -----------------------------------------------
export function getEstado() {
  return {
    ...estado,
    leads: undefined,     // não serializa array grande no status
    progresso: estado.total > 0 ? Math.round((estado.enviados + estado.erros) / estado.total * 100) : 0,
  };
}

// -----------------------------------------------
// Logging interno + SSE
// -----------------------------------------------
function log(tipo, mensagem, dados = {}) {
  const entrada = { tipo, mensagem, dados, ts: new Date().toISOString() };

  // Mantém só últimos 200 no buffer
  estado.logs.push(entrada);
  if (estado.logs.length > 200) estado.logs.shift();

  // Emite para clientes SSE conectados
  if (emitirFn) emitirFn(tipo, mensagem, { ...dados, estado: getEstado() });

  // Console também
  const hora = new Date().toLocaleTimeString('pt-BR');
  const prefixo = { info: 'ℹ️ ', sucesso: '✅', erro: '❌', aviso: '⚠️ ', progresso: '📤' }[tipo] || '•';
  console.log(`[${hora}] ${prefixo} ${mensagem}`);
}

// -----------------------------------------------
// Delay
// -----------------------------------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// -----------------------------------------------
// Carrega leads do arquivo gerado pelo upload
// -----------------------------------------------
function carregarLeads() {
  const caminho = './data/leads_panel.json';
  if (!fs.existsSync(caminho)) throw new Error('Arquivo de leads não encontrado.');
  return JSON.parse(fs.readFileSync(caminho, 'utf-8'));
}

// -----------------------------------------------
// Carrega enviados (para não repetir)
// -----------------------------------------------
function carregarEnviados() {
  if (!fs.existsSync(config.paths.enviados)) return {};
  try { return JSON.parse(fs.readFileSync(config.paths.enviados, 'utf-8')); } catch { return {}; }
}

function salvarEnviados(enviados) {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync(config.paths.enviados, JSON.stringify(enviados, null, 2));
}

// -----------------------------------------------
// Salva relatório ao final
// -----------------------------------------------
function salvarRelatorio(resultados) {
  if (!fs.existsSync('./logs')) fs.mkdirSync('./logs', { recursive: true });
  let historico = [];
  if (fs.existsSync(config.paths.relatorio)) {
    try { historico = JSON.parse(fs.readFileSync(config.paths.relatorio, 'utf-8')); } catch {}
    if (!Array.isArray(historico)) historico = [historico];
  }
  const duracao = estado.fim ? Math.round((new Date(estado.fim) - new Date(estado.inicio)) / 1000) : 0;
  historico.push({
    sessao:     estado.inicio,
    fim:        estado.fim,
    duracao_s:  duracao,
    total:      estado.total,
    sucesso:    estado.enviados,
    erro:       estado.erros,
    taxa_ok:    estado.total > 0 ? `${((estado.enviados / estado.total) * 100).toFixed(1)}%` : '0%',
    resultados: resultados.slice(0, 500),
  });
  fs.writeFileSync(config.paths.relatorio, JSON.stringify(historico, null, 2));
}

// -----------------------------------------------
// INICIAR DISPARO
// -----------------------------------------------
export async function iniciarDisparo(opcoes = {}) {
  if (estado.rodando) return;

  emitirFn  = opcoes.emitirLog || null;
  pararFlag = false;

  const delayMin = opcoes.delayMin || config.delayMin;
  const delayMax = opcoes.delayMax || config.delayMax;
  const limite   = opcoes.limite   || 0;

  // Carrega dados
  const todosLeads = carregarLeads();
  const enviados   = carregarEnviados();

  // Filtra pendentes que ainda não foram enviados
  const pendentes = todosLeads.filter(l => !enviados[l.phone] && l.status !== 'enviado');
  const fila      = limite > 0 ? pendentes.slice(0, limite) : pendentes;

  if (fila.length === 0) {
    if (emitirFn) emitirFn('aviso', 'Nenhum lead pendente para enviar.', {});
    return;
  }

  // Atualiza estado
  estado = {
    ...estado,
    rodando:  true,
    pausado:  false,
    total:    fila.length,
    enviados: 0,
    erros:    0,
    pulados:  0,
    inicio:   new Date().toISOString(),
    fim:      null,
    logs:     estado.logs,
    leads:    fila,
  };

  log('info', `Disparo iniciado: ${fila.length} leads na fila`, { total: fila.length, delayMin, delayMax });

  const resultados = [];

  // -----------------------------------------------
  // Loop principal
  // -----------------------------------------------
  for (let i = 0; i < fila.length; i++) {
    if (pararFlag) {
      log('aviso', 'Disparo interrompido pelo usuário.', { enviados: estado.enviados, erros: estado.erros });
      break;
    }

    const lead = fila[i];
    estado.atual = { nome: lead.title, phone: lead.phone, indice: i + 1 };

    log('progresso', `[${i + 1}/${fila.length}] Enviando para ${lead.title} — ${lead.phone}`, {
      indice: i + 1, total: fila.length, lead,
    });

    try {
      const mensagem    = gerarMensagemInicial(lead.title || 'empresa');
      const delayDigit  = calcularDelayDigitacao(mensagem);

      await enviarMensagem(lead.phone, mensagem, delayDigit);

      // Registra sucesso
      enviados[lead.phone] = {
        nome:       lead.title,
        enviado_em: new Date().toISOString(),
        status:     'enviado',
      };
      lead.status = 'enviado';
      estado.enviados++;

      resultados.push({ phone: lead.phone, nome: lead.title, status: 'sucesso', erro: null });
      log('sucesso', `Enviado para ${lead.title}`, { phone: lead.phone, indice: i + 1 });

    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      lead.status = 'erro';
      estado.erros++;

      resultados.push({ phone: lead.phone, nome: lead.title, status: 'erro', erro: msg });
      log('erro', `Falha ao enviar para ${lead.title}: ${msg}`, { phone: lead.phone, motivo: msg });
    }

    // Salva progresso
    salvarEnviados(enviados);
    fs.writeFileSync('./data/leads_panel.json', JSON.stringify(todosLeads, null, 2));

    // Delay anti-ban (exceto no último)
    if (i < fila.length - 1 && !pararFlag) {
      const seg = delayMin + Math.floor(Math.random() * (delayMax - delayMin));
      log('info', `Aguardando ${seg}s antes do próximo envio...`, { delay: seg });
      await sleep(seg * 1000);
    }
  }

  // Finaliza
  estado.rodando = false;
  estado.atual   = null;
  estado.fim     = new Date().toISOString();

  salvarRelatorio(resultados);

  const duracao = Math.round((new Date(estado.fim) - new Date(estado.inicio)) / 1000);
  log('info',
    `Disparo finalizado! ${estado.enviados} enviados, ${estado.erros} erros — ${Math.floor(duracao/60)}min${duracao%60}s`,
    { enviados: estado.enviados, erros: estado.erros, duracao }
  );
}

// -----------------------------------------------
// PARAR DISPARO
// -----------------------------------------------
export function pararDisparo() {
  pararFlag = true;
  estado.pausado = true;
  log('aviso', 'Sinal de parada enviado. Finalizando envio atual...', {});
}
