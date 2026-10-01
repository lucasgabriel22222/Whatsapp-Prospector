// =============================================
// modules/negocios.js — Gerenciador de negócios e clientes
// Negócios: leads quentes aguardando fechamento
// Clientes: pagaram, aguardam entrega do site
// =============================================
import fs from 'fs';

const NEGOCIOS_PATH = './data/negocios.json';
const CLIENTES_PATH = './data/clientes.json';

// -----------------------------------------------
// Helpers genéricos
// -----------------------------------------------
function ler(caminho) {
  if (!fs.existsSync(caminho)) return [];
  try { return JSON.parse(fs.readFileSync(caminho, 'utf-8')); } catch { return []; }
}

function salvar(caminho, dados) {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync(caminho, JSON.stringify(dados, null, 2));
}

function gerarId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// =============================================
// NEGÓCIOS
// =============================================

export function listarNegocios() {
  return ler(NEGOCIOS_PATH);
}

export function adicionarNegocio({ nome, phone, categoria, resumo, historico }) {
  const lista = ler(NEGOCIOS_PATH);
  // Evita duplicata por telefone
  if (lista.find(n => n.phone === phone)) return null;
  const negocio = {
    id:          gerarId(),
    nome:        nome || 'Lead',
    phone,
    categoria:   categoria || '',
    resumo:      resumo   || '',
    historico:   historico || [],
    status:      'aguardando',    // aguardando | cobranca_enviada | pago | cancelado
    pagamento:   null,
    criadoEm:    new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
  lista.push(negocio);
  salvar(NEGOCIOS_PATH, lista);
  return negocio;
}

export function atualizarNegocio(id, campos) {
  const lista = ler(NEGOCIOS_PATH);
  const idx   = lista.findIndex(n => n.id === id);
  if (idx === -1) return null;
  lista[idx] = { ...lista[idx], ...campos, atualizadoEm: new Date().toISOString() };
  salvar(NEGOCIOS_PATH, lista);
  return lista[idx];
}

export function removerNegocio(id) {
  const lista = ler(NEGOCIOS_PATH).filter(n => n.id !== id);
  salvar(NEGOCIOS_PATH, lista);
}

// =============================================
// CLIENTES (pagamento aprovado)
// =============================================

export function listarClientes() {
  return ler(CLIENTES_PATH);
}

export function adicionarCliente({ negocio, pagamento, tipoSite, observacoes }) {
  const lista   = ler(CLIENTES_PATH);
  const cliente = {
    id:           gerarId(),
    negocioId:    negocio.id,
    nome:         negocio.nome,
    phone:        negocio.phone,
    categoria:    negocio.categoria,
    resumo:       negocio.resumo,
    tipoSite:     tipoSite     || '',      // preenchido manualmente depois
    observacoes:  observacoes  || '',
    valor:        pagamento?.valor || 0,
    pagamentoId:  pagamento?.id   || null,
    status:       'pendente',              // pendente | em_desenvolvimento | entregue
    criadoEm:     new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    entregueEm:   null,
  };
  lista.push(cliente);
  salvar(CLIENTES_PATH, lista);
  return cliente;
}

export function atualizarCliente(id, campos) {
  const lista = ler(CLIENTES_PATH);
  const idx   = lista.findIndex(c => c.id === id);
  if (idx === -1) return null;
  if (campos.status === 'entregue' && !lista[idx].entregueEm) {
    campos.entregueEm = new Date().toISOString();
  }
  lista[idx] = { ...lista[idx], ...campos, atualizadoEm: new Date().toISOString() };
  salvar(CLIENTES_PATH, lista);
  return lista[idx];
}

export function removerCliente(id) {
  const lista = ler(CLIENTES_PATH).filter(c => c.id !== id);
  salvar(CLIENTES_PATH, lista);
}
