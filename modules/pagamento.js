// =============================================
// modules/pagamento.js — Mercado Pago Checkout Pro (Produção)
// Gera preferências Checkout Pro: PIX, Cartão de Crédito, Boleto, Mercado Pago etc.
// =============================================
import axios from 'axios';

const BASE_URL = 'https://api.mercadopago.com';

function getToken() {
  const raw   = process.env.MERCADO_PAGO_ACCESS_TOKEN || '';
  const token = raw.replace(/[\r\n\s]/g, '');
  if (!token) throw new Error('MERCADO_PAGO_ACCESS_TOKEN não configurado no .env');
  return token;
}

function getHeaders() {
  const token = getToken();
  console.log(`[MP] Token: ...${token.slice(-8)} (${token.length} chars)`);
  return {
    'Authorization':     `Bearer ${token}`,
    'Content-Type':      'application/json',
    'X-Idempotency-Key': `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  };
}

// -----------------------------------------------
// Cria cobrança Checkout Pro (Mercado Pago Preference)
// Retorna: initPoint, sandboxInitPoint, id, status, ticketUrl
// O initPoint (init_point) leva para a página segura de Checkout Pro do Mercado Pago
// onde o cliente escolhe pagar via PIX, Cartão de Crédito, Boleto, Saldo MP etc.
// -----------------------------------------------
export async function criarCobrancaPix({ valor, descricao, nomeCliente, emailCliente }) {
  const emailLimpo = (emailCliente || '').replace(/[\r\n\s]/g, '').toLowerCase() || 'cliente@email.com';
  const nomeParts  = (nomeCliente  || 'Cliente').trim().split(' ');
  const firstName  = nomeParts[0] || 'Cliente';
  const lastName   = nomeParts.slice(1).join(' ').trim() || 'Silva';

  const webhookUrl = process.env.WEBHOOK_URL ? `${process.env.WEBHOOK_URL}/webhook/mercadopago` : undefined;

  const payload = {
    items: [
      {
        title:       (descricao || 'Serviço de desenvolvimento web').substring(0, 256),
        quantity:    1,
        currency_id: 'BRL',
        unit_price:  Math.round(parseFloat(valor) * 100) / 100,
      }
    ],
    payer: {
      name:    firstName,
      surname: lastName,
      email:   emailLimpo,
    },
    back_urls: {
      success: 'https://www.mercadopago.com.br',
      failure: 'https://www.mercadopago.com.br',
      pending: 'https://www.mercadopago.com.br',
    },
    auto_return: 'approved',
    ...(webhookUrl ? { notification_url: webhookUrl } : {}),
    statement_descriptor: 'WEBSITE PRO',
  };

  console.log('[MP] Criando Checkout Pro Preference:', JSON.stringify(payload));

  try {
    const res = await axios.post(`${BASE_URL}/checkout/preferences`, payload, {
      headers: getHeaders(),
      timeout: 30000,
    });
    const d = res.data;
    console.log(`[MP] ✅ Preference id=${d.id} init_point=${d.init_point}`);

    const initPoint = d.init_point || d.sandbox_init_point || null;

    return {
      id:               d.id,
      status:           'pending',
      valor:            Math.round(parseFloat(valor) * 100) / 100,
      initPoint,
      ticketUrl:        initPoint, // link completo Checkout Pro
      pixCopiaECola:    initPoint, // link de pagamento principal
      qrCodeBase64:     null,
      expiracao:        d.date_of_expiration || null,
      criadoEm:         d.date_created || new Date().toISOString(),
    };
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data;
    console.error(`[MP] ❌ ${status}:`, JSON.stringify(detail, null, 2));

    let msg = `Mercado Pago ${status}: `;
    if (status === 401) msg += 'Token inválido. Verifique MERCADO_PAGO_ACCESS_TOKEN no .env.';
    else if (status === 400) msg += detail?.message || 'Dados inválidos.';
    else if (status === 422) msg += detail?.cause?.[0]?.description || detail?.message || 'Validação.';
    else msg += detail?.message || err.message;
    throw new Error(msg);
  }
}

// Alias para compatibilidade
export const criarCobrancaCompleta = criarCobrancaPix;

// -----------------------------------------------
// Consulta status de pagamento ou preferência
// -----------------------------------------------
export async function consultarPagamento(paymentOrPrefId, valorCobrado = null, descCobrada = null) {
  try {
    // Tenta primeiro como ID de pagamento direto de V1 (numérico)
    if (!isNaN(paymentOrPrefId) && Number(paymentOrPrefId) > 1000) {
      try {
        const res = await axios.get(`${BASE_URL}/v1/payments/${paymentOrPrefId}`, {
          headers: getHeaders(), timeout: 15000,
        });
        return {
          id:     res.data.id,
          status: res.data.status,
          valor:  res.data.transaction_amount,
          pago:   res.data.status === 'approved',
        };
      } catch (e) {}
    }

    // Se falhar ou for ID de preferência (ex: 2041639626-...), busca nos pagamentos recentes
    const res = await axios.get(`${BASE_URL}/v1/payments/search?sort=date_created&criteria=desc&limit=35`, {
      headers: getHeaders(), timeout: 15000,
    });

    const results = res.data.results || [];

    // Busca casamento exato por preference_id ou por ID de pagamento
    let pag = results.find(p => String(p.preference_id) === String(paymentOrPrefId) || String(p.id) === String(paymentOrPrefId));

    // Se não encontrou (Checkout Pro não vincula o pref_id no objeto payment raiz), cruza pelo valor e descrição recentes
    if (!pag && valorCobrado) {
      pag = results.find(p =>
        p.status === 'approved' &&
        Math.abs(parseFloat(p.transaction_amount) - parseFloat(valorCobrado)) < 0.01 &&
        (!descCobrada || (p.description && p.description.toLowerCase().trim() === descCobrada.toLowerCase().trim()))
      );
    }

    // Fallback: busca qualquer pagamento recente aprovado pelo valor se houver só um
    if (!pag && valorCobrado) {
      pag = results.find(p => p.status === 'approved' && Math.abs(parseFloat(p.transaction_amount) - parseFloat(valorCobrado)) < 0.01);
    }

    if (pag) {
      return {
        id:     pag.id,
        status: pag.status,
        valor:  pag.transaction_amount,
        pago:   pag.status === 'approved',
      };
    }

    return {
      id:     paymentOrPrefId,
      status: 'pending',
      valor:  0,
      pago:   false,
    };
  } catch (err) {
    const status = err.response?.status;
    throw new Error(`Mercado Pago ${status}: ${err.response?.data?.message || err.message}`);
  }
}

export function formatarBRL(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}
