const db = require('./db');

const BASE_URL = 'https://prodseller.com/v1';

function getApiKey() {
  return process.env.PRODSELLER_API_KEY || (db.getProdSellerApiKey ? db.getProdSellerApiKey() : '');
}

/**
 * Fetch supplier balance & membership details from ProdSeller API
 */
async function getBalance() {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'ProdSeller API Key is not set in bot settings.' };
  }

  try {
    const res = await fetch(`${BASE_URL}/balance`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }

    return { ok: true, data };
  } catch (err) {
    console.error('[ProdSeller API] Balance Error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Fetch list of active products available on ProdSeller
 */
async function getProducts() {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'ProdSeller API Key is not set.' };
  }

  try {
    const res = await fetch(`${BASE_URL}/products`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }

    return { ok: true, products: data.products || [] };
  } catch (err) {
    console.error('[ProdSeller API] Products Error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Create an order on ProdSeller & get instant key delivery
 * @param {string} productId - ProdSeller product ID
 * @param {number} quantity - Quantity to purchase (default 1)
 * @param {string} idempotencyKey - Unique key to prevent duplicate charges
 */
async function createOrder(productId, quantity = 1, idempotencyKey = '') {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'ProdSeller API Key is missing.' };
  }

  const headers = {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json'
  };

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  try {
    const res = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        productId: productId,
        quantity: quantity
      })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }

    const deliveredKeys = data.deliveredKeys || (data.deliveredKey ? [data.deliveredKey] : []);
    return {
      ok: true,
      orderId: data.orderId,
      status: data.status,
      product: data.product,
      amount: data.amount,
      deliveredKey: data.deliveredKey,
      deliveredKeys,
      data
    };
  } catch (err) {
    console.error('[ProdSeller API] Create Order Error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Fetch order status & key details by ProdSeller Order ID
 */
async function getOrderDetails(orderId) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'ProdSeller API Key is missing.' };
  }

  try {
    const res = await fetch(`${BASE_URL}/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (err) {
    console.error('[ProdSeller API] Order Details Error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function getProductDetails(productId) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'ProdSeller API Key is missing.' };
  }

  try {
    const res = await fetch(`${BASE_URL}/products/${productId}`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }

    return { ok: true, product: data };
  } catch (err) {
    console.error('[ProdSeller API] Get Product Details Error:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getBalance,
  getProducts,
  getProductDetails,
  createOrder,
  getOrderDetails,
  getApiKey
};
