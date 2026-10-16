const db = require('./db');

/**
 * Smart AI Store Support Assistant
 * Answers user queries about RedNox Store strictly using live store knowledge.
 * Supports Roman Urdu, English, Urdu, Hindi, Arabic, etc.
 */
function processAiSupportQuery(queryText, userId) {
  const q = queryText.toLowerCase().trim();
  const owner = '@Hussain_xd';
  const products = db.getProducts();
  const categories = db.getCategories();
  const settings = db.getSettings();
  const binancePayId = settings.paymentMethods?.binance_pay || '1245075177';
  const binanceName = 'M Hussain_XD';
  const balance = db.getUserBalance(userId).toFixed(2);

  // 1. Owner / Contact Human
  if (q.includes('owner') || q.includes('admin') || q.includes('human') || q.includes('banda') || q.includes('baat') || q.includes('talk') || q.includes('real person') || q.includes('contact') || q.includes('hussain') || q.includes('مالک') || q.includes('ادمن')) {
    return `🤖 <b>AI Support: Store Owner Info</b>\n\n` +
      `👑 <b>Store Owner & Admin:</b> <b>${owner}</b> (M Hussain)\n` +
      `⏰ <b>Human Support Hours:</b> 24/7 Available\n\n` +
      `<i>If you want to send a direct message/ticket to ${owner}, tap the <b>"👤 Talk to Owner Direct"</b> button below!</i>`;
  }

  // 2. Deposit / Add Funds / Payment Methods / Binance Pay
  if (q.includes('deposit') || q.includes('add fund') || q.includes('money') || q.includes('paise') || q.includes('balance') || q.includes('binance') || q.includes('usdt') || q.includes('pay') || q.includes('recharge') || q.includes('پیسے') || q.includes('ڈپازٹ')) {
    return `🤖 <b>AI Support: Deposit & Payment Guide</b>\n\n` +
      `💳 <b>Your Current Wallet Balance:</b> <code>$${balance} USD</code>\n` +
      `📌 <b>Minimum Deposit:</b> <code>$0.01 USD</code>\n\n` +
      `<b>How to Deposit Funds:</b>\n` +
      `1. Click <b>"💳 Deposit Funds"</b> from the store main menu.\n` +
      `2. Enter the amount in USD ($) you want to add.\n` +
      `3. Send payment to <b>Binance Pay ID:</b> <code>${binancePayId}</code> (${binanceName}).\n` +
      `4. Enter your <b>Transaction ID / Pay Order ID</b> in bot chat.\n` +
      `⚡ <i>Binance API automatically verifies & adds balance to your wallet in real-time!</i>`;
  }

  // 3. Buy Product / Order / How to Purchase
  if (q.includes('buy') || q.includes('purchase') || q.includes('khareed') || q.includes('kaise') || q.includes('how to') || q.includes('order') || q.includes('kare') || q.includes('خرید')) {
    return `🤖 <b>AI Support: How to Buy Products</b>\n\n` +
      `🛍️ <b>Step-by-Step Purchase Guide:</b>\n` +
      `1. Click <b>"🛍️ Browse Store Products"</b> from main menu.\n` +
      `2. Choose a <b>Section / Category</b>.\n` +
      `3. Select the <b>Product</b> you want to buy.\n` +
      `4. Choose or type the <b>Quantity</b> (number of accounts).\n` +
      `5. Pay using your <b>Store Wallet Balance</b> or direct <b>Binance Pay ID</b>.\n\n` +
      `📦 <i>Your accounts will be delivered instantly inside a downloadable <b>.txt</b> file!</i>`;
  }

  // 4. Products / Stock / Inventory / Price
  if (q.includes('product') || q.includes('stock') || q.includes('list') || q.includes('item') || q.includes('price') || q.includes('kya kya') || q.includes('saaman') || q.includes('کیٹلاگ') || q.includes('اسٹاک')) {
    let prodListStr = '';
    if (products.length === 0) {
      prodListStr = `<i>No products currently added. Store owner ${owner} is updating stock!</i>`;
    } else {
      products.forEach((p, idx) => {
        const st = p.stock > 0 ? `✅ In Stock (${p.stock})` : `🔴 Out of Stock`;
        prodListStr += `${idx + 1}. <b>${p.name}</b> — <b>$${p.price.toFixed(2)} USD</b> (${st})\n`;
      });
    }

    return `🤖 <b>AI Support: Live Store Catalog</b>\n\n` +
      `📊 <b>Available Store Products:</b>\n\n${prodListStr}\n\n` +
      `<i>Click <b>"🛍️ Browse Store Products"</b> to view details & buy!</i>`;
  }

  // 5. Verification / Rejection / Transaction ID
  if (q.includes('verify') || q.includes('reject') || q.includes('trx') || q.includes('transaction') || q.includes('fake') || q.includes('proof') || q.includes('id')) {
    return `🤖 <b>AI Support: Real-Time Binance Verification</b>\n\n` +
      `🛡️ <b>Automated Binance API Verification System:</b>\n` +
      `- When you deposit or pay via Binance Pay ID, the bot syncs with Binance live ledger using Binance Server Time.\n` +
      `- <b>Genuine Transaction:</b> Auto-approved & credited in seconds.\n` +
      `- <b>Invalid / Wrong ID:</b> Automatically rejected with direct notification.\n\n` +
      `<i>No manual admin approval needed! Everything is 100% automated & instant.</i>`;
  }

  // 6. Language support query
  if (q.includes('language') || q.includes('urdu') || q.includes('hindi') || q.includes('english') || q.includes('arabic') || q.includes('زبان')) {
    return `🤖 <b>AI Support: Multilingual Assistant</b>\n\n` +
      `🌐 I support all languages! You can ask me questions in <b>Roman Urdu</b>, <b>English</b>, <b>Urdu</b>, <b>Hindi</b>, <b>Arabic</b>, or any other language.\n\n` +
      `You can also change the bot display language via <b>"🌐 Select Language"</b> button in main menu!`;
  }

  // 7. General / Default Store AI Response
  return `🤖 <b>RedNox AI Support Assistant</b>\n\n` +
    `Hello! I am the official 24/7 AI Customer Support for <b>RedNox Store</b>! ✨\n\n` +
    `I can help you with:\n` +
    `• 💳 <b>Deposits & Binance Pay Guide</b>\n` +
    `• 🛍️ <b>Buying Accounts & Delivery Process</b>\n` +
    `• 📊 <b>Live Stock & Product Prices</b>\n` +
    `• 👑 <b>Store Owner Info (${owner})</b>\n\n` +
    `<i>✍️ Type any question in chat, or tap <b>"👤 Talk to Owner Direct"</b> if you need human assistance!</i>`;
}

module.exports = { processAiSupportQuery };
