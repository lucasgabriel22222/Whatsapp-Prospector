# 🚀 WhatsApp Prospector B2B

Bot de prospecção automática para WhatsApp com scraping do Google Maps e respostas inteligentes via **Gemini AI**.

---

## 📦 Instalação

### 1. Pré-requisitos
- Node.js 18+ instalado
- Evolution API rodando localmente (ou em servidor)
- Conta Google AI Studio para chave Gemini (gratuita)

### 2. Instalar dependências

```bash
cd "D:\Gen rockstar\whatsapp-prospector"
npm install
npx playwright install chromium
```

### 3. Configurar o `.env`

Edite o arquivo `.env` com suas credenciais:

```env
EVOLUTION_API_URL=http://localhost:8080
API_KEY=sua_api_key_da_evolution
INSTANCE_NAME=minha_instancia

GEMINI_API_KEY=sua_chave_gemini_aqui
```

**Onde conseguir as chaves:**
- **Gemini API Key** → [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (gratuito)
- **Evolution API Key** → Painel da Evolution API → Settings → API Key

---

## 🎯 Como Usar

### Passo 1 — Coletar leads do Google Maps

```bash
# Formato: node scraper.js "BUSCA" QUANTIDADE
node scraper.js "clínicas de psicologia São Paulo" 50
node scraper.js "academias de ginástica Curitiba" 100
node scraper.js "salões de beleza Belo Horizonte" 30
```

Salva automaticamente em `data/leads.csv`.

### Passo 2 — Disparar mensagens

```bash
node disparador.js
```

- Lê o `leads.csv` automaticamente
- Delay aleatório de 45–90s entre envios (anti-ban)
- Mostra progresso em tempo real
- Salva relatório em `logs/relatorio_envios.json`

### Passo 3 — Ativar respostas automáticas com IA

Em um **segundo terminal**, rode:

```bash
node listener.js
```

Depois configure o webhook na Evolution API:
- Dashboard → Sua Instância → Webhook
- URL: `http://localhost:3001/webhook` (ou o IP do servidor)

### Ver relatório

```bash
node relatorio.js
```

---

## 🗂️ Estrutura do Projeto

```
whatsapp-prospector/
├── scraper.js          # Coleta empresas do Google Maps
├── disparador.js       # Envia mensagens em massa
├── listener.js         # Responde mensagens com IA
├── relatorio.js        # Painel de status
├── config.js           # Configuração central
├── .env                # Suas credenciais (NÃO commitar)
├── modules/
│   ├── messages.js     # Templates e spintax
│   ├── ai_responder.js # Integração Gemini AI
│   └── evolution.js    # Integração Evolution API
├── data/
│   ├── leads.csv       # Leads coletados pelo scraper
│   ├── enviados.json   # Controle de enviados
│   └── conversas.json  # Histórico de conversas
└── logs/
    └── relatorio_envios.json  # Relatórios de sessão
```

---

## ⚙️ Configurações do `.env`

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `EVOLUTION_API_URL` | URL da Evolution API | `http://localhost:8080` |
| `API_KEY` | Chave da Evolution API | — |
| `INSTANCE_NAME` | Nome da instância WA | — |
| `GEMINI_API_KEY` | Chave da API Gemini | — |
| `DELAY_MIN` | Delay mínimo entre envios (s) | `45` |
| `DELAY_MAX` | Delay máximo entre envios (s) | `90` |
| `LIMITE_ENVIOS` | Máx. envios por sessão (0 = ilimitado) | `50` |
| `SCRAPER_MAX_RESULTS` | Máx. resultados por scraping | `50` |
| `SCRAPER_HEADLESS` | Ocultar navegador | `true` |
| `WEBHOOK_PORT` | Porta do listener | `3001` |

---

## 🤖 Como funciona a IA

O **Gemini 1.5 Flash** atua como um assistente comercial chamado "Rafael":

1. **Classifica** a intenção de cada resposta recebida
2. **Gera respostas** contextuais baseadas no histórico da conversa
3. **Analisa** o estágio de cada lead (quente/morno/frio)
4. **Encerra** automaticamente conversas negativas

---

## 🛡️ Anti-Ban

- Delay aleatório de 45–90s entre mensagens
- Simula "digitando..." via `presence: composing`
- Delay de digitação proporcional ao tamanho da mensagem
- Spintax com 126+ combinações de mensagens diferentes
- Nunca envia para o mesmo número duas vezes

---

## 📊 Adaptando para outras fontes (futuro)

Para usar com outras fontes além do Google Maps, basta criar um novo arquivo de scraping que gere um CSV com as colunas:

```
title, phone, address, category, website, ...
```

O `disparador.js` lê qualquer CSV nesse formato.

---

## ⚠️ Uso Responsável

- Respeite os Termos de Serviço do WhatsApp
- Inclua sempre opção de opt-out ("pode me tirar da lista")
- Não envie mais de 100–150 mensagens/dia no mesmo número
- Use apenas para prospecção legítima de negócios
