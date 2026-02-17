const ZIINA_API_BASE = 'https://api-v2.ziina.com/api';

function getHeaders() {
  const apiKey = process.env.ZIINA_API_KEY;
  if (!apiKey) throw new Error('ZIINA_API_KEY not configured');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
}

async function createPaymentIntent({ amount, currency, message, successUrl, cancelUrl }) {
  const body = {
    amount: Number(amount),
    currency_code: currency || process.env.ZIINA_CURRENCY || 'AED',
    message: message || 'Iftar Payment',
  };
  if (successUrl) body.success_url = successUrl;
  if (cancelUrl) body.cancel_url = cancelUrl;
  if (process.env.ZIINA_TEST_MODE === 'true') body.test = true;

  const res = await fetch(`${ZIINA_API_BASE}/payment_intent`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ziina API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    redirect_url: data.redirect_url,
    status: data.status,
    amount: data.amount,
    currency: data.currency_code,
  };
}

async function registerWebhook(url, secret) {
  const body = { url };
  if (secret) body.secret = secret;

  const res = await fetch(`${ZIINA_API_BASE}/webhook`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ziina webhook registration error (${res.status}): ${text}`);
  }

  return await res.json();
}

function verifyWebhookSignature(payload, signature, secret) {
  if (!secret || !signature) return true; // skip if no secret configured
  const crypto = require('crypto');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

module.exports = { createPaymentIntent, registerWebhook, verifyWebhookSignature };
