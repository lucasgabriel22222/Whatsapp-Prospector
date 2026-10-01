// =============================================
// app.js — Frontend do Painel WhatsApp Prospector
// Upload CSV, disparo, logs em tempo real via SSE
// =============================================

// ---- Estado do frontend ----
const state = {
  leadsCarregados: 0,
  disparoRodando:  false,
  sseConexao:      null,
};

// Navegação entre seções — substituída pela versão unificada abaixo (navegarPara)

// =============================================
// TOAST NOTIFICATIONS
// =============================================
function toast(msg, tipo = 'success', duracao = 3500) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideOut 0.25s ease forwards';
    setTimeout(() => el.remove(), 250);
  }, duracao);
}

// =============================================
// STATUS WHATSAPP (polling a cada 15s)
// =============================================
async function verificarStatus() {
  const dot   = document.getElementById('waStatusDot');
  const label = document.getElementById('waStatusLabel');
  const inst  = document.getElementById('waInstance');

  dot.className = 'status-dot checking';
  label.textContent = 'Verificando...';

  try {
    const res  = await fetch('/api/status');
    const data = await res.json();
    const ok   = data?.conexao?.conectado;

    dot.className   = `status-dot ${ok ? 'online' : 'offline'}`;
    label.textContent = ok ? 'Conectado' : 'Desconectado';
    inst.textContent  = data?.conexao?.estado || '';
  } catch {
    dot.className    = 'status-dot offline';
    label.textContent = 'Servidor off';
  }
}

verificarStatus();
setInterval(verificarStatus, 15000);

// =============================================
// UPLOAD CSV — DRAG & DROP + INPUT
// =============================================
const dropZone  = document.getElementById('dropZone');
const csvInput  = document.getElementById('csvInput');

dropZone.addEventListener('click', () => csvInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processarCSV(file);
});
csvInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) processarCSV(file);
});

document.getElementById('btnTrocarCsv').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('csvPreview').classList.add('hidden');
  document.getElementById('dropContent').classList.remove('hidden');
  document.getElementById('dropZone').style.display = '';
  state.leadsCarregados = 0;
  atualizarBotaoIniciar();
  csvInput.value = '';
});

async function processarCSV(file) {
  if (!file.name.endsWith('.csv')) {
    toast('Selecione um arquivo .csv', 'error'); return;
  }

  const dropContent = document.getElementById('dropContent');
  dropContent.innerHTML = '<span class="drop-icon">⏳</span><p class="drop-title">Carregando...</p>';

  const formData = new FormData();
  formData.append('csv', file);

  try {
    const res  = await fetch('/api/upload-csv', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      toast(`Erro: ${data.erro}`, 'error');
      resetDropZone();
      return;
    }

    // Mostra preview
    state.leadsCarregados = data.total;
    document.getElementById('dropZone').style.display = 'none';
    mostrarPreviewCSV(data);
    atualizarBotaoIniciar();
    atualizarEstimativa();

    toast(`✅ ${data.total} leads carregados! ${data.invalidos > 0 ? `(${data.invalidos} inválidos)` : ''}`, 'success');

  } catch (err) {
    toast(`Erro ao enviar arquivo: ${err.message}`, 'error');
    resetDropZone();
  }
}

function resetDropZone() {
  document.getElementById('dropContent').innerHTML = `
    <span class="drop-icon">📄</span>
    <p class="drop-title">Arraste o CSV aqui</p>
    <p class="drop-sub">ou clique para selecionar</p>
    <p class="drop-hint">Colunas necessárias: <code>title</code>, <code>phone</code></p>
  `;
  document.getElementById('dropZone').style.display = '';
}

function mostrarPreviewCSV(data) {
  const preview = document.getElementById('csvPreview');
  const tbody   = document.getElementById('leadsTableBody');
  const count   = document.getElementById('previewCount');

  count.textContent = `${data.total} leads prontos para envio`;

  tbody.innerHTML = '';
  data.amostra.forEach((lead, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td title="${lead.title}">${lead.title?.substring(0, 30) || '—'}</td>
      <td><code>${lead.phone}</code></td>
      <td>${lead.category?.substring(0, 20) || '—'}</td>
      <td><span class="status-pill status-${lead.status || 'pendente'}">${lead.status || 'pendente'}</span></td>
    `;
    tbody.appendChild(tr);
  });

  if (data.total > 5) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="5" style="text-align:center;color:var(--text3);font-size:12px;padding:10px">
      + ${data.total - 5} leads não exibidos
    </td>`;
    tbody.appendChild(tr);
  }

  preview.classList.remove('hidden');
  document.getElementById('dropContent').classList.add('hidden');
}

// =============================================
// ESTIMATIVA DE TEMPO
// =============================================
function atualizarEstimativa() {
  const min    = parseInt(document.getElementById('cfgDelayMin').value) || 45;
  const max    = parseInt(document.getElementById('cfgDelayMax').value) || 90;
  const limite = parseInt(document.getElementById('cfgLimite').value)   || 0;
  const total  = limite > 0 ? Math.min(limite, state.leadsCarregados) : state.leadsCarregados;
  const box    = document.getElementById('estimateBox');

  if (total === 0) { box.textContent = '—'; return; }

  const mediaDelay = (min + max) / 2;
  const totalSeg   = Math.round(total * mediaDelay);
  const horas      = Math.floor(totalSeg / 3600);
  const minutos    = Math.floor((totalSeg % 3600) / 60);
  const segundos   = totalSeg % 60;

  let tempo = '';
  if (horas > 0)   tempo += `${horas}h `;
  if (minutos > 0) tempo += `${minutos}min `;
  if (!horas)      tempo += `${segundos}s`;

  box.textContent = `~${tempo.trim()} (${total} msgs)`;
}

['cfgDelayMin', 'cfgDelayMax', 'cfgLimite'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', atualizarEstimativa);
});

// =============================================
// BOTÃO INICIAR
// =============================================
function atualizarBotaoIniciar() {
  const btn = document.getElementById('btnIniciar');
  btn.disabled = state.leadsCarregados === 0 || state.disparoRodando;
}

document.getElementById('btnIniciar').addEventListener('click', async () => {
  const delayMin = parseInt(document.getElementById('cfgDelayMin').value);
  const delayMax = parseInt(document.getElementById('cfgDelayMax').value);
  const limite   = parseInt(document.getElementById('cfgLimite').value);

  if (delayMin >= delayMax) {
    toast('Delay mínimo deve ser menor que o máximo', 'warn'); return;
  }

  try {
    const res  = await fetch('/api/iniciar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delayMin, delayMax, limite }),
    });
    const data = await res.json();

    if (!res.ok) {
      toast(`❌ ${data.erro}`, 'error'); return;
    }

    state.disparoRodando = true;
    document.getElementById('btnIniciar').classList.add('hidden');
    document.getElementById('btnParar').classList.remove('hidden');
    document.getElementById('terminal').innerHTML = '';
    toast('🚀 Disparo iniciado!', 'success');

  } catch (err) {
    toast(`Erro: ${err.message}`, 'error');
  }
});

document.getElementById('btnParar').addEventListener('click', async () => {
  if (!confirm('Deseja realmente parar o disparo?')) return;
  try {
    await fetch('/api/parar', { method: 'POST' });
    toast('⏹️ Disparo interrompido.', 'warn');
  } catch (err) {
    toast(`Erro: ${err.message}`, 'error');
  }
});

// =============================================
// SSE — LOGS EM TEMPO REAL
// =============================================
function conectarSSE() {
  if (state.sseConexao) state.sseConexao.close();

  const es = new EventSource('/api/stream');
  state.sseConexao = es;

  es.onmessage = (e) => {
    try {
      const evento = JSON.parse(e.data);
      tratarEvento(evento);
    } catch {}
  };

  es.onerror = () => {
    setTimeout(conectarSSE, 3000); // reconecta em 3s
  };
}

function tratarEvento(ev) {
  if (ev.tipo === 'estado_inicial') {
    sincronizarEstado(ev.dados);
    return;
  }

  // Adiciona linha no terminal de disparo
  adicionarLogTerminal(ev.tipo, ev.mensagem, ev.ts);
  // Adiciona no terminal de controle
  adicionarLogControle(ev.tipo, ev.mensagem, ev.ts);

  // Sincroniza estado do disparo
  if (ev.dados?.estado) sincronizarEstado(ev.dados.estado);

  // Notificação especial para negócio novo
  if (ev.tipo === 'negocio_novo') {
    const nome    = ev.dados?.nome || 'Lead';
    const phone   = ev.dados?.phone || '';
    const urgente = ev.dados?.urgente || false;
    const tipo    = ev.dados?.tipo || '';

    // Toast permanente para handover urgente
    if (urgente || tipo === 'handover') {
      mostrarAlertaHandover(nome, phone);
    } else {
      toast(`🔥 Novo negócio: ${nome}`, 'success', 6000);
    }

    if (typeof atualizarBadgesNav === 'function') atualizarBadgesNav();
  }
}

function sincronizarEstado(estado) {
  if (!estado) return;

  // Badges
  document.getElementById('badgeTotal').textContent    = `${estado.total || 0} leads`;
  document.getElementById('badgeEnviados').textContent = `${estado.enviados || 0} enviados`;
  document.getElementById('badgeErros').textContent    = `${estado.erros || 0} erros`;

  // Progresso
  const pct     = estado.progresso || 0;
  const enviados = estado.enviados || 0;
  const erros    = estado.erros    || 0;
  const total    = estado.total    || 0;

  document.getElementById('progressFill').style.width = `${pct}%`;
  document.getElementById('progressPct').textContent  = `${pct}%`;

  if (estado.rodando && estado.atual) {
    document.getElementById('progressLabel').textContent =
      `Enviando: ${estado.atual.nome || estado.atual.phone}`;
    document.getElementById('progressDetail').textContent =
      `${enviados + erros}/${total} processados — ${enviados} ✓ ${erros} ✗`;
  } else if (!estado.rodando && total > 0) {
    document.getElementById('progressLabel').textContent = 'Finalizado';
    document.getElementById('progressDetail').textContent =
      `${enviados} enviados, ${erros} erros de ${total} total`;
  }

  // Botões
  state.disparoRodando = estado.rodando;
  if (estado.rodando) {
    document.getElementById('btnIniciar').classList.add('hidden');
    document.getElementById('btnParar').classList.remove('hidden');
  } else {
    document.getElementById('btnIniciar').classList.remove('hidden');
    document.getElementById('btnParar').classList.add('hidden');
    atualizarBotaoIniciar();
  }
}

// =============================================
// TERMINAL DE LOGS
// =============================================
const ICONES = {
  info:       '·',
  sucesso:    '✓',
  erro:       '✗',
  aviso:      '⚠',
  progresso:  '→',
};

function adicionarLogTerminal(tipo, mensagem, ts) {
  const terminal  = document.getElementById('terminal');
  const autoScroll = document.getElementById('chkAutoScroll').checked;

  // Remove placeholder
  const placeholder = terminal.querySelector('.terminal-placeholder');
  if (placeholder) placeholder.remove();

  const hora = ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const icone = ICONES[tipo] || '·';

  const div = document.createElement('div');
  div.className = `log-line ${tipo}`;
  div.innerHTML = `<span class="log-ts">${hora}</span><span class="log-msg">${escapeHtml(`${icone} ${mensagem}`)}</span>`;
  terminal.appendChild(div);

  // Limita 500 linhas
  while (terminal.children.length > 500) terminal.removeChild(terminal.firstChild);

  if (autoScroll) terminal.scrollTop = terminal.scrollHeight;
}

function escapeHtml(str) {
  return escHtml(str);
}

document.getElementById('btnLimparLog').addEventListener('click', () => {
  document.getElementById('terminal').innerHTML =
    '<div class="terminal-placeholder"><span>⚡ Log limpo.</span></div>';
});

// =============================================
// RELATÓRIOS
// =============================================
async function carregarRelatorios() {
  try {
    const res  = await fetch('/api/relatorios');
    const data = await res.json();

    const tbody = document.getElementById('relTableBody');
    tbody.innerHTML = '';

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Nenhuma sessão ainda</td></tr>';
      return;
    }

    // Cards de totais
    const totalEnviados = data.reduce((a, r) => a + (r.sucesso || 0), 0);
    const totalErros    = data.reduce((a, r) => a + (r.erro    || 0), 0);
    const taxaMedia     = totalEnviados + totalErros > 0
      ? ((totalEnviados / (totalEnviados + totalErros)) * 100).toFixed(1) + '%' : '—';

    document.getElementById('statTotalEnviados').textContent = totalEnviados;
    document.getElementById('statTotalErros').textContent    = totalErros;
    document.getElementById('statTaxaMedia').textContent     = taxaMedia;
    document.getElementById('statSessoes').textContent       = data.length;

    data.forEach(r => {
      const duracao = r.duracao_s ? `${Math.floor(r.duracao_s/60)}m${r.duracao_s%60}s` : '—';
      const taxa    = parseFloat(r.taxa_ok) || 0;
      const corTaxa = taxa >= 80 ? '#4ade80' : taxa >= 50 ? '#fcd34d' : '#f87171';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatarData(r.sessao)}</td>
        <td>${r.total}</td>
        <td style="color:#4ade80">${r.sucesso}</td>
        <td style="color:#f87171">${r.erro}</td>
        <td style="color:${corTaxa};font-weight:600">${r.taxa_ok}</td>
        <td style="color:var(--text3)">${duracao}</td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    toast(`Erro ao carregar relatórios: ${err.message}`, 'error');
  }
}

document.getElementById('btnAtualizarRel').addEventListener('click', carregarRelatorios);

// =============================================
// CONVERSAS — Grid + Painel lateral de histórico
// =============================================
let _conversasCache  = {};   // cache local { phone: convObj }
let _chatPhoneAtual  = null; // número da conversa aberta no painel

async function carregarConversas(filtro = '') {
  const grid = document.getElementById('conversasGrid');
  grid.innerHTML = '<div class="empty-state"><span class="empty-icon">⏳</span><p>Carregando...</p></div>';

  try {
    const res  = await fetch('/api/conversas');
    const data = await res.json();
    _conversasCache = data;
    renderizarGridConversas(filtro);
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><span class="empty-icon">❌</span><p>Erro ao carregar conversas</p></div>`;
  }
}

function renderizarGridConversas(filtro = '') {
  const grid  = document.getElementById('conversasGrid');
  let convs   = Object.entries(_conversasCache);

  // Filtra por busca
  if (filtro.trim()) {
    const q = filtro.toLowerCase();
    convs = convs.filter(([num, c]) =>
      num.includes(q) || (c.analise?.resumo || '').toLowerCase().includes(q)
    );
  }

  if (convs.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">&#128172;</span>
        <p>${filtro ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda.'}</p>
        <p class="empty-sub">${filtro ? 'Tente outro termo de busca.' : 'As conversas aparecerão aqui quando o listener estiver ativo.'}</p>
      </div>`;
    return;
  }

  // Ordena por atividade mais recente
  convs.sort((a, b) => new Date(b[1].ultima_atividade) - new Date(a[1].ultima_atividade));

  grid.innerHTML = '';
  convs.forEach(([numero, conv]) => {
    const analise   = conv.analise || {};
    const temp      = analise.temperatura || 'frio';
    const ultimaMsg = conv.historico?.[conv.historico.length - 1];
    const iconeTemp = { quente: '&#128293;', morno: '&#127777;', frio: '&#10052;' }[temp] || '&#10052;';
    const numMsgs   = conv.historico?.length || 0;

    const card = document.createElement('div');
    card.className = `conversa-card ${temp}${numero === _chatPhoneAtual ? ' selecionado' : ''}`;
    card.dataset.phone = numero;
    card.innerHTML = `
      <div class="conv-header">
        <span class="conv-nome">${escHtml(analise.resumo ? analise.resumo.substring(0, 28) : 'Lead')}</span>
        <span class="conv-temp" title="${temp}">${iconeTemp}</span>
      </div>
      <div class="conv-phone">${numero}</div>
      <div class="conv-ultima">${ultimaMsg ? escHtml((ultimaMsg.texto || '').substring(0, 80)) : 'Sem mensagens'}</div>
      <div class="conv-meta">
        <span>${numMsgs} msg</span>
        <span>${formatarDataCurta(conv.ultima_atividade)}</span>
      </div>
    `;
    card.addEventListener('click', () => abrirChatPanel(numero, conv));
    grid.appendChild(card);
  });
}

// ---- Abre o painel lateral com o histórico completo ----
async function abrirChatPanel(phone, convData) {
  _chatPhoneAtual = phone;

  // Atualiza seleção visual
  document.querySelectorAll('.conversa-card').forEach(c =>
    c.classList.toggle('selecionado', c.dataset.phone === phone));

  const panel = document.getElementById('chatPanel');
  panel.classList.remove('hidden');

  // Cabeçalho
  const analise = convData.analise || {};
  const temp    = analise.temperatura || 'frio';
  document.getElementById('chatPanelNome').textContent  = analise.resumo || 'Lead';
  document.getElementById('chatPanelPhone').textContent = phone;

  const tempBadge = document.getElementById('chatTempBadge');
  const tempLabel = { quente: '&#128293; Quente', morno: '&#9728; Morno', frio: '&#10052; Frio' };
  tempBadge.innerHTML  = tempLabel[temp] || '&#10052; Frio';
  tempBadge.className  = `chat-temp-badge ${temp}`;

  // Meta info
  const numMsgs  = convData.historico?.length || 0;
  const ultimaAt = convData.ultima_atividade ? formatarData(convData.ultima_atividade) : '—';
  const status   = convData.status || 'ativo';
  document.getElementById('chatPanelMeta').innerHTML = `
    <div class="chat-meta-item"><span class="chat-meta-label">Mensagens</span><span class="chat-meta-value">${numMsgs}</span></div>
    <div class="chat-meta-item"><span class="chat-meta-label">Última atividade</span><span class="chat-meta-value">${ultimaAt}</span></div>
    <div class="chat-meta-item"><span class="chat-meta-label">Status</span><span class="chat-meta-value">${status}</span></div>
    ${analise.topicos ? `<div class="chat-meta-item"><span class="chat-meta-label">Tópicos</span><span class="chat-meta-value">${escHtml(analise.topicos)}</span></div>` : ''}
  `;

  // Mensagens
  renderizarMensagens(convData.historico || []);

  // Rodapé
  document.getElementById('chatFooterInfo').textContent =
    `${numMsgs} mensagens · ${analise.resumo || phone}`;

  // Configura botões do painel
  document.getElementById('btnChatRetomar').onclick = async () => {
    const r = await fetch('/api/conversas/retomar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    if (r.ok) {
      toast(`Bot retomado para ${phone}`, 'success');
      adicionarLogControle('sucesso', `Bot retomado para ${phone}`, new Date().toISOString());
    } else toast('Erro ao retomar bot', 'error');
  };

  document.getElementById('btnChatResetar').onclick = async () => {
    if (!confirm(`Apagar histórico da conversa com ${phone}?`)) return;
    const r = await fetch('/api/conversas/resetar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    if (r.ok) {
      toast('Conversa resetada.', 'warn');
      delete _conversasCache[phone];
      fecharChatPanel();
      renderizarGridConversas(document.getElementById('conversasBusca')?.value || '');
    } else toast('Erro ao resetar', 'error');
  };
}

function renderizarMensagens(historico) {
  const container = document.getElementById('chatMessages');
  container.innerHTML = '';

  if (!historico.length) {
    container.innerHTML = '<div class="chat-loading">Sem mensagens nesta conversa.</div>';
    return;
  }

  let ultimaData = '';
  historico.forEach(msg => {
    // Separador de data
    const dataMsg = msg.ts ? new Date(msg.ts).toLocaleDateString('pt-BR') : '';
    if (dataMsg && dataMsg !== ultimaData) {
      const sep = document.createElement('div');
      sep.className = 'chat-date-sep';
      sep.textContent = dataMsg;
      container.appendChild(sep);
      ultimaData = dataMsg;
    }

    const div = document.createElement('div');
    // role: 'user' = mensagem do lead, 'assistant'/'bot' = resposta do bot
    const isBot = msg.role === 'assistant' || msg.role === 'bot' || msg.de === 'bot';
    div.className = `chat-msg ${isBot ? 'enviada' : 'recebida'}`;

    const hora = msg.ts ? new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const texto = msg.texto || msg.content || msg.mensagem || '';

    div.innerHTML = `
      ${!isBot ? '<div class="chat-msg-sender">Lead</div>' : '<div class="chat-msg-sender" style="color:#25d366">Bot</div>'}
      <div class="chat-msg-text">${formatarWhatsApp(texto)}</div>
      <div class="chat-msg-footer">
        <span>${hora}</span>
        ${isBot ? '<span>&#10003;&#10003;</span>' : ''}
      </div>
    `;
    container.appendChild(div);
  });

  // Scroll para o fim
  container.scrollTop = container.scrollHeight;
}

function fecharChatPanel() {
  _chatPhoneAtual = null;
  document.getElementById('chatPanel').classList.add('hidden');
  document.querySelectorAll('.conversa-card').forEach(c => c.classList.remove('selecionado'));
}

document.getElementById('btnFecharChat')?.addEventListener('click', fecharChatPanel);
document.getElementById('btnAtualizarConversas').addEventListener('click', () =>
  carregarConversas(document.getElementById('conversasBusca')?.value || '')
);

// Busca em tempo real
document.getElementById('conversasBusca')?.addEventListener('input', (e) => {
  renderizarGridConversas(e.target.value);
});

// Testar conexão — tratado em carregarConfiguracoes / btnTestarConexao abaixo

// =============================================
// CONFIGURAÇÕES — Carregar e salvar do .env
// =============================================
async function carregarConfiguracoes() {
  try {
    const res  = await fetch('/api/config/env');
    const data = await res.json();

    document.getElementById('cfgApiUrl').value         = data.EVOLUTION_API_URL       || '';
    document.getElementById('cfgApiKey').value         = data.EVOLUTION_API_KEY_REAL  || '';
    document.getElementById('cfgInstance').value       = data.EVOLUTION_INSTANCE      || '';
    document.getElementById('cfgGeminiKey').value      = data.GEMINI_API_KEY_1_REAL   || '';
    document.getElementById('cfgGeminiKey2')?.setAttribute('value', data.GEMINI_API_KEY_2_REAL || '');
    document.getElementById('cfgGeminiKey3')?.setAttribute('value', data.GEMINI_API_KEY_3_REAL || '');
    document.getElementById('cfgGeminiKey4')?.setAttribute('value', data.GEMINI_API_KEY_4_REAL || '');
    document.getElementById('cfgGeminiKey5')?.setAttribute('value', data.GEMINI_API_KEY_5_REAL || '');
    if (document.getElementById('cfgGeminiKey2')) document.getElementById('cfgGeminiKey2').value = data.GEMINI_API_KEY_2_REAL || '';
    if (document.getElementById('cfgGeminiKey3')) document.getElementById('cfgGeminiKey3').value = data.GEMINI_API_KEY_3_REAL || '';
    if (document.getElementById('cfgGeminiKey4')) document.getElementById('cfgGeminiKey4').value = data.GEMINI_API_KEY_4_REAL || '';
    if (document.getElementById('cfgGeminiKey5')) document.getElementById('cfgGeminiKey5').value = data.GEMINI_API_KEY_5_REAL || '';
    document.getElementById('cfgMpToken').value        = data.MERCADO_PAGO_REAL       || '';
    document.getElementById('cfgEnvDelayMin').value    = data.DELAY_MIN     || '45';
    document.getElementById('cfgEnvDelayMax').value    = data.DELAY_MAX     || '90';
    document.getElementById('cfgEnvLimite').value      = data.LIMITE_ENVIOS || '50';
    document.getElementById('cfgEnvWebhookPort').value = data.WEBHOOK_PORT  || '3001';

    const leadsEl = document.getElementById('cfgLeadsEnviados');
    if (leadsEl) leadsEl.textContent = `${data.totalChavesGemini || 0} chave(s) Gemini ativas`;

    atualizarContagemEnviados();
  } catch(err) {
    toast(`Erro ao carregar configurações: ${err.message}`, 'error');
  }
}

async function atualizarContagemEnviados() {
  try {
    const el = document.getElementById('cfgLeadsEnviados');
    if (!el) return;
    const res  = await fetch('/api/status');
    const data = await res.json();
    const chaves = data.chaves || 0;
    el.textContent = `${chaves} chave(s) Gemini ativas`;
  } catch {}
}

async function salvarConfiguracoes() {
  const btn = document.getElementById('btnSalvarConfig') || document.getElementById('btnSalvarConfigBottom');
  if (btn) { btn.textContent = '⏳ Salvando...'; btn.disabled = true; }
  try {
    const body = {
      EVOLUTION_API_URL:  document.getElementById('cfgApiUrl').value.trim(),
      EVOLUTION_API_KEY:  document.getElementById('cfgApiKey').value.trim(),
      EVOLUTION_INSTANCE: document.getElementById('cfgInstance').value.trim(),
      GEMINI_API_KEY_1:   document.getElementById('cfgGeminiKey').value.trim(),
      GEMINI_API_KEY_2:   document.getElementById('cfgGeminiKey2')?.value.trim() || '',
      GEMINI_API_KEY_3:   document.getElementById('cfgGeminiKey3')?.value.trim() || '',
      GEMINI_API_KEY_4:   document.getElementById('cfgGeminiKey4')?.value.trim() || '',
      GEMINI_API_KEY_5:   document.getElementById('cfgGeminiKey5')?.value.trim() || '',
      MERCADO_PAGO:       document.getElementById('cfgMpToken').value.trim(),
      DELAY_MIN:          document.getElementById('cfgEnvDelayMin').value,
      DELAY_MAX:          document.getElementById('cfgEnvDelayMax').value,
      LIMITE_ENVIOS:      document.getElementById('cfgEnvLimite').value,
      WEBHOOK_PORT:       document.getElementById('cfgEnvWebhookPort').value,
    };
    const res  = await fetch('/api/config/env', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      const msg = document.getElementById('saveMsg');
      msg?.classList.remove('hidden');
      setTimeout(() => msg?.classList.add('hidden'), 3000);
      toast('✅ Configurações salvas no .env!', 'success');
    } else {
      toast(`❌ ${data.erro}`, 'error');
    }
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
  finally {
    const btn2 = document.getElementById('btnSalvarConfig') || document.getElementById('btnSalvarConfigBottom');
    if (btn2) { btn2.textContent = '💾 Salvar Tudo'; btn2.disabled = false; }
  }
}

document.getElementById('btnSalvarConfig')?.addEventListener('click', salvarConfiguracoes);
document.getElementById('btnSalvarConfigBottom')?.addEventListener('click', salvarConfiguracoes);
document.getElementById('btnRecarregarEnv')?.addEventListener('click', () => { carregarConfiguracoes(); toast('↻ Recarregado', 'success'); });

// Botão de reset de leads
document.getElementById('btnResetLeads')?.addEventListener('click', async () => {
  if (!confirm('Resetar todos os leads enviados? Eles voltarão para "pendente" e poderão ser disparados novamente.')) return;
  const res  = await fetch('/api/leads/reset', { method: 'POST' });
  const data = await res.json();
  if (res.ok) {
    toast('🔄 Leads resetados! Agora pode disparar novamente.', 'success', 5000);
    atualizarContagemEnviados();
  } else {
    toast(`❌ ${data.erro}`, 'error');
  }
});

// Toggle mostrar/ocultar senha — inclui todos os campos com btn-eye
document.querySelectorAll('.btn-eye').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁' : '🙈';
  });
});
// Também inicializa novos botões adicionados dinamicamente
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-eye');
  if (!btn || btn.dataset.initialized) return;
  btn.dataset.initialized = '1';
  const input = document.getElementById(btn.dataset.target);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '🙈';
});

// Carregar configs ao entrar na aba — já tratado no navegarPara acima

// Testar conexão
document.getElementById('btnTestarConexao')?.addEventListener('click', async () => {
  const resultEl = document.getElementById('testResult');
  resultEl.textContent = 'Testando...';
  resultEl.className   = 'test-result';
  try {
    const res  = await fetch('/api/status');
    const data = await res.json();
    const ok   = data?.conexao?.conectado;
    resultEl.textContent = ok ? `✅ Conectado (${data.conexao.estado})` : `❌ Desconectado (${data.conexao.estado})`;
    resultEl.className   = `test-result ${ok ? 'ok' : 'err'}`;
  } catch {
    resultEl.textContent = '❌ Servidor não encontrado';
    resultEl.className   = 'test-result err';
  }
});
function formatarData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatarDataCurta(iso) {
  if (!iso) return '—';
  const d    = new Date(iso);
  const agora = new Date();
  const diff  = Math.floor((agora - d) / 1000);
  if (diff < 60)   return 'agora';
  if (diff < 3600) return `${Math.floor(diff/60)}min`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h`;
  return d.toLocaleDateString('pt-BR');
}

// =============================================
// ALERTA DE HANDOVER — notificação permanente
// =============================================
function mostrarAlertaHandover(nome, phone) {
  // Remove alerta anterior do mesmo número se existir
  document.getElementById(`alerta-${phone}`)?.remove();

  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.id = `alerta-${phone}`;
  el.className = 'toast alerta-handover';
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div>
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">🔥 Cliente quente!</div>
        <div style="font-size:13px"><strong>${escHtml(nome)}</strong> quer fechar negócio!</div>
        <div style="font-size:11px;color:#fca5a5;margin-top:3px">${phone}</div>
        <button onclick="navegarPara('negocios');this.closest('.alerta-handover').remove()"
          style="margin-top:8px;background:#ef4444;color:#fff;border:none;border-radius:6px;
                 padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">
          Ver em Negócios →
        </button>
      </div>
      <button onclick="this.closest('.alerta-handover').remove()"
        style="background:none;border:none;color:#fca5a5;font-size:18px;cursor:pointer;
               line-height:1;padding:0;flex-shrink:0">✕</button>
    </div>`;
  container.appendChild(el);

  // Toca som de notificação se disponível
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToConstantValue(0.001, ctx.currentTime + 0.4);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
  } catch {}
}
conectarSSE();
atualizarEstimativa();

// =============================================
// MENSAGENS — Editor de grupos e variações
// =============================================

let mensagensData = { config: {}, grupos: [] };


async function carregarMensagens() {
  try {
    const res  = await fetch('/api/mensagens');
    mensagensData = await res.json();
    renderizarConfigGeral();
    renderizarGrupos();
    atualizarBadgeCombinacoes();
  } catch (err) {
    toast(`Erro ao carregar mensagens: ${err.message}`, 'error');
  }
}

// ---- Config geral ----
function renderizarConfigGeral() {
  const cfg = mensagensData.config || {};
  document.getElementById('msgDelayEntreVariacoes').value = cfg.delayEntreVariacoes ?? 3;
  document.getElementById('msgVariavelNome').value        = cfg.variavelNome ?? '{empresa}';
  document.getElementById('msgSimularDigitacao').checked  = cfg.simularDigitacao !== false;
  document.getElementById('msgPersonalizarNome').checked  = cfg.personalizarNome !== false;
}

function lerConfigGeral() {
  return {
    delayEntreVariacoes: parseInt(document.getElementById('msgDelayEntreVariacoes').value) || 3,
    variavelNome:        document.getElementById('msgVariavelNome').value || '{empresa}',
    simularDigitacao:    document.getElementById('msgSimularDigitacao').checked,
    personalizarNome:    document.getElementById('msgPersonalizarNome').checked,
  };
}

// ---- Badge de combinações ----
function atualizarBadgeCombinacoes() {
  const grupos = mensagensData.grupos || [];
  const ativos = grupos.filter(g => g.ativo !== false);
  const total  = ativos.reduce((acc, g) => acc * Math.max(g.variacoes?.length || 1, 1), 1);
  document.getElementById('msgBadgeCombinacoes').textContent =
    `${total.toLocaleString('pt-BR')} combinações`;
}

// ---- Render todos os grupos ----
function renderizarGrupos() {
  const container = document.getElementById('gruposMensagens');
  container.innerHTML = '';
  (mensagensData.grupos || []).forEach((grupo, idx) => {
    container.appendChild(criarGrupoEl(grupo, idx));
  });
}

// ---- Cria elemento HTML de um grupo ----
function criarGrupoEl(grupo, idx) {
  const div = document.createElement('div');
  div.className = `grupo-card${grupo.collapsed ? ' collapsed' : ''}`;
  div.dataset.idx = idx;

  div.innerHTML = `
    <div class="grupo-header">
      <span class="grupo-drag" title="Arrastar">⠿</span>

      <label class="grupo-toggle" title="Ativar/desativar grupo">
        <input type="checkbox" class="gToggle" ${grupo.ativo !== false ? 'checked' : ''} />
        <span class="grupo-toggle-track"></span>
        <span class="grupo-toggle-thumb"></span>
      </label>

      <input class="grupo-nome-input" type="text" value="${escHtml(grupo.nome || '')}" placeholder="Nome do grupo" />
      <input class="grupo-desc-input" type="text" value="${escHtml(grupo.descricao || '')}" placeholder="Descrição (opcional)" />

      <div class="grupo-badges">
        <span class="grupo-count">${grupo.variacoes?.length || 0} variações</span>
      </div>

      <div class="grupo-actions">
        <button class="grupo-action-btn dup" title="Duplicar grupo">⧉</button>
        <button class="grupo-action-btn del" title="Remover grupo">✕</button>
        <span class="grupo-chevron">▾</span>
      </div>
    </div>

    <div class="grupo-body">
      <div class="variacoes-list" data-idx="${idx}"></div>
      <button class="btn-add-variacao">+ Adicionar variação</button>
    </div>
  `;

  // Renderiza variações
  const listaEl = div.querySelector('.variacoes-list');
  (grupo.variacoes || []).forEach((v, vi) => {
    listaEl.appendChild(criarVariacaoEl(v, idx, vi));
  });

  // Toggle colapso
  div.querySelector('.grupo-header').addEventListener('click', (e) => {
    if (['INPUT', 'BUTTON', 'SPAN'].includes(e.target.tagName) && e.target.tagName !== 'SPAN') return;
    if (e.target.classList.contains('grupo-chevron')) return;
    div.classList.toggle('collapsed');
    grupo.collapsed = div.classList.contains('collapsed');
  });
  div.querySelector('.grupo-chevron').addEventListener('click', () => {
    div.classList.toggle('collapsed');
    grupo.collapsed = div.classList.contains('collapsed');
  });

  // Toggle ativo
  div.querySelector('.gToggle').addEventListener('change', (e) => {
    mensagensData.grupos[idx].ativo = e.target.checked;
    atualizarBadgeCombinacoes();
  });

  // Nome
  div.querySelector('.grupo-nome-input').addEventListener('input', (e) => {
    mensagensData.grupos[idx].nome = e.target.value;
  });

  // Descrição
  div.querySelector('.grupo-desc-input').addEventListener('input', (e) => {
    mensagensData.grupos[idx].descricao = e.target.value;
  });

  // Duplicar grupo
  div.querySelector('.grupo-action-btn.dup').addEventListener('click', (e) => {
    e.stopPropagation();
    const copia = JSON.parse(JSON.stringify(mensagensData.grupos[idx]));
    copia.nome += ' (cópia)';
    copia.id   += '_copia_' + Date.now();
    mensagensData.grupos.splice(idx + 1, 0, copia);
    renderizarGrupos();
    atualizarBadgeCombinacoes();
  });

  // Remover grupo
  div.querySelector('.grupo-action-btn.del').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(`Remover o grupo "${grupo.nome}"?`)) return;
    mensagensData.grupos.splice(idx, 1);
    renderizarGrupos();
    atualizarBadgeCombinacoes();
  });

  // Adicionar variação
  div.querySelector('.btn-add-variacao').addEventListener('click', () => {
    mensagensData.grupos[idx].variacoes = mensagensData.grupos[idx].variacoes || [];
    mensagensData.grupos[idx].variacoes.push('');
    const vi = mensagensData.grupos[idx].variacoes.length - 1;
    listaEl.appendChild(criarVariacaoEl('', idx, vi));
    atualizarCountGrupo(div, idx);
    atualizarBadgeCombinacoes();
    // Foca no novo textarea
    const textareas = listaEl.querySelectorAll('.variacao-textarea');
    textareas[textareas.length - 1]?.focus();
  });

  return div;
}

// ---- Cria elemento de uma variação ----
function criarVariacaoEl(texto, grupoIdx, varIdx) {
  const wrap = document.createElement('div');
  wrap.className = 'variacao-item';
  wrap.dataset.vi = varIdx;

  wrap.innerHTML = `
    <span class="variacao-drag" title="Arrastar">⠿</span>
    <div style="flex:1;display:flex;flex-direction:column;gap:4px">
      <textarea class="variacao-textarea ${texto ? '' : 'empty'}" rows="3" placeholder="Digite a mensagem... Use {empresa} para personalizar">${escHtml(texto)}</textarea>
      <span class="variacao-num">${texto.length} caracteres</span>
    </div>
    <div class="variacao-actions">
      <button class="var-btn dup" title="Duplicar">⧉</button>
      <button class="var-btn del" title="Remover">✕</button>
    </div>
  `;

  const ta     = wrap.querySelector('.variacao-textarea');
  const numEl  = wrap.querySelector('.variacao-num');

  ta.addEventListener('input', () => {
    const val = ta.value;
    mensagensData.grupos[grupoIdx].variacoes[varIdx] = val;
    numEl.textContent = `${val.length} caracteres`;
    ta.classList.toggle('empty', !val.trim());
    // Atualiza count no header
    const grupoCard = document.querySelector(`.grupo-card[data-idx="${grupoIdx}"]`);
    if (grupoCard) atualizarCountGrupo(grupoCard, grupoIdx);
    atualizarBadgeCombinacoes();
  });

  // Duplicar variação
  wrap.querySelector('.var-btn.dup').addEventListener('click', () => {
    const val = ta.value;
    mensagensData.grupos[grupoIdx].variacoes.splice(varIdx + 1, 0, val);
    const grupoCard = document.querySelector(`.grupo-card[data-idx="${grupoIdx}"]`);
    const lista     = grupoCard?.querySelector('.variacoes-list');
    if (lista) {
      lista.innerHTML = '';
      mensagensData.grupos[grupoIdx].variacoes.forEach((v, vi) =>
        lista.appendChild(criarVariacaoEl(v, grupoIdx, vi)));
    }
    atualizarCountGrupo(grupoCard, grupoIdx);
    atualizarBadgeCombinacoes();
  });

  // Remover variação
  wrap.querySelector('.var-btn.del').addEventListener('click', () => {
    if (mensagensData.grupos[grupoIdx].variacoes.length <= 1) {
      toast('Cada grupo precisa ter pelo menos 1 variação', 'warn'); return;
    }
    mensagensData.grupos[grupoIdx].variacoes.splice(varIdx, 1);
    const grupoCard = document.querySelector(`.grupo-card[data-idx="${grupoIdx}"]`);
    const lista     = grupoCard?.querySelector('.variacoes-list');
    if (lista) {
      lista.innerHTML = '';
      mensagensData.grupos[grupoIdx].variacoes.forEach((v, vi) =>
        lista.appendChild(criarVariacaoEl(v, grupoIdx, vi)));
    }
    atualizarCountGrupo(grupoCard, grupoIdx);
    atualizarBadgeCombinacoes();
  });

  return wrap;
}

function atualizarCountGrupo(card, idx) {
  const qtd = mensagensData.grupos[idx]?.variacoes?.length || 0;
  const el  = card?.querySelector('.grupo-count');
  if (el) el.textContent = `${qtd} variações`;
}

// ---- Adicionar novo grupo ----
document.getElementById('btnAdicionarGrupo').addEventListener('click', () => {
  const novoGrupo = {
    id:        `grupo_${Date.now()}`,
    nome:      'Novo Grupo',
    descricao: 'Descrição do grupo',
    ativo:     true,
    variacoes: [''],
  };
  mensagensData.grupos.push(novoGrupo);
  const container = document.getElementById('gruposMensagens');
  container.appendChild(criarGrupoEl(novoGrupo, mensagensData.grupos.length - 1));
  atualizarBadgeCombinacoes();
  // Scroll para o novo grupo
  container.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
});

// ---- Salvar tudo ----
document.getElementById('btnSalvarMensagens').addEventListener('click', async () => {
  mensagensData.config = lerConfigGeral();
  try {
    const res = await fetch('/api/mensagens', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(mensagensData),
    });
    if (res.ok) {
      toast('✅ Mensagens salvas! O bot usará as novas variações.', 'success');
      atualizarBadgeCombinacoes();
    } else {
      const err = await res.json();
      toast(`Erro: ${err.erro}`, 'error');
    }
  } catch (err) {
    toast(`Erro: ${err.message}`, 'error');
  }
});

// =============================================
// PREVIEW DE MENSAGEM
// =============================================
document.getElementById('btnPreviewMsg').addEventListener('click', () => {
  document.getElementById('modalPreview').classList.remove('hidden');
  gerarPreview();
});
document.getElementById('btnFecharPreview').addEventListener('click', () => {
  document.getElementById('modalPreview').classList.add('hidden');
});
document.getElementById('modalPreview').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});
document.getElementById('btnGerarPreview').addEventListener('click', gerarPreview);

function gerarPreview() {
  const empresa  = document.getElementById('previewNomeEmpresa').value || 'Empresa Exemplo';
  const bubblesEl = document.getElementById('msgBubbles');
  const infoEl    = document.getElementById('previewInfo');
  bubblesEl.innerHTML = '';

  const grupos  = (mensagensData.grupos || []).filter(g => g.ativo !== false && g.variacoes?.length > 0);
  const varNome = mensagensData.config?.variavelNome || '{empresa}';
  let totalChars = 0;
  let totalMsgs  = 0;

  grupos.forEach(grupo => {
    const variacoes = grupo.variacoes.filter(v => v.trim());
    if (!variacoes.length) return;

    // Sorteia uma variação aleatória
    const texto = variacoes[Math.floor(Math.random() * variacoes.length)];
    const textoFinal = texto.replace(new RegExp(escapeRegex(varNome), 'g'), `*${empresa}*`);

    totalChars += textoFinal.length;
    totalMsgs++;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = `
      <div class="msg-bubble-grupo">${escHtml(grupo.nome)}</div>
      <div class="msg-bubble-text">${formatarWhatsApp(textoFinal)}</div>
      <div class="msg-bubble-meta">
        <span>${new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</span>
        <span>✓✓</span>
      </div>
    `;
    bubblesEl.appendChild(bubble);
  });

  if (totalMsgs === 0) {
    bubblesEl.innerHTML = '<p style="color:var(--text3);text-align:center;padding:20px">Nenhum grupo ativo com variações.</p>';
    return;
  }

  const delay   = mensagensData.config?.delayEntreVariacoes || 3;
  const delayTotal = ((totalMsgs - 1) * delay);

  infoEl.innerHTML = `
    📨 <strong>${totalMsgs}</strong> mensagens por lead &nbsp;·&nbsp;
    ⏱️ Delay entre msgs: <strong>${delay}s</strong> &nbsp;·&nbsp;
    ⏳ Tempo p/ lead: ~<strong>${delayTotal}s</strong> &nbsp;·&nbsp;
    📝 <strong>${totalChars}</strong> chars total
  `;
}

// Converte *negrito* para <b> e \n para <br>
function formatarWhatsApp(texto) {
  return escHtml(texto)
    .replace(/\*(.*?)\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================
// CONTROLE — Painel de processos
// =============================================

// Seção controle é a inicial agora
document.querySelectorAll('.nav-item').forEach(item => {
  item.classList.toggle('active', item.dataset.section === 'controle');
});
document.querySelectorAll('.section').forEach(s => {
  s.classList.toggle('active', s.id === 'section-controle');
});

// Navegação unificada com callbacks
function navegarPara(secao) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === secao));
  document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === `section-${secao}`));
  if (secao === 'controle')        carregarDashboardStats();
  if (secao === 'relatorios')      carregarRelatorios();
  if (secao === 'conversas')       carregarConversas();
  if (secao === 'negocios')        carregarNegocios();
  if (secao === 'clientes')        carregarClientes();
  if (secao === 'gemini')          carregarConfigGemini();
  if (secao === 'mensagens')       carregarMensagens();
  if (secao === 'configuracoes')   carregarConfiguracoes();
  if (secao === 'agendamento')     carregarAgendamentos();
  if (secao === 'scraper')         iniciarSecaoScraper();
  if (secao === 'meus-leads')      carregarPastasLeads();
}

// Substitui o listener de nav original pelo unificado
document.querySelectorAll('.nav-item').forEach(item => {
  // Remove listeners antigos clonando o elemento
  const clone = item.cloneNode(true);
  item.parentNode.replaceChild(clone, item);
  clone.addEventListener('click', e => { e.preventDefault(); navegarPara(clone.dataset.section); });
});

// ---- Polling de status para o painel de controle ----
async function atualizarStatusControle() {
  try {
    const res  = await fetch('/api/status');
    const data = await res.json();

    // WhatsApp
    const waOk = data.conexao?.conectado;
    setDot('waDot2',      waOk ? 'on' : 'off');
    setDot('waStatusDot', waOk ? 'online' : 'offline');
    const waMeta = document.getElementById('waMeta');
    if (waMeta) waMeta.textContent = waOk ? `Conectado — ${data.conexao.estado}` : `Desconectado (${data.conexao.estado})`;
    const waLabel = document.getElementById('waStatusLabel');
    if (waLabel) waLabel.textContent = waOk ? 'Conectado' : 'Desconectado';
    const waInst = document.getElementById('waInstance');
    if (waInst) waInst.textContent = data.conexao.estado || '';

    // Gemini + Listener (agora num card só)
    const gAtivo = data.gemini?.ativo;
    const lAtivo = data.listenerAtivo;
    const toggleCtrl = document.getElementById('toggleGeminiControle');
    if (toggleCtrl) toggleCtrl.checked = !!gAtivo;
    const geminiMeta = document.getElementById('geminiStatusMeta');
    if (geminiMeta) {
      if (gAtivo && lAtivo) geminiMeta.textContent = '✨ Ativo — respondendo leads automaticamente';
      else if (gAtivo && !lAtivo) geminiMeta.textContent = '⚠️ Gemini ativo mas listener iniciando...';
      else geminiMeta.textContent = '⏸️ Pausado — não responde';
    }

    // Disparo
    const est = data.estado;
    const dRodando = est?.rodando;
    setDot('disparoDot', dRodando ? 'on' : 'off');
    const disparoMeta = document.getElementById('disparoMeta');
    if (disparoMeta) disparoMeta.textContent = dRodando
      ? `Enviando: ${est.enviados || 0}/${est.total || 0}`
      : est?.total > 0 ? `Finalizado — ${est.enviados} enviados` : 'Parado';

    // Badges de negócios/clientes na nav
    atualizarBadgesNav();

  } catch { /* silencioso */ }
}

function setDot(id, estado) {
  const el = document.getElementById(id);
  if (el) { el.className = 'processo-status-dot'; el.classList.add(estado); }
}

atualizarStatusControle();
setInterval(atualizarStatusControle, 8000);

// Verifica health do listener a cada 10s e mostra no card
async function verificarHealthListener() {
  try {
    const res  = await fetch(`/api/listener/status`);
    const data = await res.json();
    const meta = document.getElementById('geminiStatusMeta');
    if (!meta) return;

    // Testa se o listener está de fato respondendo
    const healthRes = await fetch('/api/status');
    const status    = await healthRes.json();
    const gAtivo    = status.gemini?.ativo;
    const lAtivo    = status.listenerAtivo;

    if (gAtivo && lAtivo) {
      meta.textContent = `✨ Ativo — webhook na porta ${data.porta || 3001} · Aguardando mensagens`;
      meta.style.color = 'var(--accent)';
    } else if (gAtivo && !lAtivo) {
      meta.textContent = '⚠️ Gemini ativo mas listener não responde — reinicie o servidor';
      meta.style.color = 'var(--yellow)';
    } else {
      meta.textContent = '⏸️ Pausado — ligue o toggle para ativar';
      meta.style.color = 'var(--text3)';
    }
  } catch {}
}

verificarHealthListener();
setInterval(verificarHealthListener, 10000);

// ---- Listener: iniciar / parar (mantidos para compatibilidade) ----
document.getElementById('btnListenerIniciar')?.addEventListener('click', async () => {
  const res  = await fetch('/api/listener/iniciar', { method: 'POST' });
  const data = await res.json();
  toast(data.msg || (data.ok ? '✅ Listener iniciado!' : '❌ Erro'), data.ok ? 'success' : 'error');
  atualizarStatusControle();
});
document.getElementById('btnListenerParar')?.addEventListener('click', async () => {
  const res  = await fetch('/api/listener/parar', { method: 'POST' });
  const data = await res.json();
  toast(data.msg, data.ok ? 'warn' : 'error');
  atualizarStatusControle();
});
document.getElementById('btnConfigurarWebhook')?.addEventListener('click', async () => {
  const url = prompt('URL do webhook para configurar na Evolution API:', `http://localhost:3001/webhook`);
  if (!url) return;
  const res  = await fetch('/api/listener/configurar-webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  });
  const data = await res.json();
  toast(data.sucesso ? `✅ Webhook configurado!` : `❌ ${data.erro}`, data.sucesso ? 'success' : 'error');
});

// ---- Diagnóstico e Teste Manual ----
document.getElementById('btnDiagnostico')?.addEventListener('click', () => {
  toast('🔍 Diagnóstico ativo — responda uma mensagem no WhatsApp e veja o log abaixo', 'warn', 6000);
  adicionarLogControle('aviso', '🔍 MODO DIAGNÓSTICO: envie uma mensagem no WhatsApp agora e veja o evento chegando aqui', new Date().toISOString());
});

document.getElementById('btnTesteManual')?.addEventListener('click', () => {
  document.getElementById('modalTesteManual').classList.remove('hidden');
  document.getElementById('testeResultado').innerHTML = '';
});
document.getElementById('btnFecharTesteManual')?.addEventListener('click', () => {
  document.getElementById('modalTesteManual').classList.add('hidden');
});
document.getElementById('modalTesteManual')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

document.getElementById('btnResetarConversa')?.addEventListener('click', async () => {
  const numero = document.getElementById('testeNumero').value.trim().replace(/\D/g,'');
  if (!numero || numero.length < 10) { toast('Digite o número primeiro', 'warn'); return; }
  const res  = await fetch('/api/conversas/resetar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: numero }),
  });
  if (res.ok) {
    toast(`🔄 Conversa de ${numero} resetada — bot vai responder normalmente`, 'success');
    document.getElementById('testeResultado').innerHTML = '✅ Conversa resetada! Agora pode testar novamente.';
  } else toast('Erro ao resetar', 'error');
});

document.getElementById('btnEnviarTeste')?.addEventListener('click', async () => {
  const numero = document.getElementById('testeNumero').value.trim().replace(/\D/g,'');
  const texto  = document.getElementById('testeTexto').value.trim();
  if (!numero || numero.length < 10) { toast('Número inválido (use DDI+DDD+número)', 'warn'); return; }
  if (!texto) { toast('Digite uma mensagem', 'warn'); return; }

  const btn = document.getElementById('btnEnviarTeste');
  btn.textContent = '⏳ Processando...'; btn.disabled = true;

  try {
    const res  = await fetch('/api/listener/teste', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero, texto }),
    });
    const data = await res.json();
    const resEl = document.getElementById('testeResultado');
    if (res.ok) {
      resEl.innerHTML = `✅ ${data.msg}<br><span style="color:var(--text3);font-size:12px">Número: ${numero} · A resposta da IA aparecerá no log do painel em segundos.</span>`;
      toast('✅ Simulação enviada! Veja o log.', 'success', 5000);
    } else {
      resEl.innerHTML = `❌ ${data.erro}`;
      toast(`❌ ${data.erro}`, 'error');
    }
  } catch(err) {
    toast(`Erro: ${err.message}`, 'error');
  } finally {
    btn.textContent = '▶ Simular mensagem recebida'; btn.disabled = false;
  }
});

// ---- Toggle Gemini (no card de controle) ----
document.getElementById('toggleGeminiControle')?.addEventListener('change', async () => {
  const res  = await fetch('/api/gemini/toggle', { method: 'POST' });
  const data = await res.json();
  toast(data.ativo ? '✅ Gemini ativado!' : '⏸️ Gemini pausado.', data.ativo ? 'success' : 'warn');
  sincronizarToggleGemini(data.ativo);
  atualizarStatusControle();
});

document.getElementById('btnTestarWA')?.addEventListener('click', atualizarStatusControle);

// ---- Webhook status ----
async function verificarWebhook() {
  try {
    const res  = await fetch('/api/webhook/status');
    const data = await res.json();
    const dot  = document.getElementById('webhookDot');
    const meta = document.getElementById('webhookMeta');
    if (!dot || !meta) return;
    if (data.correto) {
      dot.className = 'processo-status-dot on';
      meta.textContent = `✅ Ativo — ${data.url_atual}`;
      meta.style.color = 'var(--accent)';
    } else if (data.configurado) {
      dot.className = 'processo-status-dot warn';
      meta.textContent = `⚠️ URL diferente: ${data.url_atual}`;
      meta.style.color = 'var(--yellow)';
    } else {
      dot.className = 'processo-status-dot off';
      meta.textContent = data.erro ? `❌ ${data.erro}` : '❌ Não configurado';
      meta.style.color = 'var(--red)';
    }
  } catch {
    const dot = document.getElementById('webhookDot');
    if (dot) dot.className = 'processo-status-dot off';
  }
}

document.getElementById('btnTestarWebhook')?.addEventListener('click', async () => {
  await verificarWebhook();
  toast('↻ Status do webhook atualizado', 'success');
});

document.getElementById('btnReconfigurarWebhook')?.addEventListener('click', async () => {
  const url = prompt('URL do webhook:', `http://localhost:3001/webhook`);
  if (!url) return;
  const res  = await fetch('/api/listener/configurar-webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  });
  const data = await res.json();
  toast(data.sucesso ? `✅ Webhook configurado: ${url}` : `❌ ${data.erro}`, data.sucesso ? 'success' : 'error', 6000);
  verificarWebhook();
});

verificarWebhook();
setInterval(verificarWebhook, 30000);

// ---- Terminal do controle também recebe SSE ----
function adicionarLogControle(tipo, mensagem, ts) {
  const terminal = document.getElementById('terminalControle');
  if (!terminal) return;
  const placeholder = terminal.querySelector('.terminal-placeholder');
  if (placeholder) placeholder.remove();
  const hora = ts ? new Date(ts).toLocaleTimeString('pt-BR') : '';
  const icones = { info:'·', sucesso:'✓', erro:'✗', aviso:'⚠', progresso:'→', negocio_novo:'🔥' };
  const div = document.createElement('div');
  div.className = `log-line ${tipo}`;
  div.innerHTML = `<span class="log-ts">${hora}</span><span class="log-msg">${escHtml(`${icones[tipo]||'·'} ${mensagem}`)}</span>`;
  terminal.appendChild(div);
  while (terminal.children.length > 200) terminal.removeChild(terminal.firstChild);
  terminal.scrollTop = terminal.scrollHeight;
}
document.getElementById('btnLimparLogControle')?.addEventListener('click', () => {
  document.getElementById('terminalControle').innerHTML = '';
});

// Injeta no SSE handler — negocio_novo dispara toast e atualiza badges


// =============================================
// BADGES NA NAV
// =============================================
async function atualizarBadgesNav() {
  try {
    const [negRes, cliRes] = await Promise.all([fetch('/api/negocios'), fetch('/api/clientes')]);
    const negocios = await negRes.json();
    const clientes = await cliRes.json();

    const negAbertos = negocios.filter(n => n.status !== 'cancelado' && n.status !== 'pago').length;
    const cliPendentes = clientes.filter(c => c.status !== 'entregue').length;

    const negBadge = document.getElementById('navBadgeNegocios');
    const cliBadge = document.getElementById('navBadgeClientes');
    if (negBadge) { negBadge.textContent = negAbertos || ''; negBadge.classList.toggle('visible', negAbertos > 0); }
    if (cliBadge) { cliBadge.textContent = cliPendentes || ''; cliBadge.classList.toggle('visible', cliPendentes > 0); }
  } catch {}
}
atualizarBadgesNav();
setInterval(atualizarBadgesNav, 30000);

// =============================================
// GEMINI — Configuração
// =============================================
const PROMPT_PADRAO = `Você é um atendente virtual chamado "Rafael" que representa uma empresa de desenvolvimento de sites e automações no WhatsApp.

════════════════════════════════════
REGRA ABSOLUTA — LEIA COM ATENÇÃO:
════════════════════════════════════

Você NUNCA deve:
- Falar preços, valores, orçamentos ou prazos de entrega
- Tentar fechar negócio ou negociar
- Oferecer reuniões, chamadas ou agendamentos
- Dar detalhes técnicos complexos sobre implementação

════════════════════════════════════
GATILHOS DE TRANSBORDO PARA HUMANO:
════════════════════════════════════

Se o cliente perguntar ou demonstrar QUALQUER uma dessas intenções:
- Preço / valor / quanto custa / quanto fica / orçamento
- "Quero contratar" / "Como faço pra fechar?" / "Gostei, o que faço agora?"
- "Como funciona a entrega?" / "Qual o prazo?"
- Qualquer sinal claro de interesse em contratar

FAÇA EXATAMENTE ISSO:
1. Responda com UMA mensagem curta e amigável passando para o humano:
   - "Que ótimo! Vou chamar o responsável pelo setor de projetos agora mesmo pra alinhar esse detalhe com você 👍"
   - "Perfeito! Deixa eu acionar o nosso especialista pra te passar todas as informações com calma 😊"
   - "Show! Vou te conectar com quem pode te dar todos os detalhes sobre isso agora 🚀"
2. Adicione [FECHAR_NEGOCIO] ao final (invisível para o cliente — é sinal interno).
3. PARE de responder esse cliente. Não envie mais nenhuma mensagem depois disso.

════════════════════════════════════
O QUE VOCÊ PODE FAZER:
════════════════════════════════════

✅ Confirmar que a empresa existe e é ativa
✅ Explicar superficialmente o que a empresa faz (sem preços):
   - "A gente cria sites profissionais, lojas virtuais e sistemas de automação"
✅ Responder dúvidas institucionais simples sobre tipos de serviço
✅ Ser simpático e manter o lead aquecido até o humano assumir

════════════════════════════════════
COMPORTAMENTO GERAL:
════════════════════════════════════

- Mensagens curtas (máximo 3 linhas)
- Tom casual e amigável, como um humano no WhatsApp
- Nunca mencione que é bot ou IA
- Se a mensagem for confusa, pergunte educadamente como pode ajudar`;

async function carregarConfigGemini() {
  try {
    const res  = await fetch('/api/gemini');
    const data = await res.json();
    const ta   = document.getElementById('geminiPrompt');
    if (ta) {
      ta.value = data.prompt || PROMPT_PADRAO;
      atualizarContadorPrompt();
    }
    sincronizarToggleGemini(data.ativo);
  } catch(err) { toast(`Erro ao carregar Gemini: ${err.message}`, 'error'); }
}

function sincronizarToggleGemini(ativo) {
  const t1 = document.getElementById('toggleGeminiPrincipal');
  const t2 = document.getElementById('toggleGeminiControle');
  const badge = document.getElementById('geminiStatusBadge');
  if (t1) t1.checked = !!ativo;
  if (t2) t2.checked = !!ativo;
  if (badge) {
    badge.textContent = ativo ? '✨ Ativo' : '⏸️ Pausado';
    badge.className   = `gemini-status-badge ${ativo ? 'on' : 'off'}`;
  }
}

function atualizarContadorPrompt() {
  const ta = document.getElementById('geminiPrompt');
  const el = document.getElementById('promptChars');
  if (ta && el) el.textContent = `${ta.value.length} caracteres`;
}

document.getElementById('geminiPrompt')?.addEventListener('input', atualizarContadorPrompt);

document.getElementById('toggleGeminiPrincipal')?.addEventListener('change', async () => {
  const res  = await fetch('/api/gemini/toggle', { method: 'POST' });
  const data = await res.json();
  toast(data.ativo ? '✅ Gemini ativado!' : '⏸️ Gemini pausado.', data.ativo ? 'success' : 'warn');
  sincronizarToggleGemini(data.ativo);
});

document.getElementById('btnPromptRestaurar')?.addEventListener('click', () => {
  if (!confirm('Restaurar o prompt padrão? O prompt atual será perdido.')) return;
  const ta = document.getElementById('geminiPrompt');
  if (ta) { ta.value = PROMPT_PADRAO; atualizarContadorPrompt(); }
});

document.getElementById('btnDiagnosticoGemini')?.addEventListener('click', async () => {
  const btn = document.getElementById('btnDiagnosticoGemini');
  btn.textContent = '⏳ Testando...'; btn.disabled = true;
  try {
    const res  = await fetch('/api/gemini/diagnostico');
    const data = await res.json();
    let msg = `API Key: ${data.apiKey}\n\n`;
    for (const [modelo, status] of Object.entries(data.modelos || {})) {
      msg += `${modelo}: ${status}\n`;
    }
    alert(msg);
    // Mostra no log do controle também
    for (const [modelo, status] of Object.entries(data.modelos || {})) {
      adicionarLogControle(status.startsWith('✅') ? 'sucesso' : 'erro', `Gemini [${modelo}]: ${status}`, new Date().toISOString());
    }
  } catch(err) {
    toast(`Erro: ${err.message}`, 'error');
  } finally {
    btn.textContent = '🔍 Testar API Key'; btn.disabled = false;
  }
});

document.getElementById('btnSalvarGemini')?.addEventListener('click', async () => {
  const prompt = document.getElementById('geminiPrompt')?.value;
  if (!prompt?.trim()) { toast('Prompt não pode ser vazio.', 'warn'); return; }
  const res  = await fetch('/api/gemini', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (res.ok) {
    const msg = document.getElementById('saveMsgGemini');
    msg?.classList.remove('hidden');
    toast('✅ Prompt salvo! Bot usará as novas instruções.', 'success');
    setTimeout(() => msg?.classList.add('hidden'), 3000);
  } else toast('Erro ao salvar.', 'error');
});

// Teste rápido do Gemini
document.getElementById('btnTestarGemini')?.addEventListener('click', async () => {
  const input = document.getElementById('geminiTestInput')?.value;
  if (!input?.trim()) { toast('Digite uma mensagem de teste.', 'warn'); return; }
  const btn = document.getElementById('btnTestarGemini');
  btn.textContent = '⏳ Gerando...'; btn.disabled = true;
  try {
    // Simula uma chamada via API de conversas (reutiliza o Gemini do servidor)
    const res = await fetch('/api/gemini/teste', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensagem: input }),
    });
    const data = await res.json();
    const resultEl = document.getElementById('geminiTestResult');
    const textEl   = document.getElementById('geminiTestResultText');
    if (textEl) textEl.innerHTML = formatarWhatsApp(data.resposta || data.erro || 'Sem resposta');
    resultEl?.classList.remove('hidden');
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
  finally { btn.textContent = '✨ Gerar resposta'; btn.disabled = false; }
});

// =============================================
// NEGÓCIOS
// =============================================
let _negocioAtualId = null;

async function carregarNegocios() {
  const grid = document.getElementById('negociosGrid');
  if (!grid) return;
  try {
    const res  = await fetch('/api/negocios');
    const lista = await res.json();
    if (!lista.length) {
      grid.innerHTML = `<div class="empty-state"><span class="empty-icon">🔥</span>
        <p>Nenhum negócio em aberto.</p>
        <p class="empty-sub">Quando um lead demonstrar interesse, aparecerá aqui automaticamente.</p></div>`;
      return;
    }
    lista.sort((a,b) => new Date(b.criadoEm) - new Date(a.criadoEm));
    grid.innerHTML = '';
    lista.forEach(n => grid.appendChild(criarCardNegocio(n)));
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
}

function criarCardNegocio(n) {
  const card = document.createElement('div');
  card.className = `negocio-card ${n.status}`;
  const statusLabel = { aguardando:'⏳ Aguardando', cobranca_enviada:'💳 Cobrança Enviada', pago:'✅ Pago', cancelado:'❌ Cancelado' };
  const statusClass = { aguardando:'pill-aguardando', cobranca_enviada:'pill-cobranca_enviada', pago:'pill-pago', cancelado:'pill-cancelado' };
  card.innerHTML = `
    <div class="negocio-header">
      <div class="negocio-top">
        <span class="negocio-nome">${escHtml(n.nome)}</span>
        <span class="negocio-status-pill ${statusClass[n.status]||'pill-aguardando'}">${statusLabel[n.status]||n.status}</span>
      </div>
      <div class="negocio-phone">${n.phone}</div>
    </div>
    <div class="negocio-body">
      ${n.categoria ? `<div class="negocio-categoria">${escHtml(n.categoria)}</div>` : ''}
      <div class="negocio-resumo">${escHtml(n.resumo || 'Lead demonstrou interesse em fechar negócio.')}</div>
      <div class="negocio-data">Recebido: ${formatarData(n.criadoEm)}</div>
    </div>
    <div class="negocio-footer">
      ${n.status === 'aguardando' || n.status === 'cobranca_enviada' ? `<button class="btn btn-primary btn-sm btn-cobrar" data-id="${n.id}">💰 ${n.status === 'cobranca_enviada' ? 'Reenviar Cobrança' : 'Gerar Cobrança'}</button>` : ''}
      ${n.pagamento?.id ? `<button class="btn btn-secondary btn-sm btn-verificar" data-id="${n.id}">↻ Verificar Pagamento</button>` : ''}
      <button class="btn btn-secondary btn-sm btn-retomar" data-phone="${n.phone}" title="Reativa o bot para esse número">▶ Retomar Bot</button>
      <button class="btn btn-ghost btn-sm btn-cancelar-neg" data-id="${n.id}" style="margin-left:auto;color:var(--red)">✕</button>
    </div>`;

  card.querySelector('.btn-cobrar')?.addEventListener('click', () => abrirModalCobranca(n));
  card.querySelector('.btn-verificar')?.addEventListener('click', () => verificarPagamentoNegocio(n.id));
  card.querySelector('.btn-retomar')?.addEventListener('click', async () => {
    const res  = await fetch('/api/conversas/retomar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: n.phone }),
    });
    if (res.ok) {
      toast(`▶ Bot retomado para ${n.nome}`, 'success');
      adicionarLogControle('sucesso', `▶ Bot retomado para ${n.nome} (${n.phone})`, new Date().toISOString());
    } else toast('Erro ao retomar bot', 'error');
  });
  card.querySelector('.btn-cancelar-neg')?.addEventListener('click', async () => {
    if (!confirm(`Remover negócio de ${n.nome}?`)) return;
    await fetch(`/api/negocios/${n.id}`, { method: 'DELETE' });
    carregarNegocios(); atualizarBadgesNav();
  });
  return card;
}

document.getElementById('btnAtualizarNegocios')?.addEventListener('click', carregarNegocios);

// ---- Modal de cobrança ----
function abrirModalCobranca(negocio) {
  _negocioAtualId = negocio.id;
  document.getElementById('cobrancaClienteInfo').textContent = `${negocio.nome} — ${negocio.phone}`;
  document.getElementById('cobrancaValor').value      = '';
  document.getElementById('cobrancaDescricao').value  = `Site profissional — ${negocio.nome}`;
  document.getElementById('cobrancaEmail').value      = '';
  document.getElementById('modalCobrancaBody').classList.remove('hidden');
  document.getElementById('cobrancaResultado').classList.add('hidden');
  document.getElementById('pixPagamentoStatus').classList.add('hidden');
  document.getElementById('modalCobranca').classList.remove('hidden');
}

document.getElementById('btnFecharCobranca')?.addEventListener('click', () => {
  document.getElementById('modalCobranca').classList.add('hidden');
});
document.getElementById('btnFecharCobrancaResult')?.addEventListener('click', () => {
  document.getElementById('modalCobranca').classList.add('hidden');
  carregarNegocios();
});

document.getElementById('btnGerarCobranca')?.addEventListener('click', async () => {
  const valor = document.getElementById('cobrancaValor').value;
  const desc  = document.getElementById('cobrancaDescricao').value;
  const email = document.getElementById('cobrancaEmail').value;
  if (!valor || parseFloat(valor) <= 0) { toast('Informe um valor válido.', 'warn'); return; }
  const btn = document.getElementById('btnGerarCobranca');
  btn.textContent = '⏳ Gerando...'; btn.disabled = true;
  try {
    const res  = await fetch(`/api/negocios/${_negocioAtualId}/cobrar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor, descricao: desc, email }),
    });
    const data = await res.json();
    if (!res.ok) { toast(`❌ ${data.erro}`, 'error'); return; }
    // Mostra resultado
    const pix = data.pix;
    document.getElementById('pixCopiaCola').value = pix.pixCopiaECola || '';
    if (pix.qrCodeBase64) {
      document.getElementById('pixQrImg').src = `data:image/png;base64,${pix.qrCodeBase64}`;
      document.getElementById('pixQrImg').style.display = 'block';
    } else {
      document.getElementById('pixQrImg').style.display = 'none';
    }
    document.getElementById('modalCobrancaBody').classList.add('hidden');
    document.getElementById('cobrancaResultado').classList.remove('hidden');
    toast('💰 PIX gerado e enviado pelo WhatsApp!', 'success', 5000);
    atualizarBadgesNav();
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
  finally { btn.textContent = '💰 Gerar PIX e Enviar pelo WhatsApp'; btn.disabled = false; }
});

document.getElementById('btnCopiarPix')?.addEventListener('click', () => {
  const v = document.getElementById('pixCopiaCola').value;
  navigator.clipboard.writeText(v).then(() => toast('📋 PIX copiado!', 'success'));
});

document.getElementById('btnVerificarPagamento')?.addEventListener('click', () => verificarPagamentoNegocio(_negocioAtualId, true));

async function verificarPagamentoNegocio(id, noModal = false) {
  const res  = await fetch(`/api/negocios/${id}/verificar-pagamento`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { toast(`❌ ${data.erro}`, 'error'); return; }
  if (data.pago) {
    toast('✅ Pagamento aprovado! Cliente movido para a aba Clientes.', 'success', 6000);
    if (noModal) document.getElementById('modalCobranca').classList.add('hidden');
    carregarNegocios(); atualizarBadgesNav();
    navegarPara('clientes');
  } else {
    const msg = `⏳ Aguardando pagamento (status: ${data.status})`;
    if (noModal) {
      const el = document.getElementById('pixPagamentoStatus');
      el.textContent = msg; el.className = 'pix-pagamento-status aguarda'; el.classList.remove('hidden');
    } else toast(msg, 'warn');
  }
}

// =============================================
// CLIENTES
// =============================================
let _filtroCliente = 'todos';

async function carregarClientes() {
  const grid = document.getElementById('clientesGrid');
  if (!grid) return;
  try {
    const res   = await fetch('/api/clientes');
    const lista = await res.json();
    const filtrados = _filtroCliente === 'todos' ? lista : lista.filter(c => c.status === _filtroCliente);
    if (!filtrados.length) {
      grid.innerHTML = `<div class="empty-state"><span class="empty-icon">👥</span>
        <p>${_filtroCliente === 'todos' ? 'Nenhum cliente ainda.' : `Nenhum cliente com status "${_filtroCliente}".`}</p></div>`;
      return;
    }
    filtrados.sort((a,b) => new Date(b.criadoEm) - new Date(a.criadoEm));
    grid.innerHTML = '';
    filtrados.forEach(c => grid.appendChild(criarCardCliente(c)));
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
}

function criarCardCliente(c) {
  const statusLabel = { pendente:'⏳ Pendente', em_desenvolvimento:'🔧 Em Desenvolvimento', entregue:'✅ Entregue' };
  const card = document.createElement('div');
  card.className = `cliente-card ${c.status}`;
  const valorFmt = c.valor ? `R$ ${parseFloat(c.valor).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : '—';
  card.innerHTML = `
    <div class="cliente-header">
      <span class="cliente-nome">${escHtml(c.nome)}</span>
      <span class="cliente-valor">${valorFmt}</span>
    </div>
    <div class="cliente-body">
      <div class="cliente-info-row">
        <span class="cliente-label">Status</span>
        <span class="status-badge-cliente ${c.status}">${statusLabel[c.status]||c.status}</span>
      </div>
      <div class="cliente-info-row" style="margin-top:8px">
        <span class="cliente-label">Tipo de Site</span>
      </div>
      <div class="cliente-tipo-site ${c.tipoSite ? '' : 'vazio'}">${escHtml(c.tipoSite || 'Não definido ainda — clique em editar')}</div>
      ${c.categoria ? `<div class="cliente-info-row"><span class="cliente-label">Segmento</span><span class="cliente-value">${escHtml(c.categoria)}</span></div>` : ''}
      <div class="cliente-info-row">
        <span class="cliente-label">WhatsApp</span>
        <span class="cliente-value" style="font-family:var(--mono);font-size:12px">${c.phone}</span>
      </div>
      ${c.observacoes ? `<div style="margin-top:8px;font-size:12px;color:var(--text3);background:var(--bg3);border-radius:6px;padding:8px">${escHtml(c.observacoes)}</div>` : ''}
    </div>
    <div class="cliente-footer">
      <span class="cliente-data">Desde ${formatarData(c.criadoEm)}</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm btn-editar-cliente" data-id="${c.id}">✏️ Editar</button>
        <button class="btn btn-ghost btn-sm btn-del-cliente" data-id="${c.id}" style="color:var(--red)">✕</button>
      </div>
    </div>`;

  card.querySelector('.btn-editar-cliente')?.addEventListener('click', () => abrirModalCliente(c));
  card.querySelector('.btn-del-cliente')?.addEventListener('click', async () => {
    if (!confirm(`Remover cliente ${c.nome}? Esta ação não pode ser desfeita.`)) return;
    await fetch(`/api/clientes/${c.id}`, { method: 'DELETE' });
    carregarClientes(); atualizarBadgesNav();
  });
  return card;
}

// ---- Filtros ----
document.getElementById('filtrosClientes')?.addEventListener('click', e => {
  const btn = e.target.closest('.filtro-btn');
  if (!btn) return;
  document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _filtroCliente = btn.dataset.status;
  carregarClientes();
});

document.getElementById('btnAtualizarClientes')?.addEventListener('click', carregarClientes);

// ---- Modal de edição do cliente ----
function abrirModalCliente(cliente) {
  document.getElementById('clienteEditId').value   = cliente.id;
  document.getElementById('clienteEditNome').value = cliente.nome;
  document.getElementById('clienteEditTipoSite').value = cliente.tipoSite || '';
  document.getElementById('clienteEditObs').value  = cliente.observacoes || '';
  // Marca o radio do status atual
  document.querySelectorAll('[name="clienteStatus"]').forEach(r => {
    r.checked = r.value === cliente.status;
  });
  document.getElementById('modalCliente').classList.remove('hidden');
}

document.getElementById('btnFecharCliente')?.addEventListener('click', () => {
  document.getElementById('modalCliente').classList.add('hidden');
});

document.getElementById('btnSalvarCliente')?.addEventListener('click', async () => {
  const id       = document.getElementById('clienteEditId').value;
  const tipoSite = document.getElementById('clienteEditTipoSite').value;
  const obs      = document.getElementById('clienteEditObs').value;
  const status   = document.querySelector('[name="clienteStatus"]:checked')?.value || 'pendente';
  const btn = document.getElementById('btnSalvarCliente');
  btn.textContent = '⏳ Salvando...'; btn.disabled = true;
  try {
    const res = await fetch(`/api/clientes/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipoSite, observacoes: obs, status }),
    });
    if (res.ok) {
      toast('✅ Cliente atualizado!', 'success');
      document.getElementById('modalCliente').classList.add('hidden');
      carregarClientes();
    } else toast('Erro ao salvar.', 'error');
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
  finally { btn.textContent = '💾 Salvar'; btn.disabled = false; }
});

// Fecha modals clicando fora
['modalCobranca','modalCliente','modalPreview'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
});

// =============================================
// Adiciona rota de teste Gemini no servidor (client-side fallback)
// O endpoint /api/gemini/teste existe no server.js
// =============================================

// =============================================
// GERAR PIX — Seção standalone
// =============================================
let _pixIdAtual = null;

document.querySelectorAll('.nav-item').forEach(item => {
  const clone = item._kiro_clone || item;
  if (clone.dataset.section === 'pagamento') {
    clone.addEventListener('click', () => {});
  }
});

document.getElementById('btnGerarPix')?.addEventListener('click', async () => {
  const valor    = document.getElementById('pixValor').value;
  const descricao = document.getElementById('pixDescricao').value.trim();
  const nome     = document.getElementById('pixNomeCliente').value.trim();
  const email    = document.getElementById('pixEmailCliente').value.trim();
  const numero   = document.getElementById('pixNumeroEnvio').value.trim().replace(/\D/g,'');

  if (!valor || parseFloat(valor) <= 0) { toast('Informe um valor válido.', 'warn'); return; }

  const btn = document.getElementById('btnGerarPix');
  btn.textContent = '⏳ Gerando...'; btn.disabled = true;

  try {
    const res  = await fetch('/api/pagamento/gerar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor, descricao, nomeCliente: nome, emailCliente: email, numeroEnvio: numero }),
    });
    const data = await res.json();
    if (!res.ok) { toast(`❌ ${data.erro}`, 'error'); return; }

    _pixIdAtual = data.pix?.pixId || data.pix?.id || null;
    mostrarResultadoPix(data.pix, parseFloat(valor), data.enviado, numero);
    toast('✅ PIX gerado!', 'success');
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
  finally { btn.textContent = '💰 Gerar PIX'; btn.disabled = false; }
});

function mostrarResultadoPix(pix, valor, enviado, numeroEnvio) {
  document.getElementById('pixPlaceholder').classList.add('hidden');
  const area = document.getElementById('pixResultadoArea');
  area.classList.remove('hidden');

  // Valor
  document.getElementById('pixValorGerado').textContent =
    `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  // QR Code
  const qrImg = document.getElementById('pixQrImgStandalone');
  if (pix.qrCodeBase64) {
    qrImg.src     = `data:image/png;base64,${pix.qrCodeBase64}`;
    qrImg.style.display = 'block';
  } else { qrImg.style.display = 'none'; }

  // Ticket / Checkout Pro Link
  const ticketWrap = document.getElementById('pixTicketWrap');
  const ticketLink = document.getElementById('pixTicketLink');
  const payUrl = pix.initPoint || pix.ticketUrl;
  if (payUrl) {
    ticketLink.href = payUrl;
    ticketWrap.classList.remove('hidden');
  } else { ticketWrap.classList.add('hidden'); }

  // Link de Pagamento (Copia e Cola)
  document.getElementById('pixCopiaCola2').value = payUrl || pix.pixCopiaECola || '';

  // Status envio
  const statusEl = document.getElementById('pixEnvioStatus');
  if (enviado && numeroEnvio) {
    statusEl.innerHTML = `✅ Mensagem enviada para <strong>${numeroEnvio}</strong> pelo WhatsApp`;
    statusEl.className = 'pix-pagamento-status pago';
    statusEl.classList.remove('hidden');
  } else if (numeroEnvio && !enviado) {
    statusEl.innerHTML = `⚠️ Não foi possível enviar para ${numeroEnvio} — copie o link manualmente`;
    statusEl.className = 'pix-pagamento-status aguarda';
    statusEl.classList.remove('hidden');
  } else {
    statusEl.classList.add('hidden');
  }

  // Monta mensagem completa formatada para copiar e enviar manualmente
  const valorFmt2  = `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const descricao2 = document.getElementById('pixDescricao')?.value?.trim() || 'Serviço de desenvolvimento web';
  const partes = [
    `Olá! Segue o link de pagamento para finalizar a contratação 😊`,
    ``,
    `💰 *Valor:* ${valorFmt2}`,
    `📋 *Descrição:* ${descricao2}`,
    ``,
    `💳 *Pague via PIX, Cartão de Crédito, Boleto ou Mercado Pago:*`,
    payUrl || pix.pixCopiaECola || '',
    ``,
    `Após a confirmação do pagamento, iniciamos o projeto imediatamente! 🚀`
  ];

  const msgCompleta = partes.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const msgEl = document.getElementById('pixMensagemCompleta');
  if (msgEl) msgEl.value = msgCompleta;
}

document.getElementById('btnCopiarPix2')?.addEventListener('click', () => {
  const v = document.getElementById('pixCopiaCola2').value;
  if (!v) { toast('Nenhum link para copiar', 'warn'); return; }
  navigator.clipboard.writeText(v).then(() => toast('📋 Link de pagamento copiado!', 'success'));
});

document.getElementById('btnCopiarMensagemCompleta')?.addEventListener('click', () => {
  const v = document.getElementById('pixMensagemCompleta').value;
  if (!v) { toast('Nenhuma mensagem para copiar', 'warn'); return; }
  navigator.clipboard.writeText(v).then(() => toast('📋 Mensagem copiada!', 'success'));
});

document.getElementById('btnReenviarPix')?.addEventListener('click', async () => {
  const num   = document.getElementById('pixReenviarNum').value.trim().replace(/\D/g,'');
  const valor = document.getElementById('pixValor').value;
  const desc  = document.getElementById('pixDescricao').value.trim();
  if (!num || num.length < 10) { toast('Informe um número válido', 'warn'); return; }
  if (!_pixIdAtual) { toast('Gere um PIX primeiro', 'warn'); return; }

  const btn = document.getElementById('btnReenviarPix');
  btn.textContent = '⏳'; btn.disabled = true;
  try {
    // Re-gera com o mesmo valor e envia para o novo número
    const res  = await fetch('/api/pagamento/gerar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor, descricao: desc, nomeCliente: document.getElementById('pixNomeCliente').value, emailCliente: document.getElementById('pixEmailCliente').value, numeroEnvio: num }),
    });
    const data = await res.json();
    if (res.ok && data.enviado) toast(`✅ Enviado para ${num}!`, 'success');
    else toast(`⚠️ PIX gerado mas não enviado — tente copiar`, 'warn');
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
  finally { btn.textContent = '📤 Enviar'; btn.disabled = false; }
});

document.getElementById('btnVerificarPixStatus')?.addEventListener('click', async () => {
  if (!_pixIdAtual) { toast('Nenhum PIX para verificar', 'warn'); return; }
  const btn = document.getElementById('btnVerificarPixStatus');
  btn.textContent = '⏳'; btn.disabled = true;
  try {
    const res  = await fetch(`/api/pagamento/${_pixIdAtual}/status`);
    const data = await res.json();
    const el   = document.getElementById('pixStatusCheck');
    if (data.pago) {
      el.textContent = '✅ PAGO!';
      el.className   = 'pix-pagamento-status pago';
      toast('✅ Pagamento confirmado!', 'success', 6000);
      if (typeof carregarDashboardStats === 'function') carregarDashboardStats();
    } else {
      el.textContent = `⏳ Aguardando (${data.status})`;
      el.className   = 'pix-pagamento-status aguarda';
    }
    el.classList.remove('hidden');
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
  finally { btn.textContent = '↻ Verificar se foi pago'; btn.disabled = false; }
});

// =============================================
// AGENDAMENTOS
// =============================================
let _agLeads    = [];
let _agCsvNome  = '';
let _agFile     = null;

async function carregarAgendamentos() {
  const container = document.getElementById('agendamentosLista');
  if (!container) return;
  try {
    const res  = await fetch('/api/agendamentos');
    const lista = await res.json();
    if (!lista.length) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-icon">🗓️</span>
        <p>Nenhum agendamento criado.</p>
        <p class="empty-sub">Clique em "+ Novo Agendamento" para programar um disparo.</p>
      </div>`;
      return;
    }
    // Ordena por data
    lista.sort((a,b) => new Date(a.dataHora) - new Date(b.dataHora));
    container.innerHTML = '';
    lista.forEach(ag => container.appendChild(criarCardAgendamento(ag)));
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
}

function criarCardAgendamento(ag) {
  const card = document.createElement('div');
  card.className = `ag-card ${ag.status}`;
  card.id = `ag-${ag.id}`;

  const statusLabel = {
    agendado:   '🕐 Agendado',
    executando: '⚡ Executando',
    concluido:  '✅ Concluído',
    cancelado:  '❌ Cancelado',
    erro:       '🔴 Erro',
  };

  const dataFmt   = formatarData(ag.dataHora);
  const leads     = ag.leads?.length || 0;
  const tempo     = ag.status === 'agendado' ? calcularCountdown(ag.dataHora) : '';
  const delayInfo = `${ag.delayMin}–${ag.delayMax}s delay`;
  const limiteInfo = ag.limite > 0 ? `limite: ${ag.limite}` : 'sem limite';

  card.innerHTML = `
    <div class="ag-header">
      <span class="ag-nome" title="${escHtml(ag.nome)}">${escHtml(ag.nome)}</span>
      ${tempo ? `<span class="ag-countdown" id="countdown-${ag.id}">${tempo}</span>` : ''}
      <span class="ag-status ${ag.status}">${statusLabel[ag.status] || ag.status}</span>
      <div class="ag-actions">
        ${ag.status === 'agendado' ? `<button class="btn btn-danger btn-sm btn-cancelar-ag" data-id="${ag.id}">✕ Cancelar</button>` : ''}
        ${['concluido','cancelado','erro'].includes(ag.status) ? `<button class="btn btn-ghost btn-sm btn-remover-ag" data-id="${ag.id}" style="color:var(--red)">🗑</button>` : ''}
      </div>
    </div>
    <div class="ag-body">
      <div class="ag-info">
        <span class="ag-data">📅 ${dataFmt}</span>
        <span class="ag-meta">${escHtml(ag.csvNome || 'sem arquivo')} · ${leads} leads · ${delayInfo} · ${limiteInfo}</span>
        ${ag.resultado ? `<span class="ag-meta" style="color:var(--red)">${escHtml(ag.resultado)}</span>` : ''}
      </div>
    </div>`;

  card.querySelector('.btn-cancelar-ag')?.addEventListener('click', async () => {
    if (!confirm(`Cancelar o agendamento "${ag.nome}"?`)) return;
    await fetch(`/api/agendamentos/${ag.id}`, { method: 'DELETE' });
    toast('Agendamento cancelado.', 'warn');
    carregarAgendamentos();
  });
  card.querySelector('.btn-remover-ag')?.addEventListener('click', async () => {
    await fetch(`/api/agendamentos/${ag.id}/remover`, { method: 'DELETE' });
    card.remove();
  });

  // Inicia countdown se agendado
  if (ag.status === 'agendado') {
    const interval = setInterval(() => {
      const el = document.getElementById(`countdown-${ag.id}`);
      if (!el) { clearInterval(interval); return; }
      const t = calcularCountdown(ag.dataHora);
      if (!t) { clearInterval(interval); carregarAgendamentos(); return; }
      el.textContent = t;
    }, 1000);
  }

  return card;
}

function calcularCountdown(dataHora) {
  const diff = new Date(dataHora) - new Date();
  if (diff <= 0) return '';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (h > 0)  return `em ${h}h ${m}min`;
  if (m > 0)  return `em ${m}min ${s}s`;
  return `em ${s}s`;
}

// Botão novo agendamento
document.getElementById('btnNovoAgendamento')?.addEventListener('click', () => {
  _agLeads   = [];
  _agCsvNome = '';
  _agFile    = null;

  // Reset form
  document.getElementById('agNome').value     = '';
  document.getElementById('agDataHora').value = '';
  document.getElementById('agDelayMin').value  = '45';
  document.getElementById('agDelayMax').value  = '90';
  document.getElementById('agLimite').value    = '0';
  document.getElementById('agLeadsCount').textContent = '—';
  document.getElementById('agInfoEstimativa').textContent = '';
  document.getElementById('agCsvLabel').textContent = 'Arraste o CSV ou clique para selecionar';
  document.getElementById('agDropZone').classList.remove('has-file');

  // Data mínima = agora + 5 min
  const min = new Date(Date.now() + 5 * 60 * 1000);
  const pad = n => String(n).padStart(2,'0');
  document.getElementById('agDataHora').min =
    `${min.getFullYear()}-${pad(min.getMonth()+1)}-${pad(min.getDate())}T${pad(min.getHours())}:${pad(min.getMinutes())}`;

  document.getElementById('modalAgendamento').classList.remove('hidden');
});

document.getElementById('btnFecharAgendamento')?.addEventListener('click', () => {
  document.getElementById('modalAgendamento').classList.add('hidden');
});
document.getElementById('modalAgendamento')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

// Upload CSV do agendamento
const agDrop  = document.getElementById('agDropZone');
const agInput = document.getElementById('agCsvInput');

agDrop?.addEventListener('click', () => agInput?.click());
agDrop?.addEventListener('dragover', e => { e.preventDefault(); agDrop.classList.add('drag-over'); });
agDrop?.addEventListener('dragleave', () => agDrop.classList.remove('drag-over'));
agDrop?.addEventListener('drop', e => {
  e.preventDefault(); agDrop.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) processarCsvAgendamento(f);
});
agInput?.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) processarCsvAgendamento(f);
});

function processarCsvAgendamento(file) {
  _agFile   = file;
  _agCsvNome = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    const conteudo = e.target.result;
    const linhas   = conteudo.split('\n');
    const cab      = linhas[0].split(',').map(c => c.trim().replace(/^"|"$/g,'').toLowerCase());
    const iPhone   = cab.indexOf('phone');
    const iTitle   = cab.indexOf('title');
    if (iPhone === -1) { toast('"phone" não encontrado no CSV', 'error'); return; }
    _agLeads = [];
    for (let i = 1; i < linhas.length; i++) {
      const linha = linhas[i].trim(); if (!linha) continue;
      const cols  = linha.split(',').map(c => c.replace(/^"|"$/g,'').trim());
      const num   = cols[iPhone]?.replace(/\D/g,'') || '';
      if (num.length < 10) continue;
      const phone = num.startsWith('55') ? num : `55${num}`;
      _agLeads.push({ title: cols[iTitle] || 'Empresa', phone, status: 'pendente' });
    }
    // Remove duplicatas
    _agLeads = [...new Map(_agLeads.map(l=>[l.phone,l])).values()];

    document.getElementById('agLeadsCount').textContent = `${_agLeads.length} leads`;
    document.getElementById('agCsvLabel').textContent   = `✅ ${file.name} (${_agLeads.length} leads)`;
    document.getElementById('agDropZone').classList.add('has-file');
    atualizarEstimativaAg();
    toast(`✅ ${_agLeads.length} leads carregados`, 'success');
  };
  reader.readAsText(file);
}

function atualizarEstimativaAg() {
  const min    = parseInt(document.getElementById('agDelayMin').value) || 45;
  const max    = parseInt(document.getElementById('agDelayMax').value) || 90;
  const limite = parseInt(document.getElementById('agLimite').value)   || 0;
  const total  = limite > 0 ? Math.min(limite, _agLeads.length) : _agLeads.length;
  if (!total) return;
  const media  = (min + max) / 2;
  const secs   = Math.round(total * media);
  const h      = Math.floor(secs / 3600);
  const m      = Math.floor((secs % 3600) / 60);
  const infoEl = document.getElementById('agInfoEstimativa');
  infoEl.innerHTML = `⏱️ Estimativa: ~${h > 0 ? h + 'h ' : ''}${m}min para ${total} leads`;
}

['agDelayMin','agDelayMax','agLimite'].forEach(id =>
  document.getElementById(id)?.addEventListener('input', atualizarEstimativaAg));

// Salvar agendamento
document.getElementById('btnSalvarAgendamento')?.addEventListener('click', async () => {
  const nome     = document.getElementById('agNome').value.trim();
  const dataHora = document.getElementById('agDataHora').value;
  const delayMin = parseInt(document.getElementById('agDelayMin').value);
  const delayMax = parseInt(document.getElementById('agDelayMax').value);
  const limite   = parseInt(document.getElementById('agLimite').value);

  if (!dataHora) { toast('Selecione a data e horário', 'warn'); return; }
  if (new Date(dataHora) <= new Date()) { toast('A data deve ser no futuro', 'warn'); return; }
  if (!_agLeads.length && !_agFile) { toast('Carregue um CSV com os leads', 'warn'); return; }
  if (delayMin >= delayMax) { toast('Delay mínimo deve ser menor que máximo', 'warn'); return; }

  const btn = document.getElementById('btnSalvarAgendamento');
  btn.textContent = '⏳ Salvando...'; btn.disabled = true;

  try {
    const formData = new FormData();
    formData.append('nome',     nome || `Disparo ${new Date(dataHora).toLocaleString('pt-BR')}`);
    formData.append('dataHora', dataHora);
    formData.append('delayMin', delayMin);
    formData.append('delayMax', delayMax);
    formData.append('limite',   limite);
    if (_agFile) formData.append('csv', _agFile);

    const res  = await fetch('/api/agendamentos', { method: 'POST', body: formData });
    const data = await res.json();

    if (res.ok) {
      toast(`✅ Disparo agendado para ${formatarData(dataHora)}!`, 'success', 6000);
      document.getElementById('modalAgendamento').classList.add('hidden');
      carregarAgendamentos();
    } else {
      toast(`❌ ${data.erro}`, 'error');
    }
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
  finally { btn.textContent = '🗓️ Agendar Disparo'; btn.disabled = false; }
});

// Recarrega agendamentos ao entrar na aba
// (já tratado no navegarPara que inclui 'agendamento')


// =============================================
// SCRAPER GOOGLE MAPS
// =============================================

// Estado do scraper
const scraperState = {
  resultados:    [],
  filtrados:     [],
  selecionados:  new Set(),
  buscando:      false,
  sseConn:       null,
  empresaParaLista: null,
  listas:        [],
  favoritos:     {},
};

async function iniciarSecaoScraper() {
  await carregarListasScraper();
  await carregarFavoritosScraper();
}

// ---- Helpers ---- //
function scraperEscHtml(s) { return escHtml(String(s ?? '')); }

function aplicarFiltrosScraper() {
  const comTel    = document.getElementById('filtroComTelefone')?.checked;
  const comSite   = document.getElementById('filtroComSite')?.checked;
  const semSite   = document.getElementById('filtroSemSite')?.checked;
  const notaMin   = parseFloat(document.getElementById('filtroNotaMin')?.value || '0');
  const avalMin   = parseInt(document.getElementById('filtroAvalMin')?.value   || '0');
  const buscaLocal = (document.getElementById('scraperBuscaLocal')?.value || '').toLowerCase();

  scraperState.filtrados = scraperState.resultados.filter(e => {
    if (comTel  && !e.phone)    return false;
    if (comSite && !e.website)  return false;
    if (semSite && e.website)   return false;
    if (notaMin > 0 && (e.rating == null || e.rating < notaMin)) return false;
    if (avalMin > 0 && (e.reviews == null || e.reviews < avalMin)) return false;
    if (buscaLocal) {
      const haystack = `${e.title} ${e.address} ${e.category}`.toLowerCase();
      if (!haystack.includes(buscaLocal)) return false;
    }
    return true;
  });

  renderizarCardsScraper();
  atualizarContadorScraper();
}

function atualizarContadorScraper() {
  const total    = scraperState.resultados.length;
  const filtrado = scraperState.filtrados.length;
  const badge    = document.getElementById('scraperBadgeTotal');
  const count    = document.getElementById('scraperResultCount');
  const selCount = document.getElementById('scraperSelCount');

  if (badge) {
    badge.textContent = `${total} encontradas`;
    badge.style.display = total > 0 ? '' : 'none';
  }
  if (count) {
    count.textContent = filtrado === total
      ? `${total} resultado${total !== 1 ? 's' : ''}`
      : `${filtrado} de ${total} (filtrados)`;
  }
  if (selCount) {
    const n = scraperState.selecionados.size;
    selCount.textContent = n > 0 ? `${n} selecionada${n !== 1 ? 's' : ''}` : '';
  }
}

// =============================================
// BUSCA — inicia SSE streaming
// =============================================
document.getElementById('btnIniciarScraper')?.addEventListener('click', iniciarBuscaScraper);
document.getElementById('scraperQuery')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') iniciarBuscaScraper();
});

async function iniciarBuscaScraper() {
  const query    = document.getElementById('scraperQuery')?.value.trim();
  const paisSel  = document.getElementById('scraperPais');
  const pais     = paisSel?.value || 'BR';
  const paisNome = paisSel?.options[paisSel.selectedIndex]?.dataset?.nome || 'Brasil';
  const estado   = document.getElementById('scraperEstado')?.value.trim() || '';
  const cidade   = document.getElementById('scraperCidade')?.value.trim() || '';
  const limite   = document.getElementById('scraperLimite')?.value || '20';

  if (!query) { toast('Digite um segmento para buscar.', 'warn'); return; }
  if (scraperState.buscando) return;

  // Fecha SSE anterior
  if (scraperState.sseConn) { scraperState.sseConn.close(); scraperState.sseConn = null; }

  scraperState.buscando   = true;
  scraperState.resultados = [];
  scraperState.filtrados  = [];
  scraperState.selecionados.clear();

  // UI: modo buscando
  document.getElementById('btnIniciarScraper').classList.add('hidden');
  document.getElementById('btnPararScraper').classList.remove('hidden');
  document.getElementById('scraperProgressWrap').classList.remove('hidden');
  document.getElementById('scraperStatusBadge').classList.remove('hidden');
  document.getElementById('scraperToolbar').classList.add('hidden');
  document.getElementById('scraperGrid').innerHTML = '';
  document.getElementById('scraperEmpty').classList.remove('hidden');
  document.getElementById('scraperLog').innerHTML = '';
  document.getElementById('scraperProgressFill').style.width = '0%';
  document.getElementById('scraperProgressLabel').textContent = '⏳ Conectando ao servidor...';
  document.getElementById('scraperProgressCount').textContent = `0 / ${limite}`;

  // Mostra mensagem de espera enquanto o browser não iniciou
  const logEl = document.getElementById('scraperLog');
  const addLogImediato = (msg, tipo = 'info') => {
    const d = document.createElement('div');
    d.className = `scraper-log-line ${tipo}`;
    d.textContent = msg;
    logEl.appendChild(d);
  };
  addLogImediato('🔌 Iniciando conexão SSE...');

  const params = new URLSearchParams({ query, pais, paisNome, estado, cidade, limite });
  const url    = `/api/scraper/buscar?${params}`;

  // Inicia o timer de espera visual
  let esperaTimer = null;
  let esperaSeg   = 0;
  const msgs = [
    'Abrindo browser Chromium...',
    'Carregando Google Maps...',
    'Aguardando resultados...',
    'Coletando dados do feed...',
  ];
  esperaTimer = setInterval(() => {
    esperaSeg++;
    if (scraperState.resultados.length === 0) {
      const msg = msgs[Math.floor(esperaSeg / 5) % msgs.length];
      document.getElementById('scraperProgressLabel').textContent = `⏳ ${msg} (${esperaSeg}s)`;
    }
  }, 1000);

  const es = new EventSource(url);
  scraperState.sseConn = es;

  es.onopen = () => {
    addLogImediato('✓ Conexão SSE estabelecida', 'ok');
    document.getElementById('scraperProgressLabel').textContent = '⏳ Abrindo browser...';
  };

  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data);
      // Para o timer quando receber o primeiro evento real
      if (ev.tipo !== 'inicio' && esperaTimer) {
        clearInterval(esperaTimer);
        esperaTimer = null;
      }
      tratarEventoScraper(ev, parseInt(limite));
    } catch {}
  };

  es.onerror = () => {
    if (esperaTimer) { clearInterval(esperaTimer); esperaTimer = null; }
    finalizarBuscaScraper();
  };

  // Limpa timer se parar
  scraperState._esperaTimer = esperaTimer;
}

function tratarEventoScraper(ev, limite) {
  const logEl    = document.getElementById('scraperLog');
  const labelEl  = document.getElementById('scraperProgressLabel');
  const countEl  = document.getElementById('scraperProgressCount');
  const fillEl   = document.getElementById('scraperProgressFill');

  const addLog = (msg, tipo = 'info') => {
    if (!logEl) return;
    const d = document.createElement('div');
    d.className = `scraper-log-line ${tipo}`;
    d.textContent = msg;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
    // Mantém máx 40 linhas
    while (logEl.children.length > 40) logEl.removeChild(logEl.firstChild);
  };

  if (ev.tipo === 'inicio') {
    addLog(ev.mensagem, 'info');
    labelEl && (labelEl.textContent = ev.mensagem);
  }

  else if (ev.tipo === 'progresso') {
    const n   = ev.encontrados || 0;
    const pct = limite > 0 ? Math.min((n / limite) * 100, 100).toFixed(0) : 0;
    fillEl  && (fillEl.style.width  = `${pct}%`);
    countEl && (countEl.textContent = `${n} / ${limite}`);
    labelEl && (labelEl.textContent = ev.mensagem);

    addLog(`✓ ${ev.empresa?.title || ev.mensagem}`, 'ok');

    if (ev.empresa) {
      // Remove o empty state e mostra toolbar
      const empty = document.getElementById('scraperEmpty');
      if (empty) empty.classList.add('hidden');
      document.getElementById('scraperToolbar').classList.remove('hidden');

      scraperState.resultados.push(ev.empresa);
      aplicarFiltrosScraper();
    }
  }

  else if (ev.tipo === 'erro') {
    addLog(`✗ ${ev.mensagem}`, 'err');
    toast(`Erro no scraper: ${ev.mensagem}`, 'error');
    finalizarBuscaScraper();
  }

  else if (ev.tipo === 'concluido') {
    addLog(`— ${ev.mensagem}`, 'info');
    fillEl  && (fillEl.style.width  = '100%');
    countEl && (countEl.textContent = `${ev.encontrados} / ${limite}`);
    labelEl && (labelEl.textContent = `Concluído — ${ev.encontrados} empresas`);
    toast(`✅ ${ev.encontrados} empresas encontradas!`, 'success', 5000);
    finalizarBuscaScraper();
  }
}

function finalizarBuscaScraper() {
  scraperState.buscando = false;
  if (scraperState.sseConn) { scraperState.sseConn.close(); scraperState.sseConn = null; }

  document.getElementById('btnIniciarScraper').classList.remove('hidden');
  document.getElementById('btnPararScraper').classList.add('hidden');
  document.getElementById('scraperStatusBadge').classList.add('hidden');

  if (scraperState.resultados.length === 0) {
    document.getElementById('scraperEmpty').classList.remove('hidden');
    document.getElementById('scraperToolbar').classList.add('hidden');
  }

  aplicarFiltrosScraper();
  atualizarContadorScraper();
}

document.getElementById('btnPararScraper')?.addEventListener('click', () => {
  if (scraperState._esperaTimer) { clearInterval(scraperState._esperaTimer); scraperState._esperaTimer = null; }
  finalizarBuscaScraper();
  toast('⏹ Busca interrompida.', 'warn');
});

// =============================================
// RENDERIZAR CARDS
// =============================================
function renderizarCardsScraper() {
  const grid = document.getElementById('scraperGrid');
  if (!grid) return;

  // Remove cards existentes mas mantém o empty state
  [...grid.querySelectorAll('.scraper-card')].forEach(c => c.remove());

  if (scraperState.filtrados.length === 0) {
    document.getElementById('scraperEmpty').classList.remove('hidden');
    return;
  }
  document.getElementById('scraperEmpty').classList.add('hidden');

  scraperState.filtrados.forEach((emp, idx) => {
    const card = criarCardEmpresa(emp, idx);
    grid.appendChild(card);
  });
}

function criarCardEmpresa(emp, idx) {
  const isFav     = !!scraperState.favoritos[emp.id];
  const isSel     = scraperState.selecionados.has(emp.id);
  const temTel    = !!emp.phone;
  const temSite   = !!emp.website;
  const ratingStr = emp.rating != null ? emp.rating.toFixed(1) : null;
  const reviewsStr = emp.reviews != null ? emp.reviews.toLocaleString('pt-BR') : null;

  const card = document.createElement('div');
  card.className = `scraper-card${isSel ? ' selecionado' : ''}${isFav ? ' favorito-ativo' : ''}`;
  card.dataset.id = emp.id;
  card.style.animationDelay = `${Math.min(idx * 0.04, 0.5)}s`;

  // Website display
  let websiteHtml = '';
  if (temSite) {
    let displayUrl = emp.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    if (displayUrl.length > 30) displayUrl = displayUrl.substring(0, 28) + '…';
    websiteHtml = `
      <div class="scraper-info-row">
        <span class="scraper-info-icon">🌐</span>
        <a href="${scraperEscHtml(emp.website)}" target="_blank" class="scraper-site-link"
           onclick="event.stopPropagation()">${scraperEscHtml(displayUrl)}</a>
      </div>`;
  }

  // Botão ligar — formata para tel: link
  const telLink = emp.phone ? `tel:+${emp.phone}` : '#';

  // Botão Maps
  const mapsUrl = emp.maps_url || `https://www.google.com/maps/search/${encodeURIComponent(emp.title)}`;

  card.innerHTML = `
    <input type="checkbox" class="scraper-card-checkbox" ${isSel ? 'checked' : ''} title="Selecionar" />

    <div class="scraper-card-header">
      <button class="btn-fav" title="${isFav ? 'Remover dos favoritos' : 'Favoritar'}" data-id="${emp.id}">
        ${isFav ? '★' : '☆'}
      </button>
      <div class="scraper-card-nome" title="${scraperEscHtml(emp.title)}">${scraperEscHtml(emp.title)}</div>
      ${emp.category ? `<div class="scraper-card-categoria">${scraperEscHtml(emp.category)}</div>` : ''}
    </div>

    <div class="scraper-card-body">
      ${ratingStr ? `
        <div class="scraper-rating-row">
          <span class="scraper-rating-badge">★ ${scraperEscHtml(ratingStr)}</span>
          ${reviewsStr ? `<span class="scraper-reviews-badge">${scraperEscHtml(reviewsStr)} avaliações</span>` : ''}
        </div>` : ''}

      ${emp.address ? `
        <div class="scraper-info-row">
          <span class="scraper-info-icon">📍</span>
          <span class="scraper-info-text">${scraperEscHtml(emp.address)}</span>
        </div>` : ''}

      ${emp.phone ? `
        <div class="scraper-info-row">
          <span class="scraper-info-icon">📞</span>
          <span class="scraper-info-text" style="font-family:var(--mono);font-size:12px">
            ${scraperEscHtml(emp.phone_raw || emp.phone)}
          </span>
        </div>` : ''}

      ${websiteHtml}

      <div class="scraper-badges-row">
        <span class="scraper-badge ${temTel ? 'tem-tel' : 'sem-tel'}">${temTel ? '✓ Telefone' : '✗ Sem tel.'}</span>
        <span class="scraper-badge ${temSite ? 'tem-site' : 'sem-site'}">${temSite ? '✓ Site' : '✗ Sem site'}</span>
      </div>
    </div>

    <div class="scraper-card-footer">
      ${temTel ? `
        <button class="btn-scraper-action verde btn-ligar" data-phone="${scraperEscHtml(emp.phone)}" title="Ligar">
          📞 Ligar
        </button>
        <button class="btn-scraper-action verde btn-whatsapp" data-phone="${scraperEscHtml(emp.phone)}" title="Abrir WhatsApp">
          💬 WhatsApp
        </button>
      ` : ''}
      <button class="btn-scraper-action azul btn-add-lista" data-id="${emp.id}" title="Adicionar à lista">
        + Lista
      </button>
      <a href="${mapsUrl}" target="_blank" class="btn-scraper-action laranja" title="Ver no Google Maps"
         onclick="event.stopPropagation()">
        🗺 Maps
      </a>
      ${temSite ? `
        <a href="${scraperEscHtml(emp.website)}" target="_blank"
           class="btn-scraper-action" title="Abrir site"
           onclick="event.stopPropagation()">
          🌐 Site
        </a>` : ''}
    </div>`;

  // ---- Eventos do card ----
  // Checkbox de seleção
  const chk = card.querySelector('.scraper-card-checkbox');
  chk?.addEventListener('change', () => {
    if (chk.checked) scraperState.selecionados.add(emp.id);
    else             scraperState.selecionados.delete(emp.id);
    card.classList.toggle('selecionado', chk.checked);
    atualizarContadorScraper();
  });

  // Favoritar
  card.querySelector('.btn-fav')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await toggleFavorito(emp, card);
  });

  // Ligar
  card.querySelector('.btn-ligar')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.open(`tel:+${emp.phone}`, '_self');
  });

  // WhatsApp
  card.querySelector('.btn-whatsapp')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await enviarMsgWhatsapp(emp);
  });

  // Adicionar à lista
  card.querySelector('.btn-add-lista')?.addEventListener('click', (e) => {
    e.stopPropagation();
    abrirModalAdicionarLista(emp);
  });

  return card;
}

// =============================================
// FAVORITOS
// =============================================
async function carregarFavoritosScraper() {
  try {
    const res  = await fetch('/api/scraper/favoritos');
    const list = await res.json();
    scraperState.favoritos = {};
    list.forEach(f => { scraperState.favoritos[f.id] = f; });
    // Atualiza badge nav
    const badge = document.getElementById('navBadgeScraper');
    if (badge) {
      badge.textContent = list.length || '';
      badge.classList.toggle('visible', list.length > 0);
    }
  } catch {}
}

async function toggleFavorito(emp, card) {
  const isFav = !!scraperState.favoritos[emp.id];
  const btn   = card?.querySelector('.btn-fav');

  if (isFav) {
    await fetch(`/api/scraper/favoritos/${emp.id}`, { method: 'DELETE' });
    delete scraperState.favoritos[emp.id];
    card?.classList.remove('favorito-ativo');
    if (btn) btn.textContent = '☆';
    toast('Removido dos favoritos.', 'warn');
  } else {
    const res  = await fetch('/api/scraper/favoritos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emp),
    });
    const data = await res.json();
    scraperState.favoritos[emp.id] = data.favorito;
    card?.classList.add('favorito-ativo');
    if (btn) btn.textContent = '★';
    toast(`⭐ ${emp.title} favoritado!`, 'success');
  }
  await carregarFavoritosScraper();
}

// Modal favoritos
document.getElementById('btnVerFavoritos')?.addEventListener('click', abrirModalFavoritos);
document.getElementById('btnFecharFavoritos')?.addEventListener('click', () => {
  document.getElementById('modalFavoritos').classList.add('hidden');
});
document.getElementById('modalFavoritos')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

async function abrirModalFavoritos() {
  await carregarFavoritosScraper();
  const body  = document.getElementById('modalFavoritosBody');
  const favs  = Object.values(scraperState.favoritos);
  document.getElementById('modalFavoritos').classList.remove('hidden');

  if (!favs.length) {
    body.innerHTML = `<div class="empty-state" style="padding:40px 0">
      <span class="empty-icon"><i data-lucide="star"></i></span>
      <p>Nenhum favorito salvo ainda.</p>
    </div>`;
    lucide.createIcons();
    return;
  }

  body.innerHTML = favs.map(f => `
    <div class="fav-card-modal">
      <div class="fav-card-info">
        <div class="fav-card-nome">${scraperEscHtml(f.title)}</div>
        <div class="fav-card-sub">${scraperEscHtml(f.phone_raw || f.phone || '')} · ${scraperEscHtml(f.category || '')}</div>
      </div>
      <div class="fav-card-acoes">
        ${f.phone ? `<button class="btn-scraper-action verde btn-fav-whatsapp" data-phone="${scraperEscHtml(f.phone)}" title="WhatsApp">💬</button>` : ''}
        <button class="btn-scraper-action btn-add-lista" data-id="${f.id}" title="Adicionar à lista">+ Lista</button>
        <button class="btn-scraper-action vermelho btn-del-fav" data-id="${f.id}" title="Remover">✕</button>
      </div>
    </div>`).join('');

  // Eventos
  body.querySelectorAll('.btn-fav-whatsapp').forEach(btn => {
    btn.addEventListener('click', () => enviarMsgWhatsapp({ phone: btn.dataset.phone }));
  });
  body.querySelectorAll('.btn-add-lista').forEach(btn => {
    btn.addEventListener('click', () => {
      const fav = scraperState.favoritos[btn.dataset.id];
      if (fav) abrirModalAdicionarLista(fav);
    });
  });
  body.querySelectorAll('.btn-del-fav').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/scraper/favoritos/${btn.dataset.id}`, { method: 'DELETE' });
      delete scraperState.favoritos[btn.dataset.id];
      await abrirModalFavoritos();
      await carregarFavoritosScraper();
      toast('Removido dos favoritos.', 'warn');
    });
  });
}

// =============================================
// LISTAS
// =============================================
async function carregarListasScraper() {
  try {
    const res = await fetch('/api/scraper/listas');
    scraperState.listas = await res.json();
  } catch {}
}

document.getElementById('btnVerListas')?.addEventListener('click', abrirModalListas);
document.getElementById('btnFecharListas')?.addEventListener('click', () => {
  document.getElementById('modalListas').classList.add('hidden');
});
document.getElementById('modalListas')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

document.getElementById('btnCriarLista')?.addEventListener('click', async () => {
  const nome = document.getElementById('novaListaNome')?.value.trim();
  if (!nome) { toast('Digite um nome para a lista.', 'warn'); return; }
  await fetch('/api/scraper/listas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome }),
  });
  document.getElementById('novaListaNome').value = '';
  await carregarListasScraper();
  toast(`✅ Lista "${nome}" criada!`, 'success');
  await abrirModalListas();
});

async function abrirModalListas() {
  await carregarListasScraper();
  const body  = document.getElementById('modalListasBody');
  document.getElementById('modalListas').classList.remove('hidden');

  if (!scraperState.listas.length) {
    body.innerHTML = `<div class="empty-state" style="padding:30px 0">
      <span class="empty-icon"><i data-lucide="list"></i></span>
      <p>Nenhuma lista criada ainda.</p>
    </div>`;
    lucide.createIcons();
    return;
  }

  body.innerHTML = scraperState.listas.map(l => `
    <div class="lista-item-modal">
      <div>
        <div class="lista-item-nome">${scraperEscHtml(l.nome)}</div>
        <div class="lista-item-count">${l.itens?.length || 0} empresa(s)</div>
      </div>
      <div class="lista-item-acoes">
        <a href="/api/scraper/listas/${l.id}/exportar" class="btn-scraper-action verde" title="Exportar CSV">
          ⬇ CSV
        </a>
        <button class="btn-scraper-action vermelho btn-del-lista" data-id="${l.id}" title="Excluir lista">✕</button>
      </div>
    </div>`).join('');

  body.querySelectorAll('.btn-del-lista').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta lista?')) return;
      await fetch(`/api/scraper/listas/${btn.dataset.id}`, { method: 'DELETE' });
      await carregarListasScraper();
      toast('Lista excluída.', 'warn');
      await abrirModalListas();
    });
  });
}

// ---- Modal: adicionar empresa à lista ----
function abrirModalAdicionarLista(empresa) {
  scraperState.empresaParaLista = empresa;
  const modal   = document.getElementById('modalAdicionarLista');
  const info    = document.getElementById('adicionarListaInfo');
  const opcoes  = document.getElementById('adicionarListaOpcoes');

  if (info) info.textContent = `Adicionar "${empresa.title}" em:`;
  modal.classList.remove('hidden');
  renderizarOpcoesLista(opcoes, empresa);
}

function renderizarOpcoesLista(container, empresa) {
  if (!container) return;
  if (!scraperState.listas.length) {
    container.innerHTML = `<p style="font-size:12px;color:var(--text3)">Nenhuma lista criada ainda — crie uma abaixo.</p>`;
    return;
  }
  container.innerHTML = scraperState.listas.map(l => `
    <button class="lista-item-modal btn-escolher-lista" data-id="${l.id}" style="width:100%;text-align:left;cursor:pointer">
      <span class="lista-item-nome">${scraperEscHtml(l.nome)}</span>
      <span class="lista-item-count">${l.itens?.length || 0} empresa(s)</span>
    </button>`).join('');

  container.querySelectorAll('.btn-escolher-lista').forEach(btn => {
    btn.addEventListener('click', async () => {
      const listaId = btn.dataset.id;
      await adicionarEmpresaLista(listaId, empresa);
    });
  });
}

async function adicionarEmpresaLista(listaId, empresa) {
  try {
    const res  = await fetch(`/api/scraper/listas/${listaId}/adicionar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(empresa),
    });
    const data = await res.json();
    if (res.ok) {
      toast(`✅ "${empresa.title}" adicionada à lista!`, 'success');
      document.getElementById('modalAdicionarLista').classList.add('hidden');
      await carregarListasScraper();
    } else toast(`❌ ${data.erro}`, 'error');
  } catch(err) { toast(`Erro: ${err.message}`, 'error'); }
}

document.getElementById('btnFecharAdicionarLista')?.addEventListener('click', () => {
  document.getElementById('modalAdicionarLista').classList.add('hidden');
});
document.getElementById('modalAdicionarLista')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

document.getElementById('btnCriarAdicionarLista')?.addEventListener('click', async () => {
  const nome = document.getElementById('novaListaNome2')?.value.trim();
  if (!nome) { toast('Digite um nome para a nova lista.', 'warn'); return; }
  const res  = await fetch('/api/scraper/listas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome }),
  });
  const data = await res.json();
  if (res.ok && scraperState.empresaParaLista) {
    document.getElementById('novaListaNome2').value = '';
    await carregarListasScraper();
    await adicionarEmpresaLista(data.lista.id, scraperState.empresaParaLista);
  }
});

// =============================================
// AÇÕES DE SELEÇÃO MÚLTIPLA
// =============================================
document.getElementById('btnSelecionarTodos')?.addEventListener('click', () => {
  const todos      = scraperState.selecionados.size < scraperState.filtrados.length;
  const checkboxes = document.querySelectorAll('.scraper-card-checkbox');

  scraperState.selecionados.clear();
  checkboxes.forEach((chk, i) => {
    chk.checked = todos;
    const emp   = scraperState.filtrados[i];
    if (todos && emp) scraperState.selecionados.add(emp.id);
    chk.closest('.scraper-card')?.classList.toggle('selecionado', todos);
  });

  document.getElementById('btnSelecionarTodos').textContent =
    todos ? 'Desmarcar todos' : 'Selecionar todos';
  atualizarContadorScraper();
});

document.getElementById('btnAdicionarSelecionados')?.addEventListener('click', async () => {
  if (!scraperState.selecionados.size) { toast('Selecione pelo menos uma empresa.', 'warn'); return; }
  await carregarListasScraper();
  if (!scraperState.listas.length) {
    toast('Crie uma lista primeiro.', 'warn');
    abrirModalListas();
    return;
  }
  // Abre modal com a primeira empresa e permite adicionar em lote
  const ids = [...scraperState.selecionados];
  const empresas = scraperState.filtrados.filter(e => ids.includes(e.id));

  // Abre o modal de escolha de lista passando o lote
  scraperState.empresaParaLista = null;
  const modal  = document.getElementById('modalAdicionarLista');
  const info   = document.getElementById('adicionarListaInfo');
  const opcoes = document.getElementById('adicionarListaOpcoes');

  if (info) info.textContent = `Adicionar ${empresas.length} empresa(s) em:`;
  modal.classList.remove('hidden');

  // Renderiza opções para lote
  if (!scraperState.listas.length) {
    opcoes.innerHTML = `<p style="font-size:12px;color:var(--text3)">Crie uma lista abaixo.</p>`;
    return;
  }
  opcoes.innerHTML = scraperState.listas.map(l => `
    <button class="lista-item-modal btn-escolher-lista-lote" data-id="${l.id}" style="width:100%;text-align:left;cursor:pointer">
      <span class="lista-item-nome">${scraperEscHtml(l.nome)}</span>
      <span class="lista-item-count">${l.itens?.length || 0} empresa(s)</span>
    </button>`).join('');

  opcoes.querySelectorAll('.btn-escolher-lista-lote').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.textContent = `⏳ Adicionando ${empresas.length}...`;
      btn.disabled    = true;
      let ok = 0;
      for (const emp of empresas) {
        try {
          const r = await fetch(`/api/scraper/listas/${btn.dataset.id}/adicionar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(emp),
          });
          if (r.ok) ok++;
        } catch {}
      }
      toast(`✅ ${ok} empresa(s) adicionadas!`, 'success');
      modal.classList.add('hidden');
      await carregarListasScraper();
    });
  });
});

// =============================================
// EXPORTAR CSV da busca atual
// =============================================
document.getElementById('btnExportarCSV')?.addEventListener('click', () => {
  const dados = scraperState.filtrados;
  if (!dados.length) { toast('Nenhum resultado para exportar.', 'warn'); return; }

  const header = 'title,phone,address,category,website,rating,reviews\n';
  const rows   = dados.map(e =>
    ['title','phone','address','category','website','rating','reviews']
      .map(k => `"${(e[k] ?? '').toString().replace(/"/g,'""')}"`)
      .join(',')
  ).join('\n');

  const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `scraper_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`✅ CSV exportado (${dados.length} empresas)`, 'success');
});

// =============================================
// ENVIAR MSG PELO WHATSAPP (via painel)
// =============================================
async function enviarMsgWhatsapp(empresa) {
  const phone = empresa.phone || empresa.phone_raw;
  if (!phone) { toast('Empresa sem número de telefone.', 'warn'); return; }

  const num = phone.replace(/\D/g, '');

  // Abre WhatsApp Web se não tiver Evolution conectada
  const waUrl = `https://wa.me/${num}`;
  window.open(waUrl, '_blank');

  toast(`💬 Abrindo WhatsApp para ${empresa.title || num}`, 'success');
}

// =============================================
// FILTROS — reaplica ao mudar qualquer filtro
// =============================================
['filtroComTelefone','filtroComSite','filtroSemSite',
 'filtroNotaMin','filtroAvalMin','scraperBuscaLocal'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', aplicarFiltrosScraper);
  document.getElementById(id)?.addEventListener('input',  aplicarFiltrosScraper);
});

// Filtro sem-site e com-site são exclusivos
document.getElementById('filtroComSite')?.addEventListener('change', e => {
  if (e.target.checked) {
    const ss = document.getElementById('filtroSemSite');
    if (ss) ss.checked = false;
  }
  aplicarFiltrosScraper();
});
document.getElementById('filtroSemSite')?.addEventListener('change', e => {
  if (e.target.checked) {
    const cs = document.getElementById('filtroComSite');
    if (cs) cs.checked = false;
  }
  aplicarFiltrosScraper();
});

// =============================================
// APIFY GOOGLE MAPS SCRAPER & GEMINI IA KIT
// =============================================
let stateApify = {
  leads: [],
  runIdAtual: null,
  pollTimer: null,
  leadIaAtual: null,
  filtrosAtivos: {},
  pastas: [],
  pastaAtual: null,
};

const ESTADOS_BRASIL = [
  { uf: 'AC', nome: 'Acre' },
  { uf: 'AL', nome: 'Alagoas' },
  { uf: 'AP', nome: 'Amapá' },
  { uf: 'AM', nome: 'Amazonas' },
  { uf: 'BA', nome: 'Bahia' },
  { uf: 'CE', nome: 'Ceará' },
  { uf: 'DF', nome: 'Distrito Federal' },
  { uf: 'ES', nome: 'Espírito Santo' },
  { uf: 'GO', nome: 'Goiás' },
  { uf: 'MA', nome: 'Maranhão' },
  { uf: 'MT', nome: 'Mato Grosso' },
  { uf: 'MS', nome: 'Mato Grosso do Sul' },
  { uf: 'MG', nome: 'Minas Gerais' },
  { uf: 'PA', nome: 'Pará' },
  { uf: 'PB', nome: 'Paraíba' },
  { uf: 'PR', nome: 'Paraná' },
  { uf: 'PE', nome: 'Pernambuco' },
  { uf: 'PI', nome: 'Piauí' },
  { uf: 'RJ', nome: 'Rio de Janeiro' },
  { uf: 'RN', nome: 'Rio Grande do Norte' },
  { uf: 'RS', nome: 'Rio Grande do Sul' },
  { uf: 'RO', nome: 'Rondônia' },
  { uf: 'RR', nome: 'Roraima' },
  { uf: 'SC', nome: 'Santa Catarina' },
  { uf: 'SP', nome: 'São Paulo' },
  { uf: 'SE', nome: 'Sergipe' },
  { uf: 'TO', nome: 'Tocantins' },
];

function criarComboboxUI(selectId, placeholderText = 'Selecione...') {
  const originalSelect = document.getElementById(selectId);
  if (!originalSelect) return;

  const existingWrap = originalSelect.parentNode.querySelector(`.combobox-wrap[data-for="${selectId}"]`);
  if (existingWrap) existingWrap.remove();

  originalSelect.style.display = 'none';

  const wrap = document.createElement('div');
  wrap.className = 'combobox-wrap';
  wrap.dataset.for = selectId;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'combobox-trigger';

  const triggerLabel = document.createElement('span');
  triggerLabel.className = 'combobox-trigger-label';
  const selectedOpt = originalSelect.options[originalSelect.selectedIndex];
  triggerLabel.textContent = selectedOpt ? selectedOpt.text : placeholderText;

  const triggerIcon = document.createElement('span');
  triggerIcon.className = 'combobox-trigger-icon';
  triggerIcon.innerHTML = '<i data-lucide="chevron-down" style="width:16px;height:16px"></i>';

  trigger.appendChild(triggerLabel);
  trigger.appendChild(triggerIcon);

  const popover = document.createElement('div');
  popover.className = 'combobox-popover hidden';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'combobox-search-wrap';
  searchWrap.innerHTML = '<i data-lucide="search" style="width:13px;height:13px;opacity:0.5"></i>';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'combobox-search';
  searchInput.placeholder = 'Buscar opção...';
  searchWrap.appendChild(searchInput);

  const list = document.createElement('div');
  list.className = 'combobox-list';

  popover.appendChild(searchWrap);
  popover.appendChild(list);

  wrap.appendChild(trigger);
  wrap.appendChild(popover);

  originalSelect.parentNode.insertBefore(wrap, originalSelect.nextSibling);

  function renderList(query = '') {
    list.innerHTML = '';
    const q = query.toLowerCase().trim();

    const children = Array.from(originalSelect.children);
    let count = 0;

    children.forEach(child => {
      if (child.tagName === 'OPTGROUP') {
        const groupLabel = child.label;
        const subOpts = Array.from(child.children).filter(o => o.text.toLowerCase().includes(q));

        if (subOpts.length > 0) {
          const groupHeader = document.createElement('div');
          groupHeader.className = 'combobox-optgroup-label';
          groupHeader.textContent = groupLabel;
          list.appendChild(groupHeader);

          subOpts.forEach(opt => {
            count++;
            const item = document.createElement('div');
            item.className = `combobox-item ${opt.selected ? 'selected' : ''}`;
            item.innerHTML = `
              <span>${opt.text}</span>
              <span class="combobox-check-icon"><i data-lucide="check" style="width:14px;height:14px"></i></span>
            `;
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              originalSelect.value = opt.value;
              originalSelect.dispatchEvent(new Event('change'));
              triggerLabel.textContent = opt.text;
              popover.classList.add('hidden');
              trigger.classList.remove('open');
              renderList('');
            });
            list.appendChild(item);
          });
        }
      } else if (child.tagName === 'OPTION') {
        if (child.text.toLowerCase().includes(q)) {
          count++;
          const item = document.createElement('div');
          item.className = `combobox-item ${child.selected ? 'selected' : ''}`;
          item.innerHTML = `
            <span>${child.text}</span>
            <span class="combobox-check-icon"><i data-lucide="check" style="width:14px;height:14px"></i></span>
          `;
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            originalSelect.value = child.value;
            originalSelect.dispatchEvent(new Event('change'));
            triggerLabel.textContent = child.text;
            popover.classList.add('hidden');
            trigger.classList.remove('open');
            renderList('');
          });
          list.appendChild(item);
        }
      }
    });

    if (count === 0) {
      list.innerHTML = '<div class="combobox-empty">Nenhum resultado encontrado.</div>';
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.combobox-popover').forEach(p => p !== popover && p.classList.add('hidden'));
    document.querySelectorAll('.combobox-trigger').forEach(t => t !== trigger && t.classList.remove('open'));
    document.querySelectorAll('.combobox-wrap').forEach(w => w !== wrap && w.classList.remove('open-wrap'));

    const isHidden = popover.classList.contains('hidden');
    if (isHidden) {
      popover.classList.remove('hidden');
      trigger.classList.add('open');
      wrap.classList.add('open-wrap');
      renderList('');

      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 260) {
        popover.classList.add('popover-up');
      } else {
        popover.classList.remove('popover-up');
      }

      setTimeout(() => searchInput.focus(), 50);
    } else {
      popover.classList.add('hidden');
      trigger.classList.remove('open');
      wrap.classList.remove('open-wrap');
    }
  });

  document.addEventListener('click', () => {
    popover.classList.add('hidden');
    trigger.classList.remove('open');
    wrap.classList.remove('open-wrap');
  });

  searchInput.addEventListener('input', (e) => {
    renderList(e.target.value);
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

const PAISES_DO_MUNDO = [
  { code: 'BR', name: 'Brasil', flag: '🇧🇷', lang: 'pt-BR', cc: 'br', regions: ['São Paulo (SP)', 'Rio de Janeiro (RJ)', 'Minas Gerais (MG)', 'Paraná (PR)', 'Rio Grande do Sul (RS)', 'Santa Catarina (SC)', 'Bahia (BA)', 'Pernambuco (PE)', 'Ceará (CE)', 'Goiás (GO)', 'Distrito Federal (DF)', 'Espírito Santo (ES)', 'Mato Grosso (MT)', 'Mato Grosso do Sul (MS)', 'Pará (PA)', 'Amazonas (AM)', 'Maranhão (MA)', 'Paraíba (PB)', 'Rio Grande do Norte (RN)', 'Alagoas (AL)', 'Piauí (PI)', 'Sergipe (SE)', 'Rondônia (RO)', 'Tocantins (TO)', 'Acre (AC)', 'Amapá (AP)', 'Roraima (RR)'] },
  { code: 'US', name: 'United States', flag: '🇺🇸', lang: 'en', cc: 'us', regions: ['California', 'Texas', 'Florida', 'New York', 'Illinois', 'Pennsylvania', 'Ohio', 'Georgia', 'North Carolina', 'Michigan', 'New Jersey', 'Virginia', 'Washington', 'Arizona', 'Massachusetts', 'Tennessee', 'Indiana', 'Maryland', 'Missouri', 'Colorado', 'Wisconsin', 'Minnesota', 'South Carolina', 'Alabama', 'Louisiana', 'Kentucky', 'Oregon', 'Oklahoma', 'Connecticut', 'Utah', 'Iowa', 'Nevada', 'Arkansas', 'Mississippi', 'Kansas', 'New Mexico', 'Nebraska', 'Idaho', 'West Virginia', 'Hawaii', 'New Hampshire', 'Maine', 'Rhode Island', 'Montana', 'Delaware', 'South Dakota', 'North Dakota', 'Alaska', 'Vermont', 'Wyoming'] },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹', lang: 'pt-PT', cc: 'pt', regions: ['Lisboa', 'Porto', 'Braga', 'Setúbal', 'Aveiro', 'Faro (Algarve)', 'Leiria', 'Coimbra', 'Santarém', 'Viseu', 'Madeira', 'Açores'] },
  { code: 'ES', name: 'España', flag: '🇪🇸', lang: 'es', cc: 'es', regions: ['Madrid', 'Cataluña (Barcelona)', 'Andalucía (Sevilla/Málaga)', 'Comunidad Valenciana', 'Galicia', 'País Vasco', 'Castilla y León', 'Canarias', 'Baleares', 'Murcia', 'Aragón'] },
  { code: 'MX', name: 'México', flag: '🇲🇽', lang: 'es', cc: 'mx', regions: ['Ciudad de México (CDMX)', 'Jalisco (Guadalajara)', 'Nuevo León (Monterrey)', 'Estado de México', 'Puebla', 'Guanajuato', 'Veracruz', 'Yucatán (Mérida)', 'Quintana Roo (Cancún)'] },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷', lang: 'es', cc: 'ar', regions: ['Buenos Aires', 'Córdoba', 'Santa Fe (Rosario)', 'Mendoza', 'Tucumán', 'Salta', 'Entre Ríos', 'Misiones', 'Neuquén', 'Chabut'] },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴', lang: 'es', cc: 'co', regions: ['Bogotá D.C.', 'Antioquia (Medellín)', 'Valle del Cauca (Cali)', 'Atlántico (Barranquilla)', 'Bolívar (Cartagena)', 'Santander (Bucaramanga)', 'Cundinamarca'] },
  { code: 'CL', name: 'Chile', flag: '🇨🇱', lang: 'es', cc: 'cl', regions: ['Región Metropolitana (Santiago)', 'Valparaíso', 'Bío Bío (Concepción)', 'Antofagasta', 'Araucanía', 'Coquimbo'] },
  { code: 'PE', name: 'Perú', flag: '🇵🇪', lang: 'es', cc: 'pe', regions: ['Lima', 'Arequipa', 'La Libertad (Trujillo)', 'Piura', 'Cusco', 'Lambayeque (Chiclayo)', 'Junín'] },
  { code: 'UY', name: 'Uruguay', flag: '🇺🇾', lang: 'es', cc: 'uy', regions: ['Montevideo', 'Maldonado (Punta del Este)', 'Canelones', 'Colonia', 'Salto'] },
  { code: 'PY', name: 'Paraguay', flag: '🇵🇾', lang: 'es', cc: 'py', regions: ['Asunción', 'Central', 'Alto Paraná (Ciudad del Este)', 'Itapúa (Encarnación)'] },
  { code: 'FR', name: 'France', flag: '🇫🇷', lang: 'fr', cc: 'fr', regions: ['Île-de-France (Paris)', 'Auvergne-Rhône-Alpes (Lyon)', 'Provence-Alpes-Côte d’Azur (Marseille/Nice)', 'Occitanie (Toulouse)', 'Nouvelle-Aquitaine (Bordeaux)', 'Hauts-de-France (Lille)'] },
  { code: 'DE', name: 'Deutschland', flag: '🇩🇪', lang: 'de', cc: 'de', regions: ['Nordrhein-Westfalen (Köln)', 'Bayern (München)', 'Baden-Württemberg (Stuttgart)', 'Niedersachsen', 'Hessen (Frankfurt)', 'Berlin', 'Sachsen (Leipzig)', 'Hamburg'] },
  { code: 'IT', name: 'Italia', flag: '🇮🇹', lang: 'it', cc: 'it', regions: ['Lombardia (Milano)', 'Lazio (Roma)', 'Campania (Napoli)', 'Veneto (Venezia/Verona)', 'Piemonte (Torino)', 'Emilia-Romagna (Bologna)', 'Toscana (Firenze)', 'Sicilia'] },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', lang: 'en', cc: 'gb', regions: ['Greater London', 'West Midlands (Birmingham)', 'Greater Manchester', 'West Yorkshire (Leeds)', 'Scotland (Edinburgh/Glasgow)', 'Wales (Cardiff)', 'Northern Ireland (Belfast)'] },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', lang: 'en', cc: 'ca', regions: ['Ontario (Toronto)', 'Quebec (Montreal)', 'British Columbia (Vancouver)', 'Alberta (Calgary)', 'Manitoba', 'Nova Scotia'] },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', lang: 'en', cc: 'au', regions: ['New South Wales (Sydney)', 'Victoria (Melbourne)', 'Queensland (Brisbane)', 'Western Australia (Perth)', 'South Australia (Adelaide)'] },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', lang: 'ja', cc: 'jp', regions: ['Tokyo', 'Osaka', 'Kanagawa (Yokohama)', 'Aichi (Nagoya)', 'Hokkaido (Sapporo)', 'Fukuoka', 'Kyoto'] },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', lang: 'en', cc: 'ae', regions: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah'] },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', lang: 'en', cc: 'za', regions: ['Gauteng (Johannesburg/Pretoria)', 'Western Cape (Cape Town)', 'KwaZulu-Natal (Durban)'] },
  { code: 'VE', name: 'Venezuela', flag: '🇻🇪', lang: 'es', cc: 've', regions: ['Caracas', 'Zulia (Maracaibo)', 'Carabobo (Valencia)', 'Lara (Barquisimeto)'] },
  { code: 'EC', name: 'Ecuador', flag: '🇪🇨', lang: 'es', cc: 'ec', regions: ['Pichincha (Quito)', 'Guayas (Guayaquil)', 'Azuay (Cuenca)'] },
  { code: 'BO', name: 'Bolivia', flag: '🇧🇴', lang: 'es', cc: 'bo', regions: ['Santa Cruz', 'La Paz', 'Cochabamba'] },
  { code: 'CR', name: 'Costa Rica', flag: '🇨🇷', lang: 'es', cc: 'cr', regions: ['San José', 'Alajuela', 'Cartago', 'Heredia'] },
  { code: 'PA', name: 'Panamá', flag: '🇵🇦', lang: 'es', cc: 'pa', regions: ['Panamá City', 'Chiriquí', 'Colón'] },
  { code: 'DO', name: 'República Dominicana', flag: '🇩🇴', lang: 'es', cc: 'do', regions: ['Santo Domingo', 'Santiago', 'Punta Cana / La Altagracia'] }
];

function inicializarFiltrosApify() {
  const selectPais = document.getElementById('apifyPais');
  const selectEstado = document.getElementById('apifyEstado');

  if (selectPais && selectPais.options.length <= 1) {
    selectPais.innerHTML = '';
    PAISES_DO_MUNDO.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.code;
      opt.dataset.lang = p.lang;
      opt.dataset.cc = p.cc;
      opt.textContent = `${p.flag} ${p.name}`;
      selectPais.appendChild(opt);
    });

    selectPais.addEventListener('change', (e) => {
      const paisCode = e.target.value;
      carregarEstadosPorPais(paisCode);
    });
  }

  // Preenche estados do Brasil inicialmente
  carregarEstadosPorPais('BR');

  criarComboboxUI('apifyPais', 'Selecione o País...');
  criarComboboxUI('apifyEstado', 'Selecione o Estado...');
  criarComboboxUI('apifyNichoProfissao', 'Selecione a categoria...');
  criarComboboxUI('apifyFiltroSite');
  criarComboboxUI('apifyFiltroNota');
  criarComboboxUI('apifyFiltroAvaliacoes');
  criarComboboxUI('apifyMaxItems');

  const selectNicho = document.getElementById('apifyNichoProfissao');
  selectNicho?.addEventListener('change', (e) => {
    const inputCustom = document.getElementById('apifySearchCustom');
    if (e.target.value === 'CUSTOM') {
      inputCustom?.focus();
    }
  });
}

function carregarEstadosPorPais(paisCode) {
  const selectEstado = document.getElementById('apifyEstado');
  const selectCidade = document.getElementById('apifyCidade');
  if (!selectEstado) return;

  const paisObj = PAISES_DO_MUNDO.find(p => p.code === paisCode) || PAISES_DO_MUNDO[0];

  selectEstado.innerHTML = '<option value="">Selecione o Estado / Região...</option>';

  if (paisCode === 'BR') {
    ESTADOS_BRASIL.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.nome;
      opt.dataset.uf = e.uf;
      opt.textContent = `${e.nome} (${e.uf})`;
      selectEstado.appendChild(opt);
    });

    selectEstado.onchange = (e) => {
      const selectedOpt = selectEstado.options[selectEstado.selectedIndex];
      const uf = selectedOpt ? selectedOpt.dataset.uf : '';
      carregarCidadesPorEstado(uf, e.target.value);
    };
  } else {
    // Outros Países
    (paisObj.regions || []).forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      selectEstado.appendChild(opt);
    });

    selectEstado.onchange = (e) => {
      if (selectCidade) {
        selectCidade.innerHTML = `<option value="">Todas as cidades de ${e.target.value}</option>`;
        selectCidade.disabled = false;
        criarComboboxUI('apifyCidade', 'Selecione a Cidade...');
      }
    };
  }

  criarComboboxUI('apifyEstado', 'Selecione o Estado...');
  if (selectCidade) {
    selectCidade.innerHTML = '<option value="">Selecione um Estado primeiro</option>';
    selectCidade.disabled = true;
    criarComboboxUI('apifyCidade', 'Selecione a Cidade...');
  }
}

async function carregarCidadesPorEstado(uf, estadoNome) {
  const selectCidade = document.getElementById('apifyCidade');
  if (!selectCidade) return;

  if (!uf) {
    selectCidade.innerHTML = '<option value="">Selecione um Estado primeiro</option>';
    selectCidade.disabled = true;
    return;
  }

  selectCidade.innerHTML = '<option value="">⏳ Carregando cidades do IBGE...</option>';
  selectCidade.disabled = true;

  try {
    const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
    const cidades = await res.json();

    if (Array.isArray(cidades) && cidades.length > 0) {
      cidades.sort((a, b) => a.nome.localeCompare(b.nome));
      selectCidade.innerHTML = '<option value="">Selecione a Cidade...</option>';
      cidades.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.nome;
        opt.textContent = c.nome;
        selectCidade.appendChild(opt);
      });
      selectCidade.disabled = false;
      criarComboboxUI('apifyCidade', 'Selecione a Cidade...');
    } else {
      throw new Error('Nenhuma cidade retornada');
    }
  } catch (err) {
    console.warn('Falha ao obter cidades via IBGE, usando campo aberto:', err);
    selectCidade.innerHTML = `
      <option value="">Selecione a Cidade...</option>
      <option value="Capital">Toda a Capital de ${estadoNome || uf}</option>
      <option value="Principais">Principais Cidades de ${estadoNome || uf}</option>
    `;
    selectCidade.disabled = false;
    criarComboboxUI('apifyCidade', 'Selecione a Cidade...');
  }
}

// Navegação de abas (sidebar)
document.addEventListener('DOMContentLoaded', () => {
  inicializarFiltrosApify();

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = item.dataset.section;
      if (!sectionId) return;

      document.querySelectorAll('.sidebar-nav .nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      document.querySelectorAll('.main .section').forEach(s => s.classList.remove('active'));
      const targetSection = document.getElementById(`section-${sectionId}`);
      if (targetSection) targetSection.classList.add('active');

      if (sectionId === 'apify') {
        carregarApifyConfig();
        carregarApifyLeads();
      }
    });
  });

  // Carrega contagem inicial do Apify
  carregarApifyLeads();
});

// Configurações
document.getElementById('btnApifyConfigToggle')?.addEventListener('click', () => {
  const card = document.getElementById('cardApifyConfig');
  card?.classList.toggle('hidden');
});

async function carregarApifyConfig() {
  try {
    const res = await fetch('/api/apify/config');
    const data = await res.json();
    if (data.token) {
      document.getElementById('inputApifyToken').value = data.token;
    }
    if (data.actorId) {
      document.getElementById('selectApifyActor').value = data.actorId;
    }
  } catch (err) {
    console.error('Erro ao carregar config Apify:', err);
  }
}

document.getElementById('btnSalvarApifyToken')?.addEventListener('click', async () => {
  const token = document.getElementById('inputApifyToken').value.trim();
  const actorId = document.getElementById('selectApifyActor').value;
  const msgEl = document.getElementById('apifyTokenMsg');

  try {
    const res = await fetch('/api/apify/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, actorId }),
    });
    const data = await res.json();
    if (data.ok) {
      msgEl.innerHTML = '<span style="color:#4ade80">✅ Configurações salvas com sucesso!</span>';
      toast('Configurações do Apify salvas!', 'success');
    } else {
      msgEl.innerHTML = `<span style="color:#f87171">❌ ${data.erro}</span>`;
    }
  } catch (err) {
    msgEl.innerHTML = `<span style="color:#f87171">❌ Erro: ${err.message}</span>`;
  }
});

document.getElementById('btnTestarApifyToken')?.addEventListener('click', async () => {
  const token = document.getElementById('inputApifyToken').value.trim();
  const select = document.getElementById('selectApifyActor');
  const msgEl = document.getElementById('apifyTokenMsg');

  msgEl.innerHTML = '<span style="color:var(--text-muted)">⏳ Consultando API do Apify...</span>';
  try {
    const res = await fetch(`/api/apify/actors?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (data.ok && data.atores) {
      msgEl.innerHTML = `<span style="color:#4ade80">✅ Conectado! ${data.atores.length} ator(es) encontrados na sua conta.</span>`;
      select.innerHTML = '<option value="compass~crawler-google-places">Google Maps Scraper (compass/crawler-google-places)</option>';
      data.atores.forEach(act => {
        const val = `${act.username}~${act.name}`;
        if (val !== 'compass~crawler-google-places') {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = `${act.title || act.name} (${act.username}/${act.name})`;
          select.appendChild(opt);
        }
      });
      toast(`✅ Apify: ${data.atores.length} atores carregados!`, 'success');
    } else {
      msgEl.innerHTML = `<span style="color:#f87171">❌ ${data.erro || 'Falha ao consultar atores'}</span>`;
    }
  } catch (err) {
    msgEl.innerHTML = `<span style="color:#f87171">❌ Erro: ${err.message}</span>`;
  }
});

// Execução do Scraper no Apify com Filtros
document.getElementById('btnIniciarApifyScrape')?.addEventListener('click', async () => {
  const paisCode = document.getElementById('apifyPais').value || 'BR';
  const paisObj = PAISES_DO_MUNDO.find(p => p.code === paisCode) || PAISES_DO_MUNDO[0];

  const estado = document.getElementById('apifyEstado').value;
  const cidade = document.getElementById('apifyCidade').value;
  const bairro = document.getElementById('apifyBairro').value.trim();
  const nicho = document.getElementById('apifyNichoProfissao').value;
  const customSearch = document.getElementById('apifySearchCustom').value.trim();

  const filtroSite = document.getElementById('apifyFiltroSite').value;
  const filtroNota = document.getElementById('apifyFiltroNota').value;
  const filtroAvaliacoes = document.getElementById('apifyFiltroAvaliacoes').value;
  const maxItems = document.getElementById('apifyMaxItems').value;
  const actorIdParam = document.getElementById('selectApifyActor').value;

  if (!nicho && !customSearch) {
    toast('Selecione uma Categoria/Nicho de Profissão ou digite uma busca específica', 'warn');
    return;
  }
  if (!estado) {
    toast('Selecione o Estado / Região desejado', 'warn');
    return;
  }

  // Constrói termo de busca e localização
  let termoFinal = nicho === 'CUSTOM' ? customSearch : nicho;
  if (nicho !== 'CUSTOM' && customSearch) {
    termoFinal = `${termoFinal} ${customSearch}`;
  }

  let localFinal = `${cidade ? cidade + ', ' : ''}${estado}, ${paisObj.name}`;
  if (bairro) localFinal = `${bairro}, ${localFinal}`;

  stateApify.filtrosAtivos = { filtroSite, filtroNota, filtroAvaliacoes, countryCode: paisObj.cc, language: paisObj.lang, paisNome: paisObj.name };

  const statusText = document.getElementById('apifyScrapeStatusText');
  const cardProgress = document.getElementById('cardApifyProgress');
  const progressTitle = document.getElementById('apifyProgressTitle');
  const progressSub = document.getElementById('apifyProgressSub');
  const btn = document.getElementById('btnIniciarApifyScrape');

  btn.disabled = true;
  statusText.textContent = 'Iniciando robô no Apify...';
  cardProgress.classList.remove('hidden');
  progressTitle.textContent = `Buscando "${termoFinal}" em "${localFinal}" (${paisObj.flag} ${paisObj.name})...`;
  progressSub.textContent = `Filtros ativos: Idioma (${paisObj.lang}), Site (${filtroSite}), Nota mín. (${filtroNota}★)`;

  try {
    const res = await fetch('/api/apify/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchTerms: termoFinal,
        location: localFinal,
        maxItems: parseInt(maxItems) || 50,
        actorIdParam,
        countryCode: paisObj.cc,
        language: paisObj.lang
      }),
    });
    const data = await res.json();

    if (!data.ok) {
      throw new Error(data.erro || 'Erro ao iniciar robô no Apify');
    }

    stateApify.runIdAtual = data.runId;
    toast(`🚀 Scraper Apify iniciado para ${localFinal}!`, 'info');

    // Inicia Polling
    iniciarPollingRunApify(data.runId, data.datasetId);

  } catch (err) {
    toast(`❌ ${err.message}`, 'error');
    btn.disabled = false;
    cardProgress.classList.add('hidden');
    statusText.textContent = '';
  }
});


function iniciarPollingRunApify(runId, datasetIdInicial) {
  if (stateApify.pollTimer) clearInterval(stateApify.pollTimer);

  const progressTitle = document.getElementById('apifyProgressTitle');
  const progressSub = document.getElementById('apifyProgressSub');
  const progressPct = document.getElementById('apifyProgressPct');
  const progressFill = document.getElementById('apifyProgressFill');
  const statusText = document.getElementById('apifyScrapeStatusText');
  const btn = document.getElementById('btnIniciarApifyScrape');

  let pctAtual = 10;
  if (progressFill) progressFill.style.width = '10%';
  if (progressPct) progressPct.textContent = '10%';

  stateApify.pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/apify/run/${runId}`);
      const data = await res.json();

      if (!data.ok) return;

      const status = data.status;
      if (pctAtual < 90) pctAtual += 15;
      if (progressFill) progressFill.style.width = `${pctAtual}%`;
      if (progressPct) progressPct.textContent = `${pctAtual}%`;

      if (progressSub) progressSub.textContent = `Status no Apify: ${status} · Run ID: ${runId}`;
      if (statusText) statusText.textContent = `Scraper Apify: ${status}`;

      if (status === 'SUCCEEDED') {
        clearInterval(stateApify.pollTimer);
        stateApify.pollTimer = null;
        if (progressFill) progressFill.style.width = '100%';
        if (progressPct) progressPct.textContent = '100%';
        if (progressTitle) progressTitle.textContent = 'Raspagem concluída no Apify!';
        if (progressSub) progressSub.textContent = 'Baixando dataset e importando estabelecimentos...';

        // Busca itens do dataset
        const datasetId = data.datasetId || datasetIdInicial;
        await importarDatasetApify(datasetId);

        btn.disabled = false;
        setTimeout(() => {
          document.getElementById('cardApifyProgress')?.classList.add('hidden');
          if (statusText) statusText.textContent = '';
        }, 4000);
      } else if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
        clearInterval(stateApify.pollTimer);
        stateApify.pollTimer = null;
        if (progressTitle) progressTitle.textContent = `Robô finalizado com status: ${status}`;
        btn.disabled = false;
        toast(`Erro no scraper Apify: ${status}`, 'error');
      }
    } catch (err) {
      console.error('Erro no polling do Apify:', err);
    }
  }, 3500);
}

async function importarDatasetApify(datasetId) {
  try {
    const f = stateApify.filtrosAtivos || {};
    let queryParams = new URLSearchParams({
      filtroSite: f.filtroSite || 'todos',
      filtroNota: f.filtroNota || '0',
      filtroAvaliacoes: f.filtroAvaliacoes || '0',
      countryCode: f.countryCode || '',
    }).toString();

    let res = await fetch(`/api/apify/dataset/${datasetId}?${queryParams}`);
    let data = await res.json();

    // Caso a filtragem estrita retorne 0 (ex: cidade pequena sem site), tenta o dataset completo como fallback
    if (data.ok && data.count === 0 && f.filtroSite === 'sem_site') {
      const resTodos = await fetch(`/api/apify/dataset/${datasetId}?filtroSite=todos&filtroNota=0&filtroAvaliacoes=0`);
      const dataTodos = await resTodos.json();

      if (dataTodos.ok && dataTodos.count > 0) {
        toast(`${dataTodos.count} estabelecimentos encontrados no Google Maps. Mostrando todos para você ajustar a qualificação.`, 'info', 6000);
        carregarApifyLeads();
        return;
      }
    }

    if (data.ok) {
      toast(`${data.count} leads qualificados importados do Apify!`, 'success');
      carregarApifyLeads();
    } else {
      toast(`Erro ao baixar dataset: ${data.erro}`, 'error');
    }
  } catch (err) {
    toast(`Erro ao baixar dataset: ${err.message}`, 'error');
  }
}

// Carregar e Renderizar Leads
async function carregarApifyLeads() {
  try {
    const res = await fetch('/api/apify/leads');
    const data = await res.json();
    stateApify.leads = data.leads || [];

    // Atualiza contadores
    const badgeNav = document.getElementById('navBadgeApify');
    if (badgeNav) badgeNav.textContent = stateApify.leads.length ? stateApify.leads.length : '';

    const countSpan = document.getElementById('apifyCountLeads');
    if (countSpan) countSpan.textContent = stateApify.leads.length;

    renderizarApifyLeads();
  } catch (err) {
    console.error('Erro ao carregar leads Apify:', err);
  }
}

document.getElementById('apifyFiltroTexto')?.addEventListener('input', (e) => {
  renderizarApifyLeads(e.target.value.trim());
});

document.getElementById('btnApifyLimparLeads')?.addEventListener('click', async () => {
  if (!confirm('Tem certeza que deseja apagar todos os leads do Apify?')) return;
  try {
    const res = await fetch('/api/apify/leads', { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      toast('Leads do Apify limpos!', 'warn');
      carregarApifyLeads();
    }
  } catch (err) {
    toast(`Erro: ${err.message}`, 'error');
  }
});

function calcularScoreLead(lead) {
  let score = 30; // base
  if (!lead.website || lead.website.trim() === '') score += 40; // sem site = oportunidade gigante
  if (lead.phone) score += 15; // tem telefone
  if (lead.rating >= 4.0) score += 15; // boa avaliação
  return Math.min(score, 100);
}

function renderizarApifyLeads(filtro = '') {
  const container = document.getElementById('apifyLeadsGrid');
  if (!container) return;

  const termo = filtro.toLowerCase();
  const filtrados = stateApify.leads.filter(l =>
    (l.title || '').toLowerCase().includes(termo) ||
    (l.category || '').toLowerCase().includes(termo) ||
    (l.address || '').toLowerCase().includes(termo)
  );

  if (!filtrados.length) {
    container.innerHTML = `
      <div class="apify-empty-state">
        <p style="font-size:15px;font-weight:600;margin:0">
          ${filtro ? 'Nenhum lead encontrado para essa busca.' : 'Nenhum lead capturado via Apify ainda.'}
        </p>
        <p style="font-size:13px;color:var(--text-muted);margin-top:6px">
          ${filtro ? 'Tente buscar com outros termos.' : 'Configure os filtros acima e clique em "Buscar Leads Qualificados" para iniciar.'}
        </p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  filtrados.forEach((lead) => {
    const card = document.createElement('div');
    card.className = 'apify-lead-card';

    const temSite = !!lead.website;
    const score = calcularScoreLead(lead);
    const scoreClass = score >= 80 ? 'score-high' : (score >= 50 ? 'score-mid' : 'score-low');
    const nome = lead.title || 'Empresa';
    const notaVal = lead.rating ? lead.rating.toFixed(1) : '5';
    let cidade = 'sua região';
    if (lead.address) {
      const partes = lead.address.split(',');
      if (partes.length >= 2) {
        cidade = partes[partes.length - 2].trim();
      } else {
        cidade = lead.address.split('-').pop()?.trim() || 'sua região';
      }
    }

    const mensagemAbordagem = `Bom dia! Encontrei a *${nome}* aqui em ${cidade} e queria falar rapidinho com vocês.\n\nVi que a nota de vocês no Google é ${notaVal}, bem boa.\n\nSó que procurei o site de vocês e não achei nenhum.\n\nDigo isso porque quem procura decide rápido, quase sempre pelo primeiro que passa confiança.\n\nEu faço site pra empresa local. Se topar, monto uma amostra da ${nome} e te envio o link pra você julgar. Tudo bem?`;

    const waLink = lead.cleanPhone
      ? `https://web.whatsapp.com/send?phone=${lead.cleanPhone}&text=${encodeURIComponent(mensagemAbordagem)}`
      : null;

    card.innerHTML = `
      <div class="apify-lead-header">
        <div class="apify-lead-info">
          <h4 class="apify-lead-nome">${escHtml(lead.title)}</h4>
          <div class="apify-lead-meta">
            <span>Categoria: ${escHtml(lead.category || 'Não informada')}</span>
            <span>·</span>
            <span>Endereço: ${escHtml(lead.address || 'Não disponível')}</span>
          </div>
        </div>
        <div class="apify-lead-score ${scoreClass}" title="Score de Oportunidade de Venda">
          ${score}
          <small>SCORE</small>
        </div>
      </div>

      <div class="apify-lead-badges">
        ${!temSite
          ? `<span class="apify-badge sem-site">Sem site detectado</span><span class="apify-badge oportunidade">Alta Oportunidade</span>`
          : `<span class="apify-badge tem-site">Possui Site</span>`
        }
        ${lead.phone ? `<span class="apify-badge location">Com Celular / WhatsApp</span>` : ''}
      </div>

      <div class="apify-lead-stats">
        <div class="apify-stat">
          <div class="apify-stat-label">Nota Google</div>
          <div class="apify-stat-value" style="color:#facc15">
            ${lead.rating ? `Nota ${lead.rating.toFixed(1)}` : '—'}
          </div>
        </div>
        <div class="apify-stat">
          <div class="apify-stat-label">Avaliações</div>
          <div class="apify-stat-value">${lead.reviewsCount || 0}</div>
        </div>
        <div class="apify-stat">
          <div class="apify-stat-label">Contato</div>
          <div class="apify-stat-value" style="font-size:13px;font-family:var(--mono)">
            ${escHtml(lead.phone || 'Indisponível')}
          </div>
        </div>
        <div class="apify-stat">
          <div class="apify-stat-label">Website</div>
          <div class="apify-stat-value" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${temSite ? `<a href="${lead.website}" target="_blank" style="color:var(--primary)">${escHtml(lead.website.replace(/^https?:\/\/(www\.)?/, '').substring(0, 20))}</a>` : '<span style="color:#f87171">Sem site</span>'}
          </div>
        </div>
      </div>

      <div class="apify-lead-actions">
        <button class="btn btn-secondary btn-apify-det" data-id="${lead.id}"><i data-lucide="info"></i> Detalhes</button>
        <button class="btn btn-primary btn-apify-ia" data-id="${lead.id}"><i data-lucide="sparkles"></i> Gerar Abordagem IA</button>
        ${lead.url ? `<a href="${lead.url}" target="_blank" class="btn btn-secondary"><i data-lucide="map-pin"></i> Abrir Maps</a>` : ''}
        ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-secondary"><i data-lucide="message-square"></i> Abrir WhatsApp</a>` : ''}
        ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-primary"><i data-lucide="send"></i> Enviar WA</a>` : ''}
      </div>
    `;
    container.appendChild(card);
  });

  // Re-inicializa ícones lucide se disponível
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Attach Event Listeners
  container.querySelectorAll('.btn-apify-det').forEach(btn => {
    btn.addEventListener('click', () => abrirModalApifyDetalhes(btn.dataset.id));
  });

  container.querySelectorAll('.btn-apify-ia').forEach(btn => {
    btn.addEventListener('click', () => abrirModalApifyIA(btn.dataset.id));
  });
}


// Modal Detalhes do Estabelecimento
function abrirModalApifyDetalhes(leadId) {
  let lead = stateApify.leads.find(l => String(l.id) === String(leadId));
  if (!lead && stateApify.pastaAtual && stateApify.pastaAtual.leads) {
    lead = stateApify.pastaAtual.leads.find(l => String(l.id) === String(leadId));
  }
  if (!lead) return;

  const modal = document.getElementById('modalApifyDetalhes');
  const title = document.getElementById('apifyDetTitle');
  const body = document.getElementById('apifyDetBody');

  title.textContent = lead.title;

  let horasHtml = 'Não informado';
  if (lead.openingHours) {
    if (Array.isArray(lead.openingHours)) {
      horasHtml = lead.openingHours.map(h => typeof h === 'string' ? h : (h.day ? `${h.day}: ${h.hours}` : JSON.stringify(h))).join('<br/>');
    } else if (typeof lead.openingHours === 'object') {
      horasHtml = JSON.stringify(lead.openingHours, null, 2);
    }
  }

  const nome = lead.title || 'Empresa';
  const notaVal = lead.rating ? lead.rating.toFixed(1) : '5';
  let cidade = 'sua região';
  if (lead.address) {
    const partes = lead.address.split(',');
    if (partes.length >= 2) {
      cidade = partes[partes.length - 2].trim();
    } else {
      cidade = lead.address.split('-').pop()?.trim() || 'sua região';
    }
  }

  const mensagemAbordagem = `Bom dia! Encontrei a *${nome}* aqui em ${cidade} e queria falar rapidinho com vocês.\n\nVi que a nota de vocês no Google é ${notaVal}, bem boa.\n\nSó que procurei o site de vocês e não achei nenhum.\n\nDigo isso porque quem procura decide rápido, quase sempre pelo primeiro que passa confiança.\n\nEu faço site pra empresa local. Se topar, monto uma amostra da ${nome} e te envio o link pra você julgar. Tudo bem?`;

  const waLink = lead.cleanPhone
    ? `https://web.whatsapp.com/send?phone=${lead.cleanPhone}&text=${encodeURIComponent(mensagemAbordagem)}`
    : null;

  body.innerHTML = `
    <div class="apify-det-grid">
      <div class="apify-det-item">
        <div class="apify-det-label">Telefone</div>
        <strong>${escHtml(lead.phone || 'Sem telefone')}</strong>
      </div>
      <div class="apify-det-item">
        <div class="apify-det-label">Categoria</div>
        <strong>${escHtml(lead.category || 'Não informada')}</strong>
      </div>
      <div class="apify-det-item">
        <div class="apify-det-label">Avaliação Google</div>
        <strong>${lead.rating ? `${lead.rating} ⭐ (${lead.reviewsCount || 0} avaliações)` : 'Sem notas'}</strong>
      </div>
      <div class="apify-det-item">
        <div class="apify-det-label">Website</div>
        ${lead.website ? `<a href="${lead.website}" target="_blank" style="color:var(--primary);word-break:break-all">${escHtml(lead.website)}</a>` : '<strong>NÃO POSSUI SITE</strong>'}
      </div>
    </div>

    <div class="apify-det-item" style="margin-bottom:14px">
      <div class="apify-det-label">Endereço Completo</div>
      <div>${escHtml(lead.address)}</div>
    </div>

    <div class="apify-det-item" style="margin-bottom:14px">
      <div class="apify-det-label">Horários de Funcionamento</div>
      <div style="font-size:12px;line-height:1.4">${horasHtml}</div>
    </div>

    <div style="display:flex;gap:10px;margin-top:18px">
      ${lead.url ? `<a href="${lead.url}" target="_blank" class="btn btn-secondary" style="flex:1;text-align:center">📍 Abrir no Google Maps</a>` : ''}
      ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-primary" style="flex:1;text-align:center">💬 Abrir no WhatsApp</a>` : ''}
    </div>
  `;

  modal.classList.remove('hidden');
}

document.getElementById('btnFecharApifyDetalhes')?.addEventListener('click', () => {
  document.getElementById('modalApifyDetalhes').classList.add('hidden');
});

// Modal Gemini IA Kit (Geração Instantânea sem gastar API)
async function abrirModalApifyIA(leadId, autoEnviar = false) {
  let lead = stateApify.leads.find(l => String(l.id) === String(leadId));
  if (!lead && stateApify.pastaAtual && stateApify.pastaAtual.leads) {
    lead = stateApify.pastaAtual.leads.find(l => String(l.id) === String(leadId));
  }
  if (!lead) return;

  stateApify.leadIaAtual = lead;

  const modal = document.getElementById('modalApifyIA');
  document.getElementById('apifyIaLeadNome').textContent = lead.title;
  document.getElementById('apifyIaLeadMeta').textContent = `${lead.category || 'Empresa'} · ${lead.address || ''}`;
  document.getElementById('apifyIaDiagnostico').textContent = '💡 Kit de Prospecção gerado com sucesso!';

  modal.classList.remove('hidden');

  try {
    const lang = stateApify.filtrosAtivos?.language || lead.language || lead.countryCode || 'pt';
    const res = await fetch('/api/apify/gerar-kit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead, hora: new Date().getHours(), lang }),
    });
    const data = await res.json();

    if (data.ok && data.kit) {
      const kit = data.kit;
      stateApify.kitIaAtual = kit;

      document.getElementById('apifyIaDiagnostico').textContent = `💡 ${kit.diagnostico || 'Lead analisado com sucesso!'}`;

      // Preenche os campos da sequência
      preencherSequenciaAbordagem(kit, lead);

      document.getElementById('textPropostaIa').value = kit.proposta || '';
      document.getElementById('textPromptSiteIa').value = kit.promptSite || '';

      toast('✨ Kit de Prospecção pronto com sequência de 3 mensagens!', 'success');

      if (autoEnviar && lead.cleanPhone && kit.msg1) {
        const linkWa = `https://web.whatsapp.com/send?phone=${lead.cleanPhone}&text=${encodeURIComponent(kit.msg1)}`;
        window.open(linkWa, '_blank');
      }
    }
  } catch (err) {
    console.error('Erro ao obter kit:', err);
  }
}

function preencherSequenciaAbordagem(kit, lead) {
  const modelo = document.getElementById('selectModeloScript')?.value || 'padrao';
  const hora = new Date().getHours();

  // Usa as mensagens já traduzidas do kit se fornecidas pelo backend
  let msg1 = kit?.msg1 || '';
  let msg2 = kit?.msg2 || '';
  let msg3 = kit?.msg3 || '';
  let saudacao = kit?.saudacao || 'Bom dia';

  if (!msg1) {
    saudacao = hora >= 12 && hora < 18 ? 'Boa tarde' : (hora >= 18 || hora < 5 ? 'Boa noite' : 'Bom dia');
    const nome = lead?.title || 'Empresa';
    let cat = (lead?.category || 'serviços').toLowerCase();

    if (modelo === 'alternativo') {
      msg1 = `${saudacao}! Eu falo com o responsável da *${nome}*?`;
      msg2 = `Eu tava dando uma olhada no perfil de vocês no Google mesmo e vi que vocês ainda não possuem um site.`;
      msg3 = `Eu faço site pra empresa local. Se topar, monto uma amostra da *${nome}* e te envio o link pra você julgar. Tudo bem?`;
    } else {
      msg1 = `${saudacao}! Eu falo com o responsável da *${nome}*?`;
      msg2 = `Notei aqui no perfil de vocês no Google que vocês ainda não tem uma página oficial para atender os clientes que pesquisam por ${cat} na região.`;
      msg3 = `Eu desenvolvo páginas focadas em converter essas buscas direto no WhatsApp. Se você topar, monto uma amostra com as informações e a identidade visual da *${nome}* sem custo nenhum para você dar uma olhada. O que acha?`;
    }
  }

  const badgeH = document.getElementById('badgeHorarioSaudacao');
  if (badgeH) badgeH.textContent = `${saudacao.toLowerCase().includes('good') || saudacao.toLowerCase().includes('bom') || saudacao.toLowerCase().includes('buenos') || saudacao.toLowerCase().includes('bonjour') || saudacao.toLowerCase().includes('guten') ? '☀️' : '🌙'} ${saudacao} (Automático)`;

  document.getElementById('textSeqMsg1').value = msg1;
  document.getElementById('textSeqMsg2').value = msg2;
  document.getElementById('textSeqMsg3').value = msg3;
  document.getElementById('textAbordagemIa').value = `${msg1}\n\n${msg2}\n\n${msg3}`;
}

document.getElementById('selectModeloScript')?.addEventListener('change', () => {
  if (stateApify.leadIaAtual) {
    preencherSequenciaAbordagem(stateApify.kitIaAtual, stateApify.leadIaAtual);
  }
});

// Handlers individuais para Copiar cada mensagem
document.getElementById('btnCopiarSeq1')?.addEventListener('click', () => {
  const txt = document.getElementById('textSeqMsg1').value;
  if (txt) { navigator.clipboard.writeText(txt); toast('📋 1ª Mensagem copiada!', 'success'); }
});
document.getElementById('btnCopiarSeq2')?.addEventListener('click', () => {
  const txt = document.getElementById('textSeqMsg2').value;
  if (txt) { navigator.clipboard.writeText(txt); toast('📋 2ª Mensagem copiada!', 'success'); }
});
document.getElementById('btnCopiarSeq3')?.addEventListener('click', () => {
  const txt = document.getElementById('textSeqMsg3').value;
  if (txt) { navigator.clipboard.writeText(txt); toast('📋 3ª Mensagem copiada!', 'success'); }
});

// Handlers individuais para Enviar via WhatsApp cada mensagem
function enviarMensagemSequencia(idTextarea, numMsg) {
  const lead = stateApify.leadIaAtual;
  const mensagem = document.getElementById(idTextarea).value.trim();
  const num = lead?.cleanPhone || lead?.phone?.replace(/\D/g, '');

  if (!num) {
    toast('Este lead não possui número de telefone válido.', 'warn');
    return;
  }
  if (!mensagem) {
    toast('A mensagem não pode estar vazia.', 'warn');
    return;
  }

  const linkWa = `https://web.whatsapp.com/send?phone=${num}&text=${encodeURIComponent(mensagem)}`;
  window.open(linkWa, '_blank');

  if (stateApify.pastaAtual && lead?.id) {
    registrarEnvioLeadPasta(stateApify.pastaAtual.id, lead.id);
  }
  toast(`🚀 WhatsApp Web aberto com a ${numMsg}ª mensagem!`, 'success');
}

document.getElementById('btnEnviarSeq1')?.addEventListener('click', () => enviarMensagemSequencia('textSeqMsg1', 1));
document.getElementById('btnEnviarSeq2')?.addEventListener('click', () => enviarMensagemSequencia('textSeqMsg2', 2));
document.getElementById('btnEnviarSeq3')?.addEventListener('click', () => enviarMensagemSequencia('textSeqMsg3', 3));

document.getElementById('btnFecharApifyIA')?.addEventListener('click', () => {
  document.getElementById('modalApifyIA').classList.add('hidden');
});

// Troca de Abas do Modal de IA
document.querySelectorAll('.tab-btn-ia').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn-ia').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const targetTab = btn.dataset.tab;
    document.querySelectorAll('.tab-content-ia').forEach(c => c.classList.add('hidden'));
    document.getElementById(targetTab)?.classList.remove('hidden');
  });
});

// Copiar Textos do Kit IA
document.getElementById('btnCopiarAbordagem')?.addEventListener('click', () => {
  const m1 = document.getElementById('textSeqMsg1').value;
  const m2 = document.getElementById('textSeqMsg2').value;
  const m3 = document.getElementById('textSeqMsg3').value;
  const txt = `${m1}\n\n${m2}\n\n${m3}`;
  if (txt) {
    navigator.clipboard.writeText(txt);
    toast('📋 Sequência completa copiada!', 'success');
  }
});

document.getElementById('btnCopiarProposta')?.addEventListener('click', () => {
  const txt = document.getElementById('textPropostaIa').value;
  if (txt) {
    navigator.clipboard.writeText(txt);
    toast('📋 Proposta copiada!', 'success');
  }
});

document.getElementById('btnCopiarPromptSite')?.addEventListener('click', () => {
  const txt = document.getElementById('textPromptSiteIa').value;
  if (txt) {
    navigator.clipboard.writeText(txt);
    toast('📋 Prompt do Site copiado!', 'success');
  }
});

// Envio Direto via WhatsApp Web com mensagem pré-preenchida em bloco
document.getElementById('btnEnviarWhatsAppIa')?.addEventListener('click', () => {
  const m1 = document.getElementById('textSeqMsg1').value;
  const m2 = document.getElementById('textSeqMsg2').value;
  const m3 = document.getElementById('textSeqMsg3').value;
  const mensagem = `${m1}\n\n${m2}\n\n${m3}`.trim();
  const lead = stateApify.leadIaAtual;
  const num = lead?.cleanPhone || lead?.phone?.replace(/\D/g, '');

  if (!num) {
    toast('Este lead não possui número de telefone válido.', 'warn');
    return;
  }

  const linkWa = `https://web.whatsapp.com/send?phone=${num}&text=${encodeURIComponent(mensagem)}`;
  window.open(linkWa, '_blank');

  if (stateApify.pastaAtual && lead?.id) {
    registrarEnvioLeadPasta(stateApify.pastaAtual.id, lead.id);
  }

  toast('🚀 WhatsApp Web aberto com a sequência completa!', 'success');
});

// =============================================
// SEÇÃO MEUS LEADS — PASTAS & CHECKPOINT SYSTEM
// =============================================

// Abrir Modal para Salvar Lista em Pasta
document.getElementById('btnAbrirModalSalvarPasta')?.addEventListener('click', () => {
  if (!stateApify.leads || stateApify.leads.length === 0) {
    toast('Nenhum lead capturado para salvar. Realize uma busca no Apify Scraper primeiro.', 'warn');
    return;
  }

  const modal = document.getElementById('modalSalvarPasta');
  const inputNome = document.getElementById('inputNomePasta');
  const inputInfo = document.getElementById('inputInfoPasta');
  const countEl = document.getElementById('countModalLeadsSalvar');

  // Preenche dados padrão baseados nos filtros da busca
  const categoria = stateApify.filtrosAtivos.category || 'Empresas';
  const cidade = stateApify.filtrosAtivos.city || '';
  const total = stateApify.leads.length;
  const dataHoje = new Date().toLocaleDateString('pt-BR');

  if (inputNome) {
    inputNome.value = cidade ? `${categoria} em ${cidade}` : `Pasta de Leads — ${categoria} (${dataHoje})`;
  }
  if (inputInfo) {
    inputInfo.value = `${categoria} · ${cidade || 'Brasil'} · ${total} leads sem site`;
  }
  if (countEl) {
    countEl.textContent = `${total} leads`;
  }

  modal.classList.remove('hidden');
});

// Fechar modal no X ou no Cancelar
const fecharModalSalvarPasta = () => {
  document.getElementById('modalSalvarPasta')?.classList.add('hidden');
};
document.getElementById('btnFecharSalvarPasta')?.addEventListener('click', fecharModalSalvarPasta);
document.getElementById('btnCancelarSalvarPasta')?.addEventListener('click', fecharModalSalvarPasta);

// Confirmar Salvar Lista em Pasta
document.getElementById('btnConfirmarSalvarPasta')?.addEventListener('click', async () => {
  const nome = document.getElementById('inputNomePasta')?.value.trim();
  const nichoInfo = document.getElementById('inputInfoPasta')?.value.trim();
  const localizacao = stateApify.filtrosAtivos.city || 'Brasil';

  if (!nome) {
    toast('Por favor, informe um nome para a pasta.', 'warn');
    return;
  }
  if (!stateApify.leads || stateApify.leads.length === 0) {
    toast('Nenhum lead disponível para salvar.', 'warn');
    return;
  }

  const btn = document.getElementById('btnConfirmarSalvarPasta');
  btn.disabled = true;
  btn.textContent = '💾 Salvando...';

  try {
    const res = await fetch('/api/apify/pastas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome,
        nichoInfo,
        localizacao,
        leads: stateApify.leads,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      toast(`Erro ao salvar pasta: ${data.erro}`, 'error');
      return;
    }

    toast(`✅ Pasta "${nome}" salva com ${stateApify.leads.length} leads!`, 'success', 5000);
    fecharModalSalvarPasta();

    // Navega para a aba Meus Leads e carrega as pastas
    navegarPara('meus-leads');
  } catch (err) {
    toast(`Erro ao conectar ao servidor: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="check"></i> Salvar Pasta e Ir para Meus Leads';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
});

// Limpar Lista do Apify Scraper sem apagar as pastas salvas
document.getElementById('btnApifyLimparLeads')?.addEventListener('click', () => {
  if (!stateApify.leads || stateApify.leads.length === 0) {
    toast('A lista de leads do Apify Scraper já está vazia.', 'info');
    return;
  }

  if (confirm('Limpar os resultados da tela do Apify Scraper? Seus leads salvos em "Meus Leads" continuarão guardados com segurança.')) {
    stateApify.leads = [];
    renderizarApifyLeads();

    const countSpan = document.getElementById('apifyCountLeads');
    if (countSpan) countSpan.textContent = '0';

    const badgeNav = document.getElementById('navBadgeApify');
    if (badgeNav) badgeNav.textContent = '';

    toast('🧹 Lista do Apify Scraper limpa! Pode realizar uma nova busca.', 'success');
  }
});

// Voltar da visualização interna da pasta para o Grid de Pastas
document.getElementById('btnVoltarGridPastas')?.addEventListener('click', () => {
  voltarParaGridPastas();
});

function voltarParaGridPastas() {
  stateApify.pastaAtual = null;
  document.getElementById('viewPastaDetalhes')?.classList.add('hidden');
  document.getElementById('viewGridPastas')?.classList.remove('hidden');
  carregarPastasLeads();
}

// Carregar Lista de Pastas
async function carregarPastasLeads() {
  const container = document.getElementById('containerGridPastas');
  if (!container) return;

  container.innerHTML = '<div class="empty-state"><span class="empty-icon">⏳</span><p>Carregando pastas...</p></div>';

  try {
    const res = await fetch('/api/apify/pastas');
    const data = await res.json();
    const pastas = Array.isArray(data) ? data : (data.pastas || []);
    stateApify.pastas = pastas;

    // Atualiza badge no menu lateral
    const badgeNav = document.getElementById('navBadgeMeusLeads');
    if (badgeNav) {
      badgeNav.textContent = pastas.length > 0 ? pastas.length : '';
    }

    renderizarGridPastas(pastas);
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:var(--error)"><p>Erro ao carregar pastas: ${err.message}</p></div>`;
  }
}

// Renderizar Grid de Cards de Pastas
function renderizarGridPastas(pastas) {
  const container = document.getElementById('containerGridPastas');
  if (!container) return;

  if (!pastas || pastas.length === 0) {
    container.innerHTML = `
      <div class="apify-empty-state" style="grid-column:1/-1">
        <i data-lucide="folder-plus" style="width:40px;height:40px;color:var(--text3);margin-bottom:10px"></i>
        <p style="font-size:15px;font-weight:600;margin:0">Nenhuma pasta de leads salva ainda.</p>
        <p style="font-size:13px;color:var(--text-muted);margin-top:6px">
          Faça uma busca no <strong>Apify Scraper</strong> e clique em <strong>"Salvar Lista em Pasta"</strong> para organizar seus prospects por nicho ou região.
        </p>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  container.innerHTML = '';
  pastas.forEach((pasta) => {
    const totalLeads = pasta.leads ? pasta.leads.length : (pasta.totalLeads || 0);
    const enviadosCount = pasta.leads ? pasta.leads.filter(l => l.statusEnvio === 'enviado').length : (pasta.enviadosCount || 0);
    const pctProgresso = totalLeads > 0 ? Math.round((enviadosCount / totalLeads) * 100) : 0;

    let ultimoInfo = 'Nenhum envio realizado ainda';
    if (pasta.ultimoCheckpointNome) {
      const dataFmt = pasta.ultimoCheckpointData
        ? new Date(pasta.ultimoCheckpointData).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';
      ultimoInfo = `Último envio: <strong>${escHtml(pasta.ultimoCheckpointNome)}</strong> (${dataFmt})`;
    }

    const dataCriacao = pasta.criadoEm ? new Date(pasta.criadoEm).toLocaleDateString('pt-BR') : '';

    const card = document.createElement('div');
    card.className = 'card-pasta';
    card.innerHTML = `
      <div>
        <div class="card-pasta-header">
          <div class="card-pasta-icon">
            <i data-lucide="folder"></i>
          </div>
          <div style="flex:1">
            <h3 class="card-pasta-title">${escHtml(pasta.nome)}</h3>
            <div class="card-pasta-meta">
              <div class="card-pasta-meta-row">
                <i data-lucide="tag" style="width:12px;height:12px"></i> ${escHtml(pasta.nichoInfo || 'Prospects')}
              </div>
              <div class="card-pasta-meta-row">
                <i data-lucide="calendar" style="width:12px;height:12px"></i> Criado em ${dataCriacao}
              </div>
            </div>
          </div>
        </div>

        <div class="card-pasta-progress-wrap">
          <div class="card-pasta-progress-header">
            <span>Progresso de Envio</span>
            <span style="color:var(--primary);font-weight:700">${enviadosCount}/${totalLeads} (${pctProgresso}%)</span>
          </div>
          <div class="card-pasta-progress-bar">
            <div class="card-pasta-progress-fill" style="width: ${pctProgresso}%"></div>
          </div>
          <div style="font-size:11.5px;color:var(--text3);margin-top:6px">
            ${ultimoInfo}
          </div>
        </div>
      </div>

      <div class="card-pasta-actions">
        <button class="btn btn-secondary btn-excluir-pasta" data-id="${pasta.id}" title="Excluir Pasta">
          <i data-lucide="trash-2" style="width:14px;height:14px;color:var(--red)"></i> Excluir
        </button>
        <button class="btn btn-primary btn-abrir-pasta" data-id="${pasta.id}">
          <i data-lucide="folder-open" style="width:14px;height:14px"></i> Abrir Pasta
        </button>
      </div>
    `;

    container.appendChild(card);
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Attach Event Listeners nos cards
  container.querySelectorAll('.btn-abrir-pasta').forEach(btn => {
    btn.addEventListener('click', () => abrirPastaDetalhes(btn.dataset.id));
  });

  container.querySelectorAll('.btn-excluir-pasta').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      excluirPastaLeads(btn.dataset.id);
    });
  });
}

// Abrir Detalhes da Pasta e Exibir Leads com Checkpoint
async function abrirPastaDetalhes(pastaId) {
  try {
    const res = await fetch(`/api/apify/pastas/${pastaId}`);
    const data = await res.json();
    const pasta = data.pasta || data;

    if (!res.ok || !pasta) {
      toast(`Erro ao carregar pasta`, 'error');
      return;
    }

    stateApify.pastaAtual = pasta;

    // Troca telas
    document.getElementById('viewGridPastas')?.classList.add('hidden');
    document.getElementById('viewPastaDetalhes')?.classList.remove('hidden');

    // Preenche cabeçalho com os dados reais da pasta
    const titleEl = document.getElementById('pastaDetNome');
    if (titleEl) titleEl.textContent = pasta.nome || 'Pasta de Leads';

    const subEl = document.getElementById('pastaDetNichoInfo');
    if (subEl) subEl.textContent = `${pasta.nichoInfo || 'Prospects'} · ${pasta.localizacao || 'Brasil'}`;

    // Handlers botões de topo
    const btnVoltar = document.getElementById('btnVoltarPastas');
    if (btnVoltar) btnVoltar.onclick = voltarParaGridPastas;

    const btnExcluir = document.getElementById('btnExcluirPastaAtual');
    if (btnExcluir) btnExcluir.onclick = () => excluirPastaLeads(pasta.id);

    // Filter texto interno da pasta
    const inputFiltro = document.getElementById('filtroPastaLeadsTexto');
    if (inputFiltro) {
      inputFiltro.oninput = (e) => renderizarLeadsPasta(pasta, e.target.value.trim());
    }

    // Atualiza Checkpoint Banner
    atualizarBannerCheckpoint(pasta);

    // Renderiza grid de leads da pasta
    renderizarLeadsPasta(pasta);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    toast(`Erro ao abrir pasta: ${err.message}`, 'error');
  }
}

// Atualizar Banner de Checkpoint
function atualizarBannerCheckpoint(pasta) {
  const container = document.getElementById('cardPastaCheckpoint');
  if (!container) return;

  const total = pasta.leads ? pasta.leads.length : 0;
  const enviados = pasta.leads ? pasta.leads.filter(l => l.statusEnvio === 'enviado').length : 0;
  const pendentes = total - enviados;

  let ultimoTxt = 'Nenhum lead contatado ainda nesta pasta.';
  if (pasta.ultimoCheckpointNome) {
    const dt = pasta.ultimoCheckpointData
      ? new Date(pasta.ultimoCheckpointData).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';
    ultimoTxt = `Parado em: <strong>${escHtml(pasta.ultimoCheckpointNome)}</strong> (${dt})`;
  }

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span class="apify-badge oportunidade" style="font-size:12px;padding:3px 10px;background:#FACC15;color:#0B0F17;font-weight:700">📍 CHECKPOINT DE PARADA</span>
          <span style="font-size:12px;color:var(--text3)">${enviados}/${total} contatados · ${pendentes} pendentes</span>
        </div>
        <h4 style="margin:0 0 4px;font-size:16px;font-weight:700;color:var(--text)">${ultimoTxt}</h4>
        <p style="margin:0;font-size:13px;color:var(--text3)">Clique no botão para rolar até o lead onde você parou e continuar.</p>
      </div>
      <div>
        <button class="btn btn-primary btn-lg" id="btnContinuarCheckpointPasta" style="border-radius:12px;background:#FACC15;color:#0B0F17;font-weight:700;border:none">
          <i data-lucide="play"></i> Continuar Envio do Checkpoint
        </button>
      </div>
    </div>
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();

  document.getElementById('btnContinuarCheckpointPasta')?.addEventListener('click', () => {
    continuarCheckpointPasta(pasta.id);
  });
}

// Continuar Envio a partir do Checkpoint na Pasta
function continuarCheckpointPasta(pastaId) {
  const pasta = stateApify.pastaAtual;
  if (!pasta || !pasta.leads || pasta.leads.length === 0) return;

  const idUltimo = pasta.ultimoCheckpointId;
  const indexParada = pasta.leads.findIndex(l => l.id === idUltimo);
  let targetLead = null;

  if (idUltimo && indexParada >= 0) {
    // Rola até o ÚLTIMO lead com interação (onde o usuário parou)
    targetLead = pasta.leads[indexParada];
  } else {
    // Sem checkpoint: vai para o primeiro lead
    targetLead = pasta.leads[0];
  }

  if (targetLead) {
    const cardEl = document.getElementById(`pasta-lead-${targetLead.id}`);
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cardEl.classList.remove('lead-highlight-checkpoint');
      void cardEl.offsetWidth;
      cardEl.classList.add('lead-highlight-checkpoint');
      toast(`📍 Checkpoint: ${targetLead.title}`, 'info');
    }
  }
}

// Renderizar Leads da Pasta em Visualização Detalhada
function renderizarLeadsPasta(pasta, filtro = '') {
  const container = document.getElementById('gridPastaLeadsItems');
  if (!container) return;

  container.innerHTML = '';
  const termo = filtro.toLowerCase();

  const leadsList = (pasta.leads || []).filter(l =>
    (l.title || '').toLowerCase().includes(termo) ||
    (l.category || '').toLowerCase().includes(termo) ||
    (l.address || '').toLowerCase().includes(termo)
  );

  if (leadsList.length === 0) {
    container.innerHTML = `<div class="apify-empty-state"><p>${filtro ? 'Nenhum lead encontrado com este termo.' : 'Nenhum lead armazenado nesta pasta.'}</p></div>`;
    return;
  }

  const idUltimoCheckpoint = pasta.ultimoCheckpointId;

  leadsList.forEach((lead) => {
    const card = document.createElement('div');
    const isUltimoParou = lead.id === idUltimoCheckpoint;
    const isEnviado = lead.statusEnvio === 'enviado';

    card.className = `apify-lead-card ${isUltimoParou ? 'lead-checkpoint-parou' : ''}`;
    card.id = `pasta-lead-${lead.id}`;

    const score = calcularScoreLead(lead);
    const scoreClass = score >= 80 ? 'score-high' : (score >= 50 ? 'score-mid' : 'score-low');
    const nome = lead.title || 'Empresa';
    const notaVal = lead.rating ? lead.rating.toFixed(1) : '5';

    let cidade = 'sua região';
    if (lead.address) {
      const partes = lead.address.split(',');
      if (partes.length >= 2) {
        cidade = partes[partes.length - 2].trim();
      } else {
        cidade = lead.address.split('-').pop()?.trim() || 'sua região';
      }
    }

    const mensagemAbordagem = `Bom dia! Encontrei a *${nome}* aqui em ${cidade} e queria falar rapidinho com vocês.\n\nVi que a nota de vocês no Google é ${notaVal}, bem boa.\n\nSó que procurei o site de vocês e não achei nenhum.\n\nDigo isso porque quem procura decide rápido, quase sempre pelo primeiro que passa confiança.\n\nEu faço site pra empresa local. Se topar, monto uma amostra da ${nome} e te envio o link pra você julgar. Tudo bem?`;

    const cleanNum = lead.cleanPhone || lead.phone?.replace(/\D/g, '');
    const waLink = cleanNum
      ? `https://web.whatsapp.com/send?phone=${cleanNum}&text=${encodeURIComponent(mensagemAbordagem)}`
      : null;

    card.innerHTML = `
      <div class="apify-lead-header">
        <div class="apify-lead-info">
          <h4 class="apify-lead-nome">${escHtml(lead.title)}</h4>
          <div class="apify-lead-meta">
            <span>Categoria: ${escHtml(lead.category || 'Não informada')}</span>
            <span>·</span>
            <span>Endereço: ${escHtml(lead.address || 'Não disponível')}</span>
          </div>
        </div>
        <div class="apify-lead-score ${scoreClass}" title="Score de Oportunidade de Venda">
          ${score}
          <small>SCORE</small>
        </div>
      </div>

      <div class="apify-lead-badges">
        ${isUltimoParou ? `<span class="badge-checkpoint-parou"><i data-lucide="pin" style="width:12px;height:12px"></i> 📍 VOCÊ PAROU AQUI!</span>` : ''}
        ${isEnviado
          ? `<span class="apify-badge tem-site" style="background:rgba(16,185,129,0.2);color:#34d399;border-color:rgba(16,185,129,0.4)">✓ Abordagem Enviada</span>`
          : `<span class="apify-badge sem-site">Pendente de Envio</span>`
        }
        ${!lead.website ? `<span class="apify-badge oportunidade">Alta Oportunidade</span>` : `<span class="apify-badge tem-site">Possui Site</span>`}
        ${lead.phone ? `<span class="apify-badge location">Com Celular / WhatsApp</span>` : ''}
      </div>

      <div class="apify-lead-stats">
        <div class="apify-stat">
          <div class="apify-stat-label">Nota Google</div>
          <div class="apify-stat-value" style="color:#facc15">
            ${lead.rating ? `Nota ${lead.rating.toFixed(1)}` : '—'}
          </div>
        </div>
        <div class="apify-stat">
          <div class="apify-stat-label">Avaliações</div>
          <div class="apify-stat-value">${lead.reviewsCount || 0}</div>
        </div>
        <div class="apify-stat">
          <div class="apify-stat-label">Contato</div>
          <div class="apify-stat-value" style="font-size:13px;font-family:var(--mono)">
            ${escHtml(lead.phone || 'Indisponível')}
          </div>
        </div>
        <div class="apify-stat">
          <div class="apify-stat-label">Website</div>
          <div class="apify-stat-value" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${lead.website ? `<a href="${lead.website}" target="_blank" style="color:var(--primary)">${escHtml(lead.website.replace(/^https?:\/\/(www\.)?/, '').substring(0, 20))}</a>` : '<span style="color:#f87171">Sem site</span>'}
          </div>
        </div>
      </div>

      <div class="apify-lead-actions">
        <button class="btn btn-secondary btn-pasta-det" data-id="${lead.id}"><i data-lucide="info"></i> Detalhes</button>
        <button class="btn btn-primary btn-pasta-ia" data-id="${lead.id}"><i data-lucide="sparkles"></i> Gerar Abordagem IA</button>
        ${lead.url ? `<a href="${lead.url}" target="_blank" class="btn btn-secondary btn-pasta-maps" data-id="${lead.id}"><i data-lucide="map-pin"></i> Abrir Maps</a>` : ''}
        ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-secondary btn-pasta-wa-open" data-id="${lead.id}"><i data-lucide="message-square"></i> Abrir WhatsApp</a>` : ''}
        ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-primary btn-pasta-wa-send" data-id="${lead.id}"><i data-lucide="send"></i> Enviar WA</a>` : ''}
      </div>
    `;

    container.appendChild(card);
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();

  container.querySelectorAll('.btn-pasta-det').forEach(btn => {
    btn.addEventListener('click', () => {
      registrarCheckpointPasta(pasta.id, btn.dataset.id);
      abrirModalApifyDetalhes(btn.dataset.id);
    });
  });

  container.querySelectorAll('.btn-pasta-ia').forEach(btn => {
    btn.addEventListener('click', () => {
      registrarCheckpointPasta(pasta.id, btn.dataset.id);
      abrirModalApifyIA(btn.dataset.id);
    });
  });

  container.querySelectorAll('.btn-pasta-maps').forEach(btn => {
    btn.addEventListener('click', () => {
      registrarCheckpointPasta(pasta.id, btn.dataset.id);
    });
  });

  container.querySelectorAll('.btn-pasta-wa-open').forEach(btn => {
    btn.addEventListener('click', () => {
      registrarCheckpointPasta(pasta.id, btn.dataset.id);
    });
  });

  container.querySelectorAll('.btn-pasta-wa-send').forEach(btn => {
    btn.addEventListener('click', () => {
      registrarEnvioLeadPasta(pasta.id, btn.dataset.id);
    });
  });
}

// Registrar apenas Checkpoint (qualquer interação com o lead)
async function registrarCheckpointPasta(pastaId, leadId) {
  try {
    const res = await fetch(`/api/apify/pastas/${pastaId}/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId }),
    });
    const data = await res.json();

    if (res.ok && data.ok && data.pasta) {
      stateApify.pastaAtual = data.pasta;
      atualizarBannerCheckpoint(data.pasta);
      // Atualiza os badges "VOCÊ PAROU AQUI!" sem re-renderizar todo a grid (evita fechar modal/piscar)
      const container = document.getElementById('gridPastaLeadsItems');
      if (container) {
        container.querySelectorAll('.badge-checkpoint-parou').forEach(el => el.remove());
        const cardTarget = container.querySelector(`[data-id="${leadId}"]`)?.closest('.apify-lead-card');
        if (cardTarget) {
          const badgesWrap = cardTarget.querySelector('.apify-lead-badges');
          if (badgesWrap && !badgesWrap.querySelector('.badge-checkpoint-parou')) {
            const badge = document.createElement('span');
            badge.className = 'badge-checkpoint-parou';
            badge.innerHTML = '<i data-lucide="pin" style="width:12px;height:12px"></i> 📍 VOCÊ PAROU AQUI!';
            badgesWrap.insertBefore(badge, badgesWrap.firstChild);
            if (typeof lucide !== 'undefined') lucide.createIcons();
          }
        }
      }
    }
  } catch (err) {
    console.error('Erro ao atualizar checkpoint:', err);
  }
}

// Registrar envio de WhatsApp para um lead dentro da pasta
async function registrarEnvioLeadPasta(pastaId, leadId) {
  try {
    const res = await fetch(`/api/apify/pastas/${pastaId}/envio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId }),
    });
    const data = await res.json();

    if (res.ok && data.ok && data.pasta) {
      stateApify.pastaAtual = data.pasta;
      atualizarBannerCheckpoint(data.pasta);
      renderizarLeadsPasta(data.pasta, document.getElementById('filtroPastaLeadsTexto')?.value || '');
    }
  } catch (err) {
    console.error('Erro ao atualizar envio:', err);
  }
}

// Excluir Pasta de Leads
async function excluirPastaLeads(pastaId) {
  if (!confirm('Deseja realmente excluir esta pasta de leads? Esta ação não pode ser desfeita.')) return;

  try {
    const res = await fetch(`/api/apify/pastas/${pastaId}`, { method: 'DELETE' });
    const data = await res.json();

    if (res.ok && data.ok) {
      toast('🗑️ Pasta excluída com sucesso.', 'success');
      voltarParaGridPastas();
    } else {
      toast(`Erro ao excluir: ${data.erro}`, 'error');
    }
  } catch (err) {
    toast(`Erro ao conectar ao servidor: ${err.message}`, 'error');
  }
}

// =============================================
// DASHBOARD FINANCIAL & STATS BENTO
// =============================================
let _dashPeriodoAtual = '30d';
let _dashDataInicio = '';
let _dashDataFim = '';

async function carregarDashboardStats() {
  try {
    const params = new URLSearchParams({ periodo: _dashPeriodoAtual });
    if (_dashPeriodoAtual === 'custom' && _dashDataInicio && _dashDataFim) {
      params.append('dataInicio', _dashDataInicio);
      params.append('dataFim', _dashDataFim);
    }

    const res = await fetch(`/api/dashboard/stats?${params}`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const s = data.summary || {};
    const chartData = data.chartData || [];

    // Preenche estatísticas do Bento Grid
    const faturadoEl = document.getElementById('dashTotalFaturado');
    if (faturadoEl) {
      faturadoEl.textContent = (s.totalFaturado || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    const vendasEl = document.getElementById('dashQtdVendas');
    if (vendasEl) vendasEl.textContent = s.qtdVendas || 0;

    const conversaoEl = document.getElementById('dashTaxaConversao');
    if (conversaoEl) conversaoEl.textContent = s.taxaConversao || '0%';

    const pendenteEl = document.getElementById('dashTotalPendente');
    if (pendenteEl) {
      pendenteEl.textContent = (s.totalPendente || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    const totalCobrancasMeta = document.getElementById('dashTotalCobrancasMeta');
    if (totalCobrancasMeta) {
      totalCobrancasMeta.textContent = `${s.totalCobrancas || 0} cobranças geradas no período`;
    }

    // Badge de crescimento faturamento
    const growthBadge = document.getElementById('dashGrowthBadge');
    if (growthBadge) {
      const gVal = (s.totalFaturado > 0) ? '+100%' : '0%';
      growthBadge.textContent = `${gVal} receita ativa`;
    }

    // Badge de crescimento vendas
    const vendasGrowthBadge = document.getElementById('dashVendasGrowthBadge');
    if (vendasGrowthBadge) {
      const vVal = (s.qtdVendas > 0) ? `+${s.qtdVendas}` : '0';
      vendasGrowthBadge.textContent = `${vVal} vendas ativas`;
    }

    // Renderiza Gráfico estilo Recharts Cashflow (Line + Area SVG)
    renderizarGraficoCashflow(chartData);

  } catch (err) {
    console.error('Erro ao carregar stats do dashboard:', err);
  }
}

// Sparkline de Barras no Bento Card
function renderizarSparkline(chartData) {
  const container = document.getElementById('dashSparkline');
  if (!container) return;

  container.innerHTML = '';
  if (!chartData || !chartData.length) {
    return;
  }

  const maxVal = Math.max(...chartData.map(d => d.value), 1);
  const items = chartData.slice(-12);
  const hasData = items.some(i => i.value > 0);

  items.forEach(item => {
    const bar = document.createElement('div');
    bar.className = 'bento-bar';
    const pct = hasData ? Math.max(Math.round((item.value / maxVal) * 100), 8) : 8;
    bar.style.height = `${pct}%`;
    if (!hasData) bar.style.opacity = '0.3';
    bar.title = `${item.label}: R$ ${item.value.toLocaleString('pt-BR')}`;
    container.appendChild(bar);
  });
}

// Renderiza Gráfico Recharts-Style Composite SVG
function renderizarGraficoCashflow(chartData) {
  const dateRangeEl = document.getElementById('dashChartDateRange');
  if (dateRangeEl) {
    const rotulos = {
      'hoje': 'Faturamento de Hoje',
      'ontem': 'Faturamento de Ontem',
      '7d': 'Últimos 7 dias',
      '30d': 'Últimos 30 dias',
      'custom': `${_dashDataInicio} até ${_dashDataFim}`
    };
    dateRangeEl.textContent = rotulos[_dashPeriodoAtual] || 'Período Selecionado';
  }

  const svg = document.getElementById('svgDashChart');
  if (!svg) return;

  const linePath = document.getElementById('svgLinePath');
  const areaPath = document.getElementById('svgAreaPath');
  const xAxisGroup = document.getElementById('svgXAxis');
  const yAxisGroup = document.getElementById('svgYAxis');
  const dotsGroup = document.getElementById('svgDots');

  xAxisGroup.innerHTML = '';
  yAxisGroup.innerHTML = '';
  dotsGroup.innerHTML = '';

  let pointsData = chartData;
  if (!pointsData || pointsData.length === 0) {
    pointsData = [
      { label: 'SEM 1', value: 0 },
      { label: 'SEM 2', value: 0 },
      { label: 'SEM 3', value: 0 },
      { label: 'SEM 4', value: 0 }
    ];
  }

  const paddingLeft = 55;
  const paddingRight = 30;
  const paddingTop = 30;
  const paddingBottom = 40;
  const width = 800;
  const height = 300;

  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  const rawMax = Math.max(...pointsData.map(d => d.value), 0);
  const maxVal = rawMax > 0 ? Math.ceil(rawMax * 1.25) : 100;
  const minVal = 0;

  // Eixo Y (Labels 0, 20, 40, etc.)
  const tickCount = 4;
  for (let i = 0; i <= tickCount; i++) {
    const val = (maxVal / tickCount) * i;
    const y = height - paddingBottom - (i / tickCount) * chartH;
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', paddingLeft - 12);
    text.setAttribute('y', y + 4);
    text.textContent = val >= 1000 ? `${(val / 1000).toFixed(1)}k` : `R$ ${Math.round(val)}`;
    yAxisGroup.appendChild(text);
  }

  // Coordenadas dos pontos
  const coords = pointsData.map((item, idx) => {
    const step = pointsData.length > 1 ? chartW / (pointsData.length - 1) : chartW;
    const x = paddingLeft + (pointsData.length > 1 ? idx * step : chartW / 2);
    const ratio = (item.value - minVal) / (maxVal - minVal || 1);
    const y = height - paddingBottom - ratio * chartH;
    return { x, y, data: item };
  });

  // Eixo X Labels (Amostragem inteligente para evitar encavalar texto: máx 7 rótulos)
  const totalPts = coords.length;
  const stepX = Math.max(1, Math.floor(totalPts / 6));

  coords.forEach((pt, idx) => {
    if (idx % stepX === 0 || idx === totalPts - 1) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', pt.x);
      text.setAttribute('y', height - 12);
      text.textContent = pt.data.label;
      xAxisGroup.appendChild(text);
    }
  });

  // Path SVG Line & Area com curvas suaves (type="monotone" Bezier Spline)
  function getMonotonePath(pts) {
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
    if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

    let path = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? i : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return path;
  }

  const dLine = getMonotonePath(coords);
  const dArea = `${dLine} L ${coords[coords.length - 1].x} ${height - paddingBottom} L ${coords[0].x} ${height - paddingBottom} Z`;

  linePath.setAttribute('d', dLine);
  areaPath.setAttribute('d', dArea);

  // Renderiza bolinhas apenas onde houver valor > 0 ou no ponto ativo
  coords.forEach((pt) => {
    if (pt.data.value > 0) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pt.x);
      circle.setAttribute('cy', pt.y);
      circle.setAttribute('r', 6);
      circle.setAttribute('fill', '#10B981');
      circle.setAttribute('stroke', '#FFFFFF');
      circle.setAttribute('stroke-width', '2');
      circle.setAttribute('filter', 'url(#dotShadow)');
      circle.style.cursor = 'pointer';

      circle.addEventListener('mouseenter', () => mostrarTooltipGrafico(pt, svg));
      circle.addEventListener('mouseleave', () => ocultarTooltipGrafico());

      dotsGroup.appendChild(circle);
    }
  });

  // Adiciona listener global no SVG para interatividade em qualquer ponto da linha
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (800 / rect.width);
    let closestPt = coords[0];
    let minDist = Math.abs(mouseX - coords[0].x);

    for (let i = 1; i < coords.length; i++) {
      const dist = Math.abs(mouseX - coords[i].x);
      if (dist < minDist) {
        minDist = dist;
        closestPt = coords[i];
      }
    }

    if (closestPt) mostrarTooltipGrafico(closestPt, svg);
  };

  svg.onmouseleave = () => ocultarTooltipGrafico();
}

// Interactive Tooltip
function mostrarTooltipGrafico(pt, svg) {
  const tooltip = document.getElementById('dashChartTooltip');
  const cursorLine = document.getElementById('svgCursorLine');
  const labelEl = document.getElementById('tooltipLabel');
  const valEl = document.getElementById('tooltipVal');
  const subEl = document.getElementById('tooltipSub');

  if (!tooltip || !cursorLine) return;

  const rect = svg.getBoundingClientRect();
  const scaleX = rect.width / 800;

  cursorLine.setAttribute('x1', pt.x);
  cursorLine.setAttribute('x2', pt.x);
  cursorLine.setAttribute('opacity', '1');

  labelEl.textContent = pt.data.label;
  valEl.textContent = (pt.data.value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  subEl.textContent = `${pt.data.count || 0} venda(s)`;

  tooltip.classList.remove('hidden');
  const tooltipX = pt.x * scaleX - 60;
  const tooltipY = (pt.y * (rect.height / 300)) - 75;

  tooltip.style.left = `${Math.max(10, tooltipX)}px`;
  tooltip.style.top = `${Math.max(10, tooltipY)}px`;
}

function ocultarTooltipGrafico() {
  const tooltip = document.getElementById('dashChartTooltip');
  const cursorLine = document.getElementById('svgCursorLine');
  if (tooltip) tooltip.classList.add('hidden');
  if (cursorLine) cursorLine.setAttribute('opacity', '0');
}

// Event Listeners para Período e Modal Calendário Preto
document.querySelectorAll('.btn-dash-period').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.id === 'btnPeriodoPersonalizado') {
      abrirModalCalendario();
      return;
    }

    document.querySelectorAll('.btn-dash-period').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    _dashPeriodoAtual = btn.dataset.period;
    carregarDashboardStats();
  });
});

function abrirModalCalendario() {
  const modal = document.getElementById('modalCalendarioPreto');
  if (modal) modal.classList.remove('hidden');
}

function fecharModalCalendario() {
  const modal = document.getElementById('modalCalendarioPreto');
  if (modal) modal.classList.add('hidden');
}

document.getElementById('btnFecharModalCalendario')?.addEventListener('click', fecharModalCalendario);
document.getElementById('btnCancelarCalendario')?.addEventListener('click', fecharModalCalendario);
document.getElementById('modalCalendarioPreto')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) fecharModalCalendario();
});

document.getElementById('btnAplicarCalendario')?.addEventListener('click', () => {
  const dIn = document.getElementById('dashDataInicio')?.value;
  const dFi = document.getElementById('dashDataFim')?.value;

  if (!dIn || !dFi) {
    toast('Selecione ambas as datas de início e fim', 'warn');
    return;
  }

  _dashPeriodoAtual = 'custom';
  _dashDataInicio = dIn;
  _dashDataFim = dFi;

  document.querySelectorAll('.btn-dash-period').forEach(b => b.classList.remove('active'));
  const btnCustom = document.getElementById('btnPeriodoPersonalizado');
  if (btnCustom) {
    btnCustom.classList.add('active');
    const label = document.getElementById('labelPeriodoCustom');
    if (label) label.textContent = `${dIn.split('-').reverse().join('/')} - ${dFi.split('-').reverse().join('/')}`;
  }

  fecharModalCalendario();
  carregarDashboardStats();
});

// Carrega dashboard ao abrir a página ou navegar para 'controle'
carregarDashboardStats();



