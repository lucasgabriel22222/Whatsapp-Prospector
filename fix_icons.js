// Script para substituir emojis por ícones Lucide no index.html
import fs from 'fs';

const file = './public/index.html';
let html = fs.readFileSync(file, 'utf-8');

// Mapa emoji → ícone Lucide
const map = [
  // Page titles — remove emoji do texto
  ['🎛️ Painel de Controle', 'Painel de Controle'],
  ['🚀 Disparo em Massa', 'Disparo em Massa'],
  ['✍️ Mensagens', 'Mensagens'],
  ['🤖 Gemini IA', 'Gemini IA'],
  ['🔥 Negócios', 'Negócios'],
  ['💰 Gerar PIX', 'Gerar PIX'],
  ['🗓️ Agendamentos', 'Agendamentos'],
  ['👥 Clientes', 'Clientes'],
  ['💬 Conversas', 'Conversas'],
  ['📊 Relatórios', 'Relatórios'],
  ['⚙️ Configurações', 'Configurações'],
  ['🤖 Gemini IA', 'Gemini IA'],
  ['🔥 Negócios em aberto.', 'Negócios em aberto.'],
  ['💬 Conversas', 'Conversas'],
  ['👥 Clientes', 'Clientes'],
  ['📊 Relatórios', 'Relatórios'],
  ['🔥 Negócios', 'Negócios'],

  // Card icons
  ['<span class="card-icon">🖥️</span>', '<span class="card-icon"><i data-lucide="monitor"></i></span>'],
  ['<span class="card-icon">📡</span>', '<span class="card-icon"><i data-lucide="radio"></i></span>'],
  ['<span class="card-icon">🤖</span>', '<span class="card-icon"><i data-lucide="bot"></i></span>'],
  ['<span class="card-icon">🚀</span>', '<span class="card-icon"><i data-lucide="send"></i></span>'],
  ['<span class="card-icon">🛡️</span>', '<span class="card-icon"><i data-lucide="shield"></i></span>'],
  ['<span class="card-icon">📋</span>', '<span class="card-icon"><i data-lucide="clipboard-list"></i></span>'],
  ['<span class="card-icon">⚙️</span>', '<span class="card-icon"><i data-lucide="settings"></i></span>'],
  ['<span class="card-icon">✍️</span>', '<span class="card-icon"><i data-lucide="pencil"></i></span>'],
  ['<span class="card-icon">📂</span>', '<span class="card-icon"><i data-lucide="folder-open"></i></span>'],
  ['<span class="card-icon">🔑</span>', '<span class="card-icon"><i data-lucide="key"></i></span>'],
  ['<span class="card-icon">📤</span>', '<span class="card-icon"><i data-lucide="upload"></i></span>'],
  ['<span class="card-icon">💬</span>', '<span class="card-icon"><i data-lucide="message-square"></i></span>'],
  ['<span class="card-icon">📊</span>', '<span class="card-icon"><i data-lucide="bar-chart-2"></i></span>'],
  ['<span class="card-icon">👤</span>', '<span class="card-icon"><i data-lucide="user"></i></span>'],
  ['<span class="card-icon">🧪</span>', '<span class="card-icon"><i data-lucide="flask-conical"></i></span>'],
  ['<span class="card-icon">📅</span>', '<span class="card-icon"><i data-lucide="calendar"></i></span>'],

  // Stat icons
  ['<span class="stat-icon">📤</span>', '<span class="stat-icon"><i data-lucide="upload"></i></span>'],
  ['<span class="stat-icon">❌</span>', '<span class="stat-icon"><i data-lucide="x-circle"></i></span>'],
  ['<span class="stat-icon">📈</span>', '<span class="stat-icon"><i data-lucide="trending-up"></i></span>'],
  ['<span class="stat-icon">🗓️</span>', '<span class="stat-icon"><i data-lucide="calendar"></i></span>'],

  // Empty state icons
  ['<span class="empty-icon">💬</span>', '<i data-lucide="message-square" class="empty-icon"></i>'],
  ['<span class="empty-icon">🔥</span>', '<i data-lucide="flame" class="empty-icon"></i>'],
  ['<span class="empty-icon">👥</span>', '<i data-lucide="users" class="empty-icon"></i>'],
  ['<span class="empty-icon">🗓️</span>', '<i data-lucide="calendar" class="empty-icon"></i>'],
  ['<span class="empty-icon">💳</span>', '<i data-lucide="credit-card" class="empty-icon"></i>'],

  // btn-eye icon
  ['<button class="btn-eye" data-target="cfgApiKey">👁</button>', '<button class="btn-eye" data-target="cfgApiKey"><i data-lucide="eye" style="width:14px;height:14px"></i></button>'],
  ['<button class="btn-eye" data-target="cfgGeminiKey">👁</button>', '<button class="btn-eye" data-target="cfgGeminiKey"><i data-lucide="eye" style="width:14px;height:14px"></i></button>'],
  ['<button class="btn-eye" data-target="cfgGeminiKey2">👁</button>', '<button class="btn-eye" data-target="cfgGeminiKey2"><i data-lucide="eye" style="width:14px;height:14px"></i></button>'],
  ['<button class="btn-eye" data-target="cfgGeminiKey3">👁</button>', '<button class="btn-eye" data-target="cfgGeminiKey3"><i data-lucide="eye" style="width:14px;height:14px"></i></button>'],
  ['<button class="btn-eye" data-target="cfgGeminiKey4">👁</button>', '<button class="btn-eye" data-target="cfgGeminiKey4"><i data-lucide="eye" style="width:14px;height:14px"></i></button>'],
  ['<button class="btn-eye" data-target="cfgGeminiKey5">👁</button>', '<button class="btn-eye" data-target="cfgGeminiKey5"><i data-lucide="eye" style="width:14px;height:14px"></i></button>'],
  ['<button class="btn-eye" data-target="cfgMpToken">👁</button>', '<button class="btn-eye" data-target="cfgMpToken"><i data-lucide="eye" style="width:14px;height:14px"></i></button>'],

  // Botões com emojis no texto
  ['💾 Salvar Tudo', 'Salvar Tudo'],
  ['💾 Salvar Configurações', 'Salvar Configurações'],
  ['💾 Salvar Tudo</button>', 'Salvar Tudo</button>'],
  ['🔌 Testar Conexão', 'Testar Conexão'],
  ['🔄 Resetar enviados', 'Resetar enviados'],
  ['💾 Salvar configurações do Gemini', 'Salvar configurações do Gemini'],
  ['🔍 Testar API Key', 'Testar API Key'],
  ['👁 Preview', 'Preview'],
  ['💾 Salvar Tudo</button>', 'Salvar Tudo</button>'],
  ['🗓️ Agendar Disparo', 'Agendar Disparo'],
  ['💰 Gerar PIX e Enviar pelo WhatsApp', 'Gerar PIX e Enviar pelo WhatsApp'],
  ['💰 Gerar PIX', 'Gerar PIX'],
  ['+ Novo Agendamento', '+ Novo Agendamento'],
  ['🔗 Reconfigurar', 'Reconfigurar'],
  ['⏸️ Pausado', 'Pausado'],
  ['✨ Ativo', 'Ativo'],

  // Modal titles
  ['👁 Preview da Mensagem', 'Preview da Mensagem'],
  ['💰 Gerar Cobrança PIX', 'Gerar Cobrança PIX'],
  ['👤 Editar Cliente', 'Editar Cliente'],
  ['🧪 Teste Manual da IA', 'Teste Manual da IA'],
  ['🗓️ Novo Agendamento', 'Novo Agendamento'],

  // Checklist items — troca emoji por SVG inline limpo
  ['✅ Delay aleatório entre envios', '<i data-lucide="check-circle-2" style="width:14px;height:14px;color:var(--success);display:inline;margin-right:6px"></i>Delay aleatório entre envios'],
  ['✅ Presença "digitando..." simulada', '<i data-lucide="check-circle-2" style="width:14px;height:14px;color:var(--success);display:inline;margin-right:6px"></i>Presença "digitando..." simulada'],
  ['✅ 126+ variações de mensagem', '<i data-lucide="check-circle-2" style="width:14px;height:14px;color:var(--success);display:inline;margin-right:6px"></i>126+ variações de mensagem'],
  ['✅ Nunca envia 2x pro mesmo número', '<i data-lucide="check-circle-2" style="width:14px;height:14px;color:var(--success);display:inline;margin-right:6px"></i>Nunca envia 2x pro mesmo número'],
  ['⚠️ Limite recomendado: 100 msg/dia', '<i data-lucide="alert-triangle" style="width:14px;height:14px;color:var(--warn);display:inline;margin-right:6px"></i>Limite recomendado: 100 msg/dia'],

  // Misc restantes no HTML
  ['🔗 Config Webhook', 'Config Webhook'],
  ['↻ Verificar', '↻ Verificar'],
  ['↻ Testar', '↻ Testar'],
  ['⚡ Aguardando início do disparo...', 'Aguardando início do disparo...'],
  ['🔄 O bot alterna automaticamente', 'O bot alterna automaticamente'],
  ['💡 Dicas de prompt:', 'Dicas de prompt:'],

  // Terminal placeholder
  ['<span>⚡ Aguardando início do disparo...</span>', '<span>Aguardando início do disparo...</span>'],

  // Seção PIX  
  ['<span class="card-icon">✅</span>', '<span class="card-icon"><i data-lucide="check-circle-2"></i></span>'],
];

// Aplica todas as substituições
for (const [from, to] of map) {
  html = html.split(from).join(to);
}

// Remove emojis soltos que sobraram (não em botões ou títulos) — passa uma limpeza final
// Lista de emojis que podem ter sobrado em outros lugares
const emojisSoltos = [
  '🔥','💰','🗓️','👥','💬','📊','⚙️','🤖','📡','📂','📱','✨',
  '🚀','✍️','🎛️','📲','🔌','💾','👁','🔍','🔗','⚡','💡',
  '📤','❌','📈','📋','🛡️','🔑','👤','🧪','📄','📅','✅','⚠️',
];

// Apenas remove emojis de page-title que ainda sobraram
html = html.replace(/<h1 class="page-title">([^<]*)<\/h1>/g, (match, text) => {
  let clean = text;
  for (const e of emojisSoltos) clean = clean.split(e).join('').trim();
  return `<h1 class="page-title">${clean}</h1>`;
});

// Adiciona inicialização do Lucide antes do fechamento do body
if (!html.includes('lucide.createIcons()')) {
  html = html.replace(
    '<script src="app.js"></script>',
    `<script>document.addEventListener('DOMContentLoaded', () => lucide.createIcons());</script>\n<script src="app.js"></script>`
  );
}

fs.writeFileSync(file, html, 'utf-8');
console.log('✅ Emojis substituídos por ícones Lucide!');
