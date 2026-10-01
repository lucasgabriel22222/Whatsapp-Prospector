// =============================================
// modules/messages.js — Templates de mensagem
// Lê variações do arquivo data/mensagens.json
// Configurável pelo painel web
// =============================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MENSAGENS_PATH = path.join(__dirname, '../data/mensagens.json');

// Fallback caso o arquivo não exista ainda
const FALLBACK = {
  config: { delayEntreVariacoes: 3, simularDigitacao: true, personalizarNome: true, variavelNome: '{empresa}' },
  grupos: [
    { id: 'saudacoes',   ativo: true, variacoes: ['Olá, tudo bem?', 'Oi! Como vai?', 'Bom dia!'] },
    { id: 'abertura',    ativo: true, variacoes: ['Vi o perfil da *{empresa}* no Google Maps.'] },
    { id: 'qualificacao',ativo: true, variacoes: ['Vocês ainda estão atendendo por aqui?'] },
    { id: 'followup',    ativo: true, variacoes: ['Oi! Só passando para ver se recebeu minha mensagem. 😊'] },
    { id: 'apresentacao',ativo: true, variacoes: ['Trabalho com sites e automações para negócios locais. Teria interesse?'] },
  ],
};

// -----------------------------------------------
// Carrega mensagens do disco (sempre atualizado)
// -----------------------------------------------
function carregarMensagens() {
  try {
    if (fs.existsSync(MENSAGENS_PATH)) {
      return JSON.parse(fs.readFileSync(MENSAGENS_PATH, 'utf-8'));
    }
  } catch {}
  return FALLBACK;
}

// -----------------------------------------------
// Utilitários
// -----------------------------------------------
function sortear(arr) {
  if (!arr || arr.length === 0) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

function personalizar(texto, nomeEmpresa) {
  if (!texto) return '';
  return texto.replace(/\{empresa\}/g, nomeEmpresa || 'empresa');
}

function getGrupo(dados, id) {
  return dados.grupos?.find(g => g.id === id && g.ativo !== false);
}

// -----------------------------------------------
// Gera mensagem inicial (saudação + abertura + qualificação)
// -----------------------------------------------
export function gerarMensagemInicial(nomeEmpresa) {
  const dados = carregarMensagens();

  const saudacao  = personalizar(sortear(getGrupo(dados, 'saudacoes')?.variacoes   || []), nomeEmpresa);
  const abertura  = personalizar(sortear(getGrupo(dados, 'abertura')?.variacoes    || []), nomeEmpresa);
  const pergunta  = personalizar(sortear(getGrupo(dados, 'qualificacao')?.variacoes|| []), nomeEmpresa);

  const partes = [saudacao, abertura, pergunta].filter(Boolean);
  return partes.join('\n\n');
}

// -----------------------------------------------
// Follow-up (sem resposta)
// -----------------------------------------------
export function gerarFollowUp(nomeEmpresa) {
  const dados = carregarMensagens();
  const texto = sortear(getGrupo(dados, 'followup')?.variacoes || []);
  return personalizar(texto, nomeEmpresa);
}

// -----------------------------------------------
// Apresentação do serviço (após interesse)
// -----------------------------------------------
export function gerarApresentacao(nomeEmpresa) {
  const dados = carregarMensagens();
  const texto = sortear(getGrupo(dados, 'apresentacao')?.variacoes || []);
  return personalizar(texto, nomeEmpresa);
}

// -----------------------------------------------
// Mensagem de grupo customizado por ID
// -----------------------------------------------
export function gerarPorGrupo(grupoId, nomeEmpresa) {
  const dados = carregarMensagens();
  const texto = sortear(getGrupo(dados, grupoId)?.variacoes || []);
  return personalizar(texto, nomeEmpresa);
}

// -----------------------------------------------
// Delay de digitação baseado no tamanho da mensagem
// -----------------------------------------------
export function calcularDelayDigitacao(mensagem) {
  const palavras = (mensagem || '').split(' ').length;
  const msBase   = (palavras / 40) * 60 * 1000;
  return Math.min(Math.max(msBase, 2000), 8000);
}

// -----------------------------------------------
// Retorna estatísticas de variações (usado pelo painel)
// -----------------------------------------------
export function listarVariacoes() {
  const dados   = carregarMensagens();
  const grupos  = dados.grupos || [];
  const ativos  = grupos.filter(g => g.ativo !== false);
  const total   = ativos.reduce((acc, g) => acc * Math.max(g.variacoes?.length || 1, 1), 1);
  return {
    totalGrupos:      grupos.length,
    gruposAtivos:     ativos.length,
    totalCombinacoes: total,
    detalhes:         grupos.map(g => ({ id: g.id, nome: g.nome, qtd: g.variacoes?.length || 0, ativo: g.ativo })),
  };
}
