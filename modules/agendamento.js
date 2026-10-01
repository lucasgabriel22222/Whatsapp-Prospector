// =============================================
// modules/agendamento.js — Agendamento de disparos
// =============================================
import fs   from 'fs';
import path from 'path';

const AGENDA_PATH = './data/agendamentos.json';

function ler() {
  if (!fs.existsSync(AGENDA_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(AGENDA_PATH, 'utf-8')); } catch { return []; }
}
function salvar(dados) {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync(AGENDA_PATH, JSON.stringify(dados, null, 2));
}
function gerarId() { return `ag_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

export function listarAgendamentos() { return ler(); }

export function criarAgendamento({ nome, csvPath, csvNome, leads, dataHora, delayMin, delayMax, limite, mensagem }) {
  const lista = ler();
  const ag = {
    id:         gerarId(),
    nome:       nome || `Disparo ${new Date(dataHora).toLocaleString('pt-BR')}`,
    csvNome:    csvNome || 'leads.csv',
    csvPath:    csvPath || null,
    leads:      leads  || [],
    dataHora:   dataHora,    // ISO string
    delayMin:   delayMin  || 45,
    delayMax:   delayMax  || 90,
    limite:     limite    || 0,
    mensagem:   mensagem  || null,
    status:     'agendado', // agendado | executando | concluido | cancelado | erro
    criadoEm:  new Date().toISOString(),
    executadoEm: null,
    resultado:  null,
  };
  lista.push(ag);
  salvar(lista);
  return ag;
}

export function atualizarAgendamento(id, campos) {
  const lista = ler();
  const idx   = lista.findIndex(a => a.id === id);
  if (idx === -1) return null;
  lista[idx] = { ...lista[idx], ...campos };
  salvar(lista);
  return lista[idx];
}

export function cancelarAgendamento(id) {
  const lista = ler();
  const idx   = lista.findIndex(a => a.id === id);
  if (idx === -1) return null;
  lista[idx].status = 'cancelado';
  salvar(lista);
  return lista[idx];
}

export function removerAgendamento(id) {
  const lista = ler().filter(a => a.id !== id);
  salvar(lista);
}

// Verifica agendamentos pendentes e retorna os que devem ser executados agora
export function verificarPendentes() {
  const agora = new Date();
  return ler().filter(a => {
    if (a.status !== 'agendado') return false;
    return new Date(a.dataHora) <= agora;
  });
}
