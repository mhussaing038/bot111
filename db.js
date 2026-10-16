const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'store.json');

const initialData = {
  settings: {
    storeName: 'RedNox Store',
    currency: 'USD',
    ownerUsername: '@Hussain_xd',
    adminIds: ['6506288872'],
    maintenanceMode: false,
    binanceApiKey: 'QlVUAIm0zrAsn4Wwy2o6zMRQi4hsqQYctSVFQGQIg9Xs0voX0uBtcwWgVS0dWFR3',
    binanceApiSecret: 'tCUuZwlEdKktWqBznoFYPZssTVpRUvTNEBkIw9LlU8B9TUzNcgnmKZSHOMhE6dys',
    paymentMethods: {
      binance_pay: '1245075177',
      usdt_bep20: '0x1245075177BEP20AddressHolder'
    }
  },
  categories: [
    { id: 'cat_digital', name: '📱 Digital Accounts', icon: '📱' },
    { id: 'cat_gaming', name: '🎮 Gaming & Top-ups', icon: '🎮' },
    { id: 'cat_subs', name: '⚡ Subscriptions', icon: '⚡' },
    { id: 'cat_software', name: '💻 Software Keys', icon: '💻' }
  ],
  products: [],
  users: {},
  carts: {},
  orders: [],
  usedTrxIds: [],
  tickets: []
};

class Database {
  constructor() {
    this.data = initialData;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(raw);
        if (!this.data.categories) this.data.categories = initialData.categories;
        if (!this.data.users) this.data.users = {};
        if (!this.data.carts) this.data.carts = {};
        if (!this.data.orders) this.data.orders = [];
        if (!Array.isArray(this.data.usedTrxIds)) this.data.usedTrxIds = [];
        if (!Array.isArray(this.data.tickets)) this.data.tickets = [];
        if (!this.data.settings) this.data.settings = initialData.settings;
        if (typeof this.data.settings.maintenanceMode === 'undefined') {
          this.data.settings.maintenanceMode = false;
        }

        if (!Array.isArray(this.data.products)) this.data.products = [];

        this.data.settings.binanceApiKey = 'QlVUAIm0zrAsn4Wwy2o6zMRQi4hsqQYctSVFQGQIg9Xs0voX0uBtcwWgVS0dWFR3';
        this.data.settings.binanceApiSecret = 'tCUuZwlEdKktWqBznoFYPZssTVpRUvTNEBkIw9LlU8B9TUzNcgnmKZSHOMhE6dys';
        if (!this.data.settings.paymentMethods) {
          this.data.settings.paymentMethods = {
            binance_pay: '1245075177',
            usdt_bep20: '0x1245075177BEP20AddressHolder'
          };
        } else {
          if (!this.data.settings.paymentMethods.binance_pay) {
            this.data.settings.paymentMethods.binance_pay = '1245075177';
          }
          if (!this.data.settings.paymentMethods.usdt_bep20) {
            this.data.settings.paymentMethods.usdt_bep20 = '0x1245075177BEP20AddressHolder';
          }
        }
        this.save();
      } else {
        this.save();
      }
    } catch (e) {
      console.error('Error loading DB:', e);
      this.data = initialData;
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving DB:', e);
    }
  }

  // Maintenance Mode Toggle
  isMaintenanceMode() {
    return !!(this.data.settings && this.data.settings.maintenanceMode);
  }

  toggleMaintenanceMode() {
    if (!this.data.settings) this.data.settings = initialData.settings;
    this.data.settings.maintenanceMode = !this.data.settings.maintenanceMode;
    this.save();
    return this.data.settings.maintenanceMode;
  }

  getWelcomePhoto() {
    return (this.data.settings && this.data.settings.welcomePhoto) || null;
  }

  setWelcomePhoto(photoStr) {
    if (!this.data.settings) this.data.settings = initialData.settings;
    this.data.settings.welcomePhoto = photoStr;
    this.save();
  }

  getApkUrl() {
    return (this.data.settings && this.data.settings.apkUrl) || 'https://t.me/Hussain_xd';
  }

  setApkUrl(url) {
    if (!this.data.settings) this.data.settings = initialData.settings;
    this.data.settings.apkUrl = url;
    this.save();
  }

  getApkFileId() {
    return (this.data.settings && this.data.settings.apkFileId) || null;
  }

  setApkFile(fileId, fileName) {
    if (!this.data.settings) this.data.settings = initialData.settings;
    this.data.settings.apkFileId = fileId;
    this.data.settings.apkFileName = fileName || 'KOS_App.apk';
    this.save();
  }

  getApkFileName() {
    return (this.data.settings && this.data.settings.apkFileName) || 'KOS_App.apk';
  }

  getApkDescription() {
    return (this.data.settings && this.data.settings.apkDescription) ||
      `<b>Game:</b> 8-Ball Pool Premium Tool & Aim Assist\n` +
      `<i>Enjoy playing with King of Shots (KOS)!</i>`;
  }

  setApkDescription(descText) {
    if (!this.data.settings) this.data.settings = initialData.settings;
    this.data.settings.apkDescription = descText;
    this.save();
  }

  // Force Join Channels
  isForceJoinEnabled() {
    if (!this.data.settings) return true;
    return this.data.settings.forceJoinEnabled !== false;
  }

  toggleForceJoin() {
    if (!this.data.settings) this.data.settings = initialData.settings;
    if (typeof this.data.settings.forceJoinEnabled === 'undefined') {
      this.data.settings.forceJoinEnabled = true;
    }
    this.data.settings.forceJoinEnabled = !this.data.settings.forceJoinEnabled;
    this.save();
    return this.data.settings.forceJoinEnabled;
  }

  getRequiredChannels() {
    if (!this.data.settings) return [];
    if (!Array.isArray(this.data.settings.requiredChannels)) {
      this.data.settings.requiredChannels = [];
    }
    return this.data.settings.requiredChannels;
  }

  addRequiredChannel(inputStr, customName = '') {
    if (!this.data.settings) this.data.settings = initialData.settings;
    if (!Array.isArray(this.data.settings.requiredChannels)) {
      this.data.settings.requiredChannels = [];
    }

    let clean = String(inputStr || '').trim();
    if (!clean) return null;

    let username = '';
    let link = '';

    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      link = clean;
      const parts = clean.split('/');
      username = parts[parts.length - 1].replace('@', '').trim();
    } else {
      username = clean.replace('@', '').trim();
      link = `https://t.me/${username}`;
    }

    const chanObj = {
      id: 'chan_' + Date.now(),
      name: customName || `@${username}`,
      username: username.startsWith('@') ? username : `@${username}`,
      link: link
    };

    this.data.settings.requiredChannels.push(chanObj);
    this.save();
    return chanObj;
  }

  deleteRequiredChannel(channelId) {
    if (!this.data.settings || !Array.isArray(this.data.settings.requiredChannels)) return;
    this.data.settings.requiredChannels = this.data.settings.requiredChannels.filter(c => c.id !== channelId);
    this.save();
  }

  getProdSellerApiKey() {
    return this.data.settings?.prodSellerApiKey || process.env.PRODSELLER_API_KEY || '';
  }

  setProdSellerApiKey(apiKey) {
    if (!this.data.settings) this.data.settings = {};
    this.data.settings.prodSellerApiKey = String(apiKey || '').trim();
    this.save();
  }

  getSellerDepositAddress() {
    return this.data.settings?.sellerDepositAddress || process.env.SELLER_DEPOSIT_ADDRESS || '';
  }

  setSellerDepositAddress(addr) {
    if (!this.data.settings) this.data.settings = {};
    const clean = String(addr || '').trim();
    this.data.settings.sellerDepositAddress = clean;
    this.data.settings.sellerDepositPayId = clean;
    this.save();
  }

  getCustomButtonLabels() {
    if (!this.data.settings) this.data.settings = {};
    if (!this.data.settings.customButtonLabels) this.data.settings.customButtonLabels = {};
    return this.data.settings.customButtonLabels;
  }

  setCustomButtonLabel(btnKey, newText) {
    if (!this.data.settings) this.data.settings = {};
    if (!this.data.settings.customButtonLabels) this.data.settings.customButtonLabels = {};
    this.data.settings.customButtonLabels[btnKey] = String(newText || '').trim();
    this.save();
  }

  resetCustomButtonLabels() {
    if (!this.data.settings) this.data.settings = {};
    this.data.settings.customButtonLabels = {};
    this.save();
  }

  // Clear product stock completely
  clearProductStock(productId) {
    const prod = this.getProduct(productId);
    if (prod) {
      prod.stock = 0;
      prod.keyPool = [];
      this.save();
      return prod;
    }
    return null;
  }

  // 1-Click Auto-Import All Products from ProdSeller Supplier API
  importProdSellerProducts(prodsellerProducts, profitMarginPercent = 20) {
    let importedCount = 0;
    let updatedCount = 0;

    prodsellerProducts.forEach(p => {
      const wholesaleCost = p.price || 0;
      const lower = (p.name || '').toLowerCase();
      const isEmail = lower.includes('mail') || lower.includes('gmail') || lower.includes('hotmail') || lower.includes('outlook') || lower.includes('icloud');
      const retailPrice = isEmail
        ? Math.max(0.10, parseFloat((wholesaleCost * 1.18).toFixed(2)))
        : Math.max(0.10, parseFloat((wholesaleCost + 1.50).toFixed(2)));

      const existingProd = this.data.products.find(
        item => item.prodsellerProductId === p.id || item.name.toLowerCase() === p.name.toLowerCase()
      );

      if (existingProd) {
        existingProd.prodsellerProductId = p.id;
        existingProd.wholesaleCost = wholesaleCost;
        existingProd.price = retailPrice;
        if (p.description) existingProd.description = p.description;
        if (p.imageUrl) existingProd.photoUrl = p.imageUrl;
        updatedCount++;
      } else {
        const newProd = {
          id: 'prod_ps_' + p.id.slice(-8),
          prodsellerProductId: p.id,
          categoryId: null,
          name: p.name,
          title: p.name,
          price: retailPrice,
          wholesaleCost: wholesaleCost,
          description: p.description || '',
          photoUrl: p.imageUrl || '',
          stock: typeof p.stock === 'number' ? p.stock : 0,
          keyPool: [],
          createdAt: new Date().toISOString()
        };
        this.data.products.push(newProd);
        importedCount++;
      }
    });

    this.save();
    return { importedCount, updatedCount, totalProducts: this.data.products.length };
  }

  // Deduct specific stock quantity
  reduceStock(productId, reduceQty) {
    const prod = this.getProduct(productId);
    if (prod && reduceQty > 0) {
      const actualDeduct = Math.min(reduceQty, prod.stock);
      prod.stock -= actualDeduct;
      if (Array.isArray(prod.keyPool) && prod.keyPool.length > 0) {
        prod.keyPool.splice(-actualDeduct);
        prod.stock = prod.keyPool.length;
      }
      this.save();
      return { product: prod, deductedQty: actualDeduct, currentStock: prod.stock };
    }
    return null;
  }

  getLastUserOrder(userId) {
    const orders = this.getUserOrders(userId);
    if (!orders || orders.length === 0) return null;
    return orders[orders.length - 1];
  }

  processReferral(newUserId, referrerId) {
    if (!this.data.referrals) this.data.referrals = {};
    const uidStr = String(newUserId);
    const refStr = String(referrerId);
    if (this.data.referrals[uidStr]) return false;

    this.data.referrals[uidStr] = { referrerId: refStr, createdAt: new Date().toISOString() };
    const bonus = (this.data.settings && this.data.settings.referralBonusUsd) || 0.50;
    this.addBalance(refStr, bonus);
    this.save();
    return bonus;
  }

  getUserReferralsCount(userId) {
    if (!this.data.referrals) return 0;
    const refStr = String(userId);
    return Object.values(this.data.referrals).filter(r => r.referrerId === refStr).length;
  }

  getUserReferralsList(userId) {
    if (!this.data.referrals) return [];
    const refStr = String(userId);
    const list = [];
    for (const [newUid, r] of Object.entries(this.data.referrals)) {
      if (r.referrerId === refStr) {
        list.push({ userId: newUid, createdAt: r.createdAt });
      }
    }
    return list;
  }

  // Create Gift / Credit Deposit Link & Code
  createGiftCode(amountUsd, createdByAdminId) {
    if (!this.data.giftCodes) this.data.giftCodes = {};
    const randomStr = Math.random().toString(36).substring(2, 10).toUpperCase();
    const code = `GIFT_${Math.round(amountUsd)}_${randomStr}`;

    this.data.giftCodes[code] = {
      code,
      amount: Number(amountUsd),
      createdBy: String(createdByAdminId),
      createdAt: new Date().toISOString(),
      isUsed: false,
      usedBy: null,
      usedAt: null
    };

    this.save();
    return this.data.giftCodes[code];
  }

  // Redeem Gift Code & Add Balance to User Wallet
  redeemGiftCode(code, userId) {
    if (!this.data.giftCodes) return { ok: false, error: 'No gift codes found.' };
    const cleanCode = String(code || '').trim();
    const gift = this.data.giftCodes[cleanCode];

    if (!gift) {
      return { ok: false, error: '❌ Invalid or expired Gift Redeem Code.' };
    }

    if (gift.isUsed) {
      return { ok: false, error: `❌ This gift code was already claimed on ${new Date(gift.usedAt).toLocaleString()}.` };
    }

    gift.isUsed = true;
    gift.usedBy = String(userId);
    gift.usedAt = new Date().toISOString();

    const newBalance = this.addBalance(userId, gift.amount);
    this.save();

    return {
      ok: true,
      amount: gift.amount,
      newBalance,
      code: gift.code,
      createdBy: gift.createdBy
    };
  }

  updateProductPrice(productId, newPrice) {
    const prod = this.getProduct(productId);
    if (prod) {
      prod.price = Number(newPrice);
      this.save();
      return prod;
    }
    return null;
  }

  // Clear all products & stock
  clearAllProducts() {
    this.data.products = [];
    this.save();
  }

  // Support Tickets System
  createSupportTicket(userId, username, issueText) {
    const ticketId = 'TICKET-' + Math.floor(100000 + Math.random() * 900000);
    const ticket = {
      id: ticketId,
      userId: String(userId),
      username: username || 'Customer',
      issueText,
      status: 'open',
      createdAt: new Date().toISOString(),
      replyText: ''
    };
    if (!Array.isArray(this.data.tickets)) this.data.tickets = [];
    this.data.tickets.push(ticket);
    this.save();
    return ticket;
  }

  getSupportTicket(ticketId) {
    if (!Array.isArray(this.data.tickets)) return null;
    return this.data.tickets.find(t => t.id === ticketId);
  }

  replySupportTicket(ticketId, replyText) {
    const ticket = this.getSupportTicket(ticketId);
    if (ticket) {
      ticket.status = 'closed';
      ticket.replyText = replyText;
      ticket.repliedAt = new Date().toISOString();
      this.save();
    }
    return ticket;
  }

  // Persistent Anti-Replay used Trx IDs (Case-Insensitive)
  isTrxUsed(trxId) {
    if (!trxId) return false;
    const clean = String(trxId).trim().toLowerCase();
    if (!Array.isArray(this.data.usedTrxIds)) this.data.usedTrxIds = [];
    return this.data.usedTrxIds.some(id => String(id).trim().toLowerCase() === clean);
  }

  markTrxUsed(trxId) {
    if (trxId && !this.isTrxUsed(trxId)) {
      const clean = String(trxId).trim();
      if (!Array.isArray(this.data.usedTrxIds)) this.data.usedTrxIds = [];
      this.data.usedTrxIds.push(clean);
      this.save();
    }
  }

  // Binance API Credentials
  setBinanceCredentials(apiKey, apiSecret) {
    this.data.settings.binanceApiKey = apiKey.trim();
    this.data.settings.binanceApiSecret = apiSecret.trim();
    this.save();
  }

  getBinanceCredentials() {
    return {
      apiKey: this.data.settings.binanceApiKey || process.env.BINANCE_API_KEY || '',
      apiSecret: this.data.settings.binanceApiSecret || process.env.BINANCE_API_SECRET || ''
    };
  }

  // Users & Wallet Balance
  getUser(userId) {
    return this.data.users[userId];
  }

  saveUser(userId, userData) {
    const existing = this.data.users[userId] || {};
    this.data.users[userId] = {
      userId,
      username: userData.username || existing.username || '',
      firstName: userData.firstName || existing.firstName || 'User',
      role: existing.role || 'user',
      language: existing.language && existing.language !== 'ur' ? existing.language : 'en',
      balance: typeof existing.balance === 'number' ? existing.balance : 0,
      joinedAt: existing.joinedAt || new Date().toISOString()
    };
    this.save();
    return this.data.users[userId];
  }

  getUserBalance(userId) {
    const u = this.getUser(userId);
    return u && typeof u.balance === 'number' ? u.balance : 0;
  }

  addBalance(userId, amountUsd) {
    if (!this.data.users[userId]) {
      this.saveUser(userId, {});
    }
    const current = this.getUserBalance(userId);
    const updated = current + Number(amountUsd);
    this.data.users[userId].balance = updated;
    this.save();
    return updated;
  }

  deductBalance(userId, amountUsd) {
    if (!this.data.users[userId]) {
      this.saveUser(userId, {});
    }
    const current = this.getUserBalance(userId);
    const updated = Math.max(0, current - Number(amountUsd));
    this.data.users[userId].balance = updated;
    this.save();
    return updated;
  }

  findUserByIdOrUsername(queryStr) {
    if (!queryStr) return null;
    const clean = String(queryStr).trim().replace('@', '').toLowerCase();
    const users = Object.values(this.data.users || {});
    return users.find(u => String(u.userId) === clean || String(u.username || '').toLowerCase() === clean);
  }

  getUserPurchasesStats(userId) {
    const userOrders = this.getUserOrders(userId).filter(o => o.status === 'approved');
    const totalOrders = userOrders.length;
    let totalItemsPurchased = 0;
    let totalSpent = 0;

    userOrders.forEach(o => {
      totalSpent += o.totalAmount;
      o.items.forEach(i => {
        totalItemsPurchased += i.qty;
      });
    });

    return {
      totalOrders,
      totalItemsPurchased,
      totalSpent
    };
  }

  // Store Sales & Customer Analytics
  getStoreAnalytics() {
    const approvedOrders = this.data.orders.filter(o => o.status === 'approved');
    let totalRevenue = 0;
    let totalItemsSold = 0;

    const productSalesMap = {};
    this.data.products.forEach(p => {
      productSalesMap[p.id] = {
        name: p.name,
        soldQty: 0,
        revenueUsd: 0,
        remainingStock: p.stock
      };
    });

    const customerSalesMap = {};

    approvedOrders.forEach(o => {
      totalRevenue += o.totalAmount;
      const uid = String(o.userId);
      const user = this.getUser(uid);
      const username = o.username || (user ? user.username : 'User');

      if (!customerSalesMap[uid]) {
        customerSalesMap[uid] = {
          userId: uid,
          username,
          totalSpent: 0,
          ordersCount: 0,
          itemsPurchased: []
        };
      }
      customerSalesMap[uid].totalSpent += o.totalAmount;
      customerSalesMap[uid].ordersCount += 1;

      o.items.forEach(i => {
        totalItemsSold += i.qty;
        if (productSalesMap[i.id]) {
          productSalesMap[i.id].soldQty += i.qty;
          productSalesMap[i.id].revenueUsd += i.priceUsd * i.qty;
        } else {
          productSalesMap[i.id] = {
            name: i.name,
            soldQty: i.qty,
            revenueUsd: i.priceUsd * i.qty,
            remainingStock: 0
          };
        }

        customerSalesMap[uid].itemsPurchased.push(`${i.name} (x${i.qty})`);
      });
    });

    return {
      totalApprovedOrders: approvedOrders.length,
      totalRevenue,
      totalItemsSold,
      productSalesMap,
      customerSalesMap
    };
  }

  setLanguage(userId, langCode) {
    if (!this.data.users[userId]) {
      this.saveUser(userId, {});
    }
    this.data.users[userId].language = langCode;
    this.save();
  }

  getLanguage(userId) {
    const u = this.getUser(userId);
    return (u && u.language && u.language !== 'ur') ? u.language : 'en';
  }

  setAdmin(userId) {
    if (!this.data.users[userId]) {
      this.saveUser(userId, {});
    }
    this.data.users[userId].role = 'admin';
    const uidStr = String(userId);
    if (!this.data.settings.adminIds.includes(uidStr)) {
      this.data.settings.adminIds.push(uidStr);
    }
    this.save();
  }

  isAdmin(userId) {
    if (!userId) return false;
    const uidStr = String(userId);
    const user = this.getUser(userId);
    const isAdminRole = user && user.role === 'admin';
    const isSettingsAdmin = Array.isArray(this.data.settings?.adminIds) && this.data.settings.adminIds.map(String).includes(uidStr);
    const knownAdminIds = ['6506288872', '1918573072', '6665651781', '7761087029', '7107553688', '8571302200', '5603246329'];
    const isKnownId = knownAdminIds.includes(uidStr);
    const isKnownUsername = user && user.username && ['hussain_xd', 'ghostytdev', 'rednox_bro', 'hex_ofc', 'desertxsupporteam', 'k1024_0x', 'zayn0228'].includes(user.username.toLowerCase());
    return isAdminRole || isSettingsAdmin || isKnownId || isKnownUsername;
  }

  // Categories / Sections
  getCategories() {
    return this.data.categories;
  }

  addCategory(name, icon = '📁') {
    const id = 'cat_' + Date.now();
    const cat = { id, name, icon };
    this.data.categories.push(cat);
    this.save();
    return cat;
  }

  deleteCategory(catId) {
    this.data.categories = this.data.categories.filter(c => c.id !== catId);
    this.save();
  }

  extractProductsAndDeleteCategory(catId) {
    let extractedCount = 0;
    if (Array.isArray(this.data.products)) {
      this.data.products.forEach(p => {
        if (p.categoryId === catId) {
          p.categoryId = null;
          extractedCount++;
        }
      });
    }
    this.data.categories = this.data.categories.filter(c => c.id !== catId);
    this.save();
    return { extractedCount };
  }

  // Products
  getProducts(categoryId = null) {
    if (categoryId) {
      return this.data.products.filter(p => p.categoryId === categoryId);
    }
    return this.data.products;
  }

  getProduct(id) {
    return this.data.products.find(p => p.id === id);
  }

  addProduct(productData) {
    const id = 'prod_' + Date.now();
    const keyPool = Array.isArray(productData.keyPool) ? productData.keyPool : [];
    const stockQty = keyPool.length > 0 ? keyPool.length : (Number(productData.stock) || 0);

    const newProd = {
      id,
      categoryId: productData.categoryId || 'cat_digital',
      name: productData.name || 'New Product',
      price: Number(productData.price) || 1.00,
      description: productData.description || 'No description provided.',
      photoUrl: productData.photoUrl || '',
      stock: stockQty,
      digitalKey: productData.digitalKey || '',
      keyPool
    };
    this.data.products.push(newProd);
    this.save();
    return newProd;
  }

  addStock(productId, addedQty) {
    const prod = this.getProduct(productId);
    if (prod) {
      prod.stock += Number(addedQty);
      this.save();
      return { product: prod, addedQty: Number(addedQty), currentStock: prod.stock };
    }
    return null;
  }

  addStockKeys(productId, keyLinesArray) {
    const prod = this.getProduct(productId);
    if (prod) {
      if (!Array.isArray(prod.keyPool)) prod.keyPool = [];
      const cleanLines = keyLinesArray.map(l => l.trim()).filter(l => l.length > 0);
      prod.keyPool.push(...cleanLines);
      prod.stock = prod.keyPool.length;
      this.save();
      return { product: prod, addedQty: cleanLines.length, currentStock: prod.stock };
    }
    return null;
  }

  dispatchOrderKeys(productId, qtyNeeded) {
    const prod = this.getProduct(productId);
    if (!prod) return [];

    const delivered = [];
    if (Array.isArray(prod.keyPool) && prod.keyPool.length > 0) {
      const takeQty = Math.min(qtyNeeded, prod.keyPool.length);
      const spliced = prod.keyPool.splice(0, takeQty);
      delivered.push(...spliced);
      prod.stock = prod.keyPool.length;
      this.save();
    } else if (prod.digitalKey && prod.digitalKey.trim().length > 0) {
      for (let i = 0; i < qtyNeeded; i++) {
        delivered.push(prod.digitalKey);
      }
      if (prod.stock >= qtyNeeded) {
        prod.stock -= qtyNeeded;
        this.save();
      }
    }
    return delivered;
  }

  reduceStock(productId, reduceQty) {
    const prod = this.getProduct(productId);
    if (!prod) return null;

    const deductedKeys = [];
    if (Array.isArray(prod.keyPool) && prod.keyPool.length > 0) {
      const takeQty = Math.min(reduceQty, prod.keyPool.length);
      const spliced = prod.keyPool.splice(0, takeQty);
      deductedKeys.push(...spliced);
      prod.stock = prod.keyPool.length;
      this.save();
    } else {
      if (prod.stock >= reduceQty) {
        prod.stock -= reduceQty;
        this.save();
      }
      for (let i = 0; i < reduceQty; i++) {
        deductedKeys.push(prod.digitalKey || `Item Key #${i + 1}`);
      }
    }

    return {
      product: prod,
      deductedQty: reduceQty,
      currentStock: prod.stock,
      deductedKeys
    };
  }

  clearProductStock(productId) {
    const prod = this.getProduct(productId);
    if (!prod) return null;

    const deductedKeys = Array.isArray(prod.keyPool) ? [...prod.keyPool] : [];
    prod.keyPool = [];
    prod.stock = 0;
    this.save();

    return {
      name: prod.name,
      product: prod,
      deductedKeys
    };
  }

  deleteProduct(id) {
    const prod = this.getProduct(id);
    if (!prod) return null;
    const remainingKeys = Array.isArray(prod.keyPool) ? [...prod.keyPool] : [];
    this.data.products = this.data.products.filter(p => p.id !== id);
    this.save();
    return {
      product: prod,
      remainingKeys
    };
  }


  // Cart
  getCart(userId) {
    return this.data.carts[userId] || [];
  }

  addToCart(userId, productId, qty = 1) {
    if (!this.data.carts[userId]) this.data.carts[userId] = [];
    const cart = this.data.carts[userId];
    const existingIndex = cart.findIndex(item => item.productId === productId);
    if (existingIndex > -1) {
      cart[existingIndex].qty += qty;
    } else {
      cart.push({ productId, qty });
    }
    this.save();
    return cart;
  }

  removeFromCart(userId, productId) {
    if (!this.data.carts[userId]) return [];
    this.data.carts[userId] = this.data.carts[userId].filter(item => item.productId !== productId);
    this.save();
    return this.data.carts[userId];
  }

  clearCart(userId) {
    this.data.carts[userId] = [];
    this.save();
  }

  // Orders
  createOrder(userId, username, items, totalAmountUsd, paymentMethod, paymentProof = '', autoApproved = false) {
    const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
    const newOrder = {
      id: orderId,
      userId: String(userId),
      username: username || 'Guest',
      items,
      totalAmount: totalAmountUsd,
      currency: 'USD',
      paymentMethod,
      paymentProof,
      status: autoApproved ? 'approved' : 'pending',
      createdAt: new Date().toISOString()
    };
    this.data.orders.push(newOrder);
    this.clearCart(userId);
    this.save();
    return newOrder;
  }

  getOrder(orderId) {
    return this.data.orders.find(o => o.id === orderId);
  }

  getUserOrders(userId) {
    return this.data.orders.filter(o => String(o.userId) === String(userId));
  }

  getPendingOrders() {
    return this.data.orders.filter(o => o.status === 'pending');
  }

  updateOrderStatus(orderId, status) {
    const order = this.getOrder(orderId);
    if (order) {
      order.status = status;
      this.save();
    }
    return order;
  }

  // Settings
  getSettings() {
    return this.data.settings;
  }

  updatePaymentMethods(newMethods) {
    this.data.settings.paymentMethods = {
      ...this.data.settings.paymentMethods,
      ...newMethods
    };
    this.save();
  }

  // System Feature Toggles (Admin can turn ON/OFF any feature anytime)
  getFeatureToggles() {
    if (!this.data.settings) this.data.settings = {};
    if (!this.data.settings.featureToggles) {
      this.data.settings.featureToggles = {
        couponsEnabled: true,
        membershipEnabled: true,
        reviewsEnabled: true,
        channelRestockEnabled: true,
        searchEnabled: true,
        lowStockAlertsEnabled: true
      };
      this.save();
    }
    if (this.data.settings.featureToggles.membershipEnabled === undefined) {
      this.data.settings.featureToggles.membershipEnabled = true;
      this.save();
    }
    return this.data.settings.featureToggles;
  }

  isFeatureEnabled(featureKey) {
    const toggles = this.getFeatureToggles();
    return !!toggles[featureKey];
  }

  toggleFeature(featureKey) {
    const toggles = this.getFeatureToggles();
    toggles[featureKey] = !toggles[featureKey];
    this.save();
    return toggles[featureKey];
  }

  getMembershipTiers() {
    if (!this.data.settings) this.data.settings = {};
    if (!Array.isArray(this.data.settings.membershipTiers)) {
      this.data.settings.membershipTiers = [
        { key: 'bronze', name: '🥉 Bronze', minSpent: 0, discountPercent: 0, perks: ['0% discount on all purchases', 'Access to all products'] },
        { key: 'silver', name: '🥈 Silver', minSpent: 20, discountPercent: 3, perks: ['3% discount on all purchases', 'Priority support'] },
        { key: 'gold', name: '🥇 Gold', minSpent: 150, discountPercent: 5, perks: ['5% discount on all purchases', 'Early access to new products', 'Priority support'] },
        { key: 'platinum', name: '💎 Platinum', minSpent: 500, discountPercent: 7, perks: ['7% discount on all purchases', 'Exclusive products', 'VIP support', 'Early access'] },
        { key: 'vip', name: '👑 VIP', minSpent: 1000, discountPercent: 10, perks: ['10% discount on all purchases', 'All Platinum perks', 'Custom deals'] }
      ];
      this.save();
    }
    return this.data.settings.membershipTiers;
  }

  updateMembershipTier(tierKey, minSpent, discountPercent) {
    const tiers = this.getMembershipTiers();
    const tier = tiers.find(t => t.key === tierKey);
    if (tier) {
      tier.minSpent = Number(minSpent);
      tier.discountPercent = Number(discountPercent);
      this.save();
    }
    return tier;
  }

  getUserMembershipTier(userId) {
    const user = this.getUser(userId);
    const totalSpent = (user && typeof user.totalSpentUsd === 'number') ? user.totalSpentUsd : 0;
    const orders = (user && Array.isArray(user.orders)) ? user.orders.length : 0;
    const tiers = this.getMembershipTiers();

    // Sort descending by minSpent
    const sorted = [...tiers].sort((a, b) => b.minSpent - a.minSpent);
    let currentTier = sorted.find(t => totalSpent >= t.minSpent) || sorted[sorted.length - 1];

    return {
      currentTier,
      totalSpentUsd: totalSpent,
      totalOrders: orders,
      allTiers: tiers
    };
  }

  getReferralRewardMode() {
    return this.getFeatureToggles().referralRewardMode || 'all';
  }

  setReferralCommissionPercent(percent) {
    const toggles = this.getFeatureToggles();
    toggles.referralCommissionPercent = Number(percent) || 5;
    this.save();
    return toggles.referralCommissionPercent;
  }

  // 1. Discount Promo Coupon System
  createCoupon(code, discountPercent, maxUses = 100) {
    if (!Array.isArray(this.data.coupons)) this.data.coupons = [];
    const cleanCode = String(code).trim().toUpperCase();

    const existingIdx = this.data.coupons.findIndex(c => c.code === cleanCode);
    const newCoupon = {
      code: cleanCode,
      discountPercent: Number(discountPercent),
      maxUses: Number(maxUses),
      usedCount: 0,
      usedBy: [],
      createdAt: new Date().toISOString()
    };

    if (existingIdx > -1) {
      this.data.coupons[existingIdx] = newCoupon;
    } else {
      this.data.coupons.push(newCoupon);
    }
    this.save();
    return newCoupon;
  }

  getCoupons() {
    if (!Array.isArray(this.data.coupons)) this.data.coupons = [];
    return this.data.coupons;
  }

  getCoupon(code) {
    if (!code) return null;
    const cleanCode = String(code).trim().toUpperCase();
    const coupons = this.getCoupons();
    return coupons.find(c => c.code === cleanCode);
  }

  deleteCoupon(code) {
    if (!Array.isArray(this.data.coupons)) return false;
    const cleanCode = String(code).trim().toUpperCase();
    this.data.coupons = this.data.coupons.filter(c => c.code !== cleanCode);
    this.save();
    return true;
  }

  validateCoupon(code, userId, totalAmountUsd) {
    const coupon = this.getCoupon(code);
    if (!coupon) return { valid: false, error: '❌ Invalid or non-existent promo coupon code.' };
    if (coupon.usedCount >= coupon.maxUses) return { valid: false, error: '❌ This promo code has reached its maximum usage limit.' };
    if (Array.isArray(coupon.usedBy) && coupon.usedBy.includes(String(userId))) {
      return { valid: false, error: '❌ You have already redeemed this promo coupon code!' };
    }

    const discountAmountUsd = parseFloat(((totalAmountUsd * coupon.discountPercent) / 100).toFixed(2));
    const finalAmountUsd = Math.max(0, parseFloat((totalAmountUsd - discountAmountUsd).toFixed(2)));

    return {
      valid: true,
      coupon,
      discountPercent: coupon.discountPercent,
      discountAmountUsd,
      finalAmountUsd
    };
  }

  markCouponUsed(code, userId) {
    const coupon = this.getCoupon(code);
    if (coupon) {
      coupon.usedCount = (coupon.usedCount || 0) + 1;
      if (!Array.isArray(coupon.usedBy)) coupon.usedBy = [];
      coupon.usedBy.push(String(userId));
      this.save();
    }
  }

  // 2. Referral / Affiliate Program
  setReferrer(userId, referrerUserId) {
    if (!this.data.users[userId]) this.saveUser(userId, {});
    const user = this.data.users[userId];
    if (!user.referrerId && String(userId) !== String(referrerUserId)) {
      user.referrerId = String(referrerUserId);
      this.save();

      if (this.data.users[referrerUserId]) {
        if (!Array.isArray(this.data.users[referrerUserId].referredUsers)) {
          this.data.users[referrerUserId].referredUsers = [];
        }
        if (!this.data.users[referrerUserId].referredUsers.includes(String(userId))) {
          this.data.users[referrerUserId].referredUsers.push(String(userId));
          this.save();
        }
      }

      const unlocked = this.checkAndTriggerReferralMilestones(referrerUserId);
      return { success: true, unlockedMilestones: unlocked };
    }
    return { success: false, unlockedMilestones: [] };
  }

  rewardReferrer(buyerUserId, purchaseAmountUsd) {
    if (!this.isFeatureEnabled('referralsEnabled')) return null;
    const buyer = this.getUser(buyerUserId);
    if (buyer && buyer.referrerId) {
      const referrerId = buyer.referrerId;
      const commissionPercent = this.getFeatureToggles().referralCommissionPercent || 5;
      const commissionUsd = parseFloat(((purchaseAmountUsd * commissionPercent) / 100).toFixed(2));

      if (commissionUsd > 0) {
        this.addBalance(referrerId, commissionUsd);

        if (this.data.users[referrerId]) {
          const refUser = this.data.users[referrerId];
          refUser.totalReferralEarnings = (refUser.totalReferralEarnings || 0) + commissionUsd;
          this.save();
        }

        return {
          referrerId,
          commissionUsd,
          commissionPercent
        };
      }
    }
    return null;
  }

  getUserReferralStats(userId) {
    const user = this.getUser(userId);
    const referredUsers = (user && Array.isArray(user.referredUsers)) ? user.referredUsers : [];
    const totalEarnings = (user && typeof user.totalReferralEarnings === 'number') ? user.totalReferralEarnings : 0;
    return {
      totalInvited: referredUsers.length,
      totalEarningsUsd: totalEarnings
    };
  }

  getReferralMilestoneSettings() {
    if (!this.data.settings) this.data.settings = {};
    if (!this.data.settings.referralMilestoneSettings) {
      this.data.settings.referralMilestoneSettings = {
        m1Target: 5,
        m1DiscountPercent: 10,
        m2Target: 10,
        m2DiscountPercent: 25,
        m3Target: 15,
        m3DiscountPercent: 50
      };
      this.save();
    }
    return this.data.settings.referralMilestoneSettings;
  }

  updateReferralMilestoneSettings(newSettings) {
    const current = this.getReferralMilestoneSettings();
    this.data.settings.referralMilestoneSettings = {
      ...current,
      ...newSettings
    };
    this.save();
    return this.data.settings.referralMilestoneSettings;
  }

  getUserReferralDiscountTier(userId) {
    const mode = this.getReferralRewardMode();
    if (mode !== 'tier' && mode !== 'all') {
      return { tierName: '👤 Standard (0% OFF)', discountPercent: 0 };
    }

    const stats = this.getUserReferralStats(userId);
    const count = stats.totalInvited;
    const ms = this.getReferralMilestoneSettings();

    if (count >= ms.m3Target) return { tierName: `👑 VIP Platinum (${ms.m3Target}+ Refs)`, discountPercent: ms.m3DiscountPercent };
    if (count >= ms.m2Target) return { tierName: `🥇 Gold (${ms.m2Target}-${ms.m3Target - 1} Refs)`, discountPercent: ms.m2DiscountPercent };
    if (count >= ms.m1Target) return { tierName: `🥈 Silver (${ms.m1Target}-${ms.m2Target - 1} Refs)`, discountPercent: ms.m1DiscountPercent };
    if (count >= 1) return { tierName: '🥉 Bronze (1-4 Refs)', discountPercent: 3 };
    return { tierName: '👤 Standard (0% OFF)', discountPercent: 0 };
  }

  checkAndTriggerReferralMilestones(referrerUserId) {
    const mode = this.getReferralRewardMode();
    if (mode !== 'coupon' && mode !== 'all') return [];

    const stats = this.getUserReferralStats(referrerUserId);
    const count = stats.totalInvited;
    const refUser = this.getUser(referrerUserId);
    if (!refUser) return [];

    if (!Array.isArray(refUser.claimedMilestones)) refUser.claimedMilestones = [];

    const msSettings = this.getReferralMilestoneSettings();
    const unlockedMilestones = [];

    // Milestone 1
    if (count >= msSettings.m1Target && !refUser.claimedMilestones.includes(msSettings.m1Target)) {
      refUser.claimedMilestones.push(msSettings.m1Target);
      const couponCode = `REF${msSettings.m1Target}-${Math.floor(1000 + Math.random() * 9000)}`;
      this.createCoupon(couponCode, msSettings.m1DiscountPercent, 1);
      unlockedMilestones.push({
        milestone: msSettings.m1Target,
        title: `${msSettings.m1Target} Referrals Milestone Unlocked! 🎉`,
        discountPercent: msSettings.m1DiscountPercent,
        couponCode
      });
    }

    // Milestone 2
    if (count >= msSettings.m2Target && !refUser.claimedMilestones.includes(msSettings.m2Target)) {
      refUser.claimedMilestones.push(msSettings.m2Target);
      const couponCode = `REF${msSettings.m2Target}-${Math.floor(1000 + Math.random() * 9000)}`;
      this.createCoupon(couponCode, msSettings.m2DiscountPercent, 1);
      unlockedMilestones.push({
        milestone: msSettings.m2Target,
        title: `${msSettings.m2Target} Referrals Milestone Unlocked! 🚀`,
        discountPercent: msSettings.m2DiscountPercent,
        couponCode
      });
    }

    // Milestone 3
    if (count >= msSettings.m3Target && !refUser.claimedMilestones.includes(msSettings.m3Target)) {
      refUser.claimedMilestones.push(msSettings.m3Target);
      const couponCode = `REF${msSettings.m3Target}-${Math.floor(1000 + Math.random() * 9000)}`;
      this.createCoupon(couponCode, msSettings.m3DiscountPercent, 1);
      unlockedMilestones.push({
        milestone: msSettings.m3Target,
        title: `👑 ${msSettings.m3Target} Referrals SPECIAL VIP REWARD UNLOCKED!`,
        discountPercent: msSettings.m3DiscountPercent,
        couponCode
      });
    }

    this.save();
    return unlockedMilestones;
  }

  // 3. Ratings & Order Reviews
  addReview(orderId, userId, username, productId, ratingStars, reviewText = '') {
    if (!Array.isArray(this.data.reviews)) this.data.reviews = [];
    const reviewObj = {
      id: 'REV-' + Math.floor(100000 + Math.random() * 900000),
      orderId,
      userId: String(userId),
      username: username || 'Customer',
      productId,
      ratingStars: Math.min(5, Math.max(1, Number(ratingStars))),
      reviewText: reviewText.trim(),
      createdAt: new Date().toISOString()
    };
    this.data.reviews.push(reviewObj);
    this.save();
    return reviewObj;
  }

  getProductReviews(productId) {
    if (!Array.isArray(this.data.reviews)) return [];
    return this.data.reviews.filter(r => r.productId === productId);
  }

  getProductRatingAverage(productId) {
    const reviews = this.getProductReviews(productId);
    if (reviews.length === 0) return { avg: 5.0, count: 0 };
    const totalStars = reviews.reduce((sum, r) => sum + r.ratingStars, 0);
    const avg = parseFloat((totalStars / reviews.length).toFixed(1));
    return { avg, count: reviews.length };
  }

  // 4. Dedicated Public Telegram Channel Sync
  setPublicRestockChannel(channelUsername) {
    if (!this.data.settings) this.data.settings = {};
    const clean = String(channelUsername || '').trim();
    this.data.settings.publicRestockChannel = clean ? (clean.startsWith('@') ? clean : '@' + clean) : '';
    this.save();
    return this.data.settings.publicRestockChannel;
  }

  getPublicRestockChannel() {
    return this.data.settings?.publicRestockChannel || '';
  }

  // 5. Product Instant Search
  searchProducts(query) {
    if (!query) return [];
    const clean = String(query).trim().toLowerCase();
    const products = this.getProducts();
    return products.filter(p => p.name.toLowerCase().includes(clean) || (p.description && p.description.toLowerCase().includes(clean)));
  }
}

module.exports = new Database();
