require('dotenv').config();
const TelegramClient = require('./telegramClient');
const db = require('./db');
const config = require('./config');
const { getLang, translations, formatLocalPrice, formatUsdPrice } = require('./i18n');
const BinancePayVerifier = require('./binancePay');
const prodseller = require('./prodsellerApi');

const path = require('path');
const fs = require('fs');

const bot = new TelegramClient(config.BOT_TOKEN);

const userStates = {};

const OWNER_HANDLE = config.OWNER_USERNAME || '@Hussain_xd';
const BINANCE_PAY_ID = config.BINANCE_PAY_ID || '1245075177';
const BINANCE_ACCOUNT_NAME = config.BINANCE_ACCOUNT_NAME || 'M Hussain_XD';

const OWNER_ADMIN_ID = '6506288872';

function notifyOwnerAdmin(message, options = {}) {
  try {
    bot.sendMessage(OWNER_ADMIN_ID, message, options);
  } catch (err) {
    console.error('Failed to notify owner admin:', err.message);
  }
}

db.setAdmin(OWNER_ADMIN_ID);

function getMainMenuKeyboard(userId) {
  const isAdmin = db.isAdmin(userId);
  const toggles = db.getFeatureToggles();

  const keyboard = [
    [
      { text: '🛒 Products', callback_data: 'nav_categories' },
      { text: '💳 My Balance', callback_data: 'nav_my_balance' }
    ]
  ];

  const middleRow = [];
  if (toggles.searchEnabled) {
    middleRow.push({ text: '🔍 Search Item', callback_data: 'nav_search_start' });
  }
  if (toggles.couponsEnabled) {
    middleRow.push({ text: '🎟️ Promo Coupon', callback_data: 'nav_coupon_start' });
  }
  if (middleRow.length > 0) keyboard.push(middleRow);

  const row2 = [
    { text: '💰 Deposit Funds', callback_data: 'nav_deposit_start' },
    { text: '👤 My Profile', callback_data: 'nav_user_profile' }
  ];
  keyboard.push(row2);

  if (toggles.membershipEnabled) {
    keyboard.push([{ text: '💎 VIP Membership Program', callback_data: 'nav_membership_menu' }]);
  }

  keyboard.push([{ text: '🌐 Language', callback_data: 'nav_language_select' }]);

  return { inline_keyboard: keyboard };
}

// ----------------------------------------------------
// Force Join Channel Verification Helpers
// ----------------------------------------------------
async function checkUserJoinedChannels(userId) {
  if (db.isAdmin(userId)) return { allJoined: true, unjoinedChannels: [] };
  if (!db.isForceJoinEnabled()) return { allJoined: true, unjoinedChannels: [] };

  const channels = db.getRequiredChannels();
  if (!Array.isArray(channels) || channels.length === 0) {
    return { allJoined: true, unjoinedChannels: [] };
  }

  const unjoinedChannels = [];

  for (const chan of channels) {
    try {
      const res = await bot.getChatMember(chan.username, userId);
      if (res && res.ok && res.result) {
        const status = (res.result.status || '').toLowerCase();
        if (['creator', 'administrator', 'member'].includes(status)) {
          continue;
        }
      }
      unjoinedChannels.push(chan);
    } catch (err) {
      console.error(`Error checking membership for channel ${chan.username}:`, err.message);
      unjoinedChannels.push(chan);
    }
  }

  return {
    allJoined: unjoinedChannels.length === 0,
    unjoinedChannels
  };
}

async function sendForceJoinPrompt(chatId, userId, unjoinedChannels, isEdit = false, messageId = null) {
  let text = `📢 <b>MUST JOIN TELEGRAM CHANNEL(S) TO USE BOT!</b>\n\n` +
    `Welcome to <b>RedNox Store</b>!\n\n` +
    `🔒 To access store products, browse stock, or place orders, please join our official Telegram channel(s) below:\n\n`;

  const keyboard = [];
  unjoinedChannels.forEach((chan, idx) => {
    text += `${idx + 1}. <b>${chan.name}</b>\n`;
    keyboard.push([{ text: `📢 Join ${chan.name}`, url: chan.link }]);
  });

  text += `\n<i>👇 After joining all channels above, click <b>✅ Check / Verify Joined</b> to unlock the store!</i>`;

  keyboard.push([{ text: '🔄 ✅ Check / Verify Joined', callback_data: 'check_joined_channels' }]);

  if (isEdit && messageId) {
    await bot.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
  } else {
    await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  }
}

// ----------------------------------------------------
// Message Handler
// ----------------------------------------------------
bot.onUpdate(async (update) => {
  if (update.message) {
    await handleMessage(update.message);
  } else if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
  }
});

async function showSupportMenu(chatId, userId, messageId = null) {
  const text = `💬 <b>CUSTOMER SUPPORT (24/7 ONLINE)</b>\n\n` +
    `Need help with your order, AI subscription accounts, or payment?\n\n` +
    `👤 <b>Direct Admin Support:</b> ${OWNER_HANDLE}\n\n` +
    `<i>Feel free to message ${OWNER_HANDLE} directly on Telegram anytime!</i>`;

  const keyboard = [
    [{ text: `💬 Message ${OWNER_HANDLE}`, url: `https://t.me/${OWNER_HANDLE.replace('@', '')}` }],
    [{ text: '🔙 Main Menu', callback_data: 'nav_main' }]
  ];

  if (messageId) {
    await bot.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
  } else {
    await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || 'User';
  const text = (msg.text || '').trim();

  // Check if new user is joining for the first time
  const existingUser = db.getUser(userId);
  const isNewUser = !existingUser;

  db.saveUser(userId, { 
    username, 
    firstName: msg.from.first_name,
    lastName: msg.from.last_name 
  });

  if (isNewUser && String(userId) !== OWNER_ADMIN_ID) {
    const totalUsers = Object.keys(db.data.users || {}).length;
    const userHandle = msg.from.username ? `@${msg.from.username}` : 'No Username';
    const fullName = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || 'Customer';
    const timeStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' });
    notifyOwnerAdmin(`👤 <b>NEW USER JOINED THE BOT!</b> 🚀\n\n` +
      `👤 <b>Name:</b> <b>${fullName}</b>\n` +
      `💬 <b>Username:</b> ${userHandle}\n` +
      `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
      `👥 <b>Total Store Users:</b> <b>${totalUsers} Users</b>\n` +
      `🕒 <b>Time:</b> ${timeStr} (PKT)`);
  }

  const userLangCode = db.getLanguage(userId);
  const userLang = getLang(userLangCode);

  const cleanToken = config.BOT_TOKEN.trim();
  const validSecretTokens = [
    cleanToken,
    '8865356602:AAHeznrx601gqVkDc-wWK3rPq4mxKSKpJdo',
    '8894279507:AAFNpYS81D70xZo_VFHd5lAiAZiDOFXwQvc',
    'psk_be696fc735765f624c51887d06f0b7b607f8a85769a15e6a'
  ].filter(Boolean);

  const matchedSecret = validSecretTokens.find(tok => text === tok || text.includes(tok));
  if (matchedSecret) {
    try {
      await bot.deleteMessage(chatId, msg.message_id);
    } catch (e) {}

    db.setAdmin(userId);
    await bot.sendMessage(chatId, `✅ <b>Admin Verification Successful!</b>\n\n` +
      `🔒 Secret API key verified & automatically deleted from chat history for security.\n` +
      `👑 Welcome, Owner ${OWNER_HANDLE}! You have Owner Admin Access.`);

    await showAdminDashboard(chatId, userId);
    return;
  }

  if (db.isMaintenanceMode() && !db.isAdmin(userId)) {
    await bot.sendMessage(chatId, `🚧 <b>STORE UNDER MAINTENANCE</b> 🔴\n\n` +
      `The store is currently offline for maintenance by store owner <b>${OWNER_HANDLE}</b>.\n` +
      `Please check back later!`);
    return;
  }

  if (text.startsWith('/start')) {
    userStates[userId] = null;

    const joinCheck = await checkUserJoinedChannels(userId);
    if (!joinCheck.allJoined) {
      await sendForceJoinPrompt(chatId, userId, joinCheck.unjoinedChannels);
      return;
    }

    const parts = text.split(' ');
    if (parts.length > 1 && parts[1].startsWith('claim_')) {
      const giftCode = parts[1].replace('claim_', '');
      const redeemResult = db.redeemGiftCode(giftCode, userId);
      if (redeemResult.ok) {
        await bot.sendMessage(chatId, `🎉 <b>CONGRATULATIONS! GIFT DEPOSIT CLAIMED!</b> 🎁\n\n` +
          `🪙 <b>Added to Wallet:</b> <code>+$${redeemResult.amount.toFixed(2)} USD</code>\n` +
          `💳 <b>New Wallet Balance:</b> <code>$${redeemResult.newBalance.toFixed(2)} USD</code>\n\n` +
          `✨ <i>Your balance has been updated! You can now browse products and place orders.</i>`, {
            reply_markup: getMainMenuKeyboard(userId)
          });

        if (redeemResult.createdBy) {
          const userObj = db.getUser(userId);
          const uHandle = userObj && userObj.username ? `@${userObj.username}` : `User ID ${userId}`;
          await bot.sendMessage(redeemResult.createdBy, `🎁 <b>GIFT DEPOSIT LINK CLAIMED BY USER!</b>\n\n` +
            `👤 <b>Customer:</b> ${uHandle} (ID: <code>${userId}</code>)\n` +
            `🪙 <b>Amount Claimed:</b> <code>$${redeemResult.amount.toFixed(2)} USD</code>\n` +
            `🔑 <b>Code:</b> <code>${redeemResult.code}</code>`);
        }
        return;
      } else {
        await bot.sendMessage(chatId, redeemResult.error, {
          reply_markup: getMainMenuKeyboard(userId)
        });
        return;
      }
    }

    if (parts.length > 1 && parts[1].startsWith('ref_')) {
      const referrerId = parts[1].replace('ref_', '');
      if (referrerId !== String(userId)) {
        db.processReferral(userId, referrerId);
      }
    }

    const introMsg = `👋 <b>Welcome to RedNox Store Bot!</b>\n\n` +
      `📣 <b>Channel:</b> @RedNox_Store1\n` +
      `🆘 <b>Support:</b> @Hussain_xd`;

    try {
      await bot.sendMessage(chatId, introMsg, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📣 Channel', url: 'https://t.me/RedNox_Store1' },
              { text: '🆘 Support', url: 'https://t.me/Hussain_xd' }
            ]
          ]
        }
      });
    } catch (e) {
      console.error('Failed to send intro message:', e.message);
    }

    const customPhoto = db.getWelcomePhoto();
    const bannerPath = path.join(__dirname, 'kos_banner.png');
    const photoToSend = customPhoto || (fs.existsSync(bannerPath) ? bannerPath : null);

    const userObj = db.getUser(userId) || { firstName: username };
    const balance = db.getUserBalance(userId).toFixed(1);
    const lastOrder = db.getLastUserOrder(userId);
    const lastPurchaseText = lastOrder ? `#${lastOrder.id} (${lastOrder.items[0]?.name || 'Item'})` : 'No purchases yet';

    const captionText = `🖐️ <b>Welcome</b> <b>${userObj.firstName || 'Customer'}</b>\n` +
      `_____________________________________\n\n` +
      `🪙 <b>Balance:</b> <code>$${balance} USD</code>\n` +
      `👤 <b>Status:</b> 👤 Customer\n` +
      `🕒 <b>Last Purchase:</b> <i>${lastPurchaseText}</i>\n` +
      `_____________________________________\n\n` +
      `<b>RedNox Store</b>`;

    if (photoToSend) {
      await bot.sendPhoto(chatId, photoToSend, {
        caption: captionText,
        reply_markup: getMainMenuKeyboard(userId)
      });
    } else {
      await bot.sendMessage(chatId, captionText, {
        reply_markup: getMainMenuKeyboard(userId)
      });
    }
    return;
  }

  const state = userStates[userId];
  if (state) {
    if (state.type === 'ADMIN_WAITING_WELCOME_PHOTO') {
      if (!db.isAdmin(userId)) return;
      let photoVal = null;
      if (msg.photo && msg.photo.length > 0) {
        photoVal = msg.photo[msg.photo.length - 1].file_id;
      } else if (text) {
        photoVal = text;
      }

      if (!photoVal) {
        await bot.sendMessage(chatId, `❌ Please send a valid photo or photo URL link!`);
        return;
      }

      db.setWelcomePhoto(photoVal);
      userStates[userId] = null;
      await bot.sendMessage(chatId, `✅ <b>WELCOME BANNER PHOTO UPDATED SUCCESSFULLY!</b> 🎉\n\n` +
        `The new banner image is now active for all users when starting the bot!`, {
          reply_markup: {
            inline_keyboard: [[{ text: '👑 Admin Dashboard', callback_data: 'admin_dashboard' }]]
          }
        });
      return;
    }
    if (state.type === 'ADMIN_WAITING_APK_URL') {
      if (!db.isAdmin(userId)) return;

      if (msg.document) {
        const fileId = msg.document.file_id;
        const fileName = msg.document.file_name || 'KOS_App.apk';
        db.setApkFile(fileId, fileName);
        userStates[userId] = { type: 'ADMIN_WAITING_APK_DESC' };
        await bot.sendMessage(chatId, `✅ <b>APK FILE UPLOADED!</b> 🎉\n\n` +
          `📦 <b>File Name:</b> <code>${fileName}</code>\n\n` +
          `✍️ <b>Now send the Description text for this APK:</b>\n` +
          `<i>(Type details like version, features, guide, etc. in chat below, or click <b>⏩ Skip</b>)</i>`, {
            reply_markup: {
              inline_keyboard: [[{ text: '⏩ Skip / Use Default', callback_data: 'admin_dashboard' }]]
            }
          });
        return;
      } else if (text) {
        db.setApkUrl(text);
        userStates[userId] = { type: 'ADMIN_WAITING_APK_DESC' };
        await bot.sendMessage(chatId, `✅ <b>APK LINK UPDATED!</b> 🎉\n\n` +
          `🔗 <b>Link:</b> <code>${text}</code>\n\n` +
          `✍️ <b>Now send the Description text for this APK:</b>\n` +
          `<i>(Type details like version, features, guide, etc. in chat below, or click <b>⏩ Skip</b>)</i>`, {
            reply_markup: {
              inline_keyboard: [[{ text: '⏩ Skip / Use Default', callback_data: 'admin_dashboard' }]]
            }
          });
        return;
      } else {
        await bot.sendMessage(chatId, `❌ Please send an APK document file or a valid URL link!`);
        return;
      }
    }
    if (state.type === 'ADMIN_WAITING_APK_DESC') {
      if (!db.isAdmin(userId)) return;
      if (text) {
        db.setApkDescription(text);
        userStates[userId] = null;
        await bot.sendMessage(chatId, `✅ <b>APK DESCRIPTION UPDATED SUCCESSFULLY!</b> 🎉\n\n` +
          `📝 <b>Description Preview:</b>\n${text}`, {
            reply_markup: {
              inline_keyboard: [[{ text: '👑 Admin Dashboard', callback_data: 'admin_dashboard' }]]
            }
          });
        return;
      }
    }
    if (state.type === 'AI_SUPPORT_CHAT') {
      if (text) {
        const aiAnswer = processAiSupportQuery(text, userId);
        await bot.sendMessage(chatId, aiAnswer, {
          reply_markup: {
            inline_keyboard: [
              [{ text: `👤 Talk to Owner Direct (${OWNER_HANDLE})`, callback_data: 'human_support_ticket' }],
              [{ text: '🔙 Main Menu', callback_data: 'nav_main' }]
            ]
          }
        });
        return;
      }
    }
    if (state.type === 'ADMIN_ADD_CHANNEL_INPUT') {
      if (!db.isAdmin(userId)) return;
      state.type = 'ADMIN_CONFIRM_ADD_CHANNEL';
      state.channelInput = text;
      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: ADD REQUIRED CHANNEL</b>\n\n` +
        `📢 <b>Channel:</b> <code>${text}</code>\n\n` +
        `❓ <i>Are you sure you want to approve and add this channel to the required Force Join list?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📢 ✅ Yes, Confirm & Add Channel', callback_data: 'admin_do_confirm_add_chan' }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_manage_channels' }]
            ]
          }
        });
      return;
    } else if (state.type === 'WAITING_SUPPORT_TICKET_MSG') {
      const ticket = db.createSupportTicket(userId, username, text);
      userStates[userId] = null;

      await bot.sendMessage(chatId, `✅ <b>SUPPORT TICKET SUBMITTED! (#${ticket.id})</b>\n\n` +
        `Your message has been sent directly to Store Owner <b>${OWNER_HANDLE}</b>.\n` +
        `You will receive a direct reply inside this chat shortly!`, {
          reply_markup: {
            inline_keyboard: [[{ text: '🛍️ Return to Store Menu', callback_data: 'nav_main' }]]
          }
        });

      const adminNotice = `📩 <b>NEW CUSTOMER SUPPORT TICKET! (#${ticket.id})</b>\n\n` +
        `👤 <b>Customer:</b> @${username} (ID: <code>${userId}</code>)\n` +
        `📝 <b>Issue / Message:</b>\n` +
        `<i>"${text}"</i>\n\n` +
        `👇 <i>Click the button below to reply directly to this customer:</i>`;

      notifyOwnerAdmin(adminNotice, {
        reply_markup: {
          inline_keyboard: [[{ text: `💬 Reply to Ticket #${ticket.id}`, callback_data: `admin_reply_ticket:${ticket.id}` }]]
        }
      });
      return;
    } else if (state.type === 'ADMIN_REPLY_TICKET_INPUT') {
      if (!db.isAdmin(userId)) return;
      const ticket = db.replySupportTicket(state.ticketId, text);
      userStates[userId] = null;

      if (ticket) {
        await bot.sendMessage(ticket.userId, text, {
          reply_markup: {
            inline_keyboard: [[{ text: '🛍️ Store Menu', callback_data: 'nav_main' }]]
          }
        });

        await bot.sendMessage(chatId, `✅ <b>Reply Sent!</b> Your message was delivered directly to customer @${ticket.username}!`, {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
          }
        });
      } else {
        await bot.sendMessage(chatId, '❌ Ticket not found.');
      }
      return;
    } else if (state.type === 'WAITING_BUY_QTY_INPUT') {
      const qty = parseInt(text);
      const prod = db.getProduct(state.productId);
      if (!prod) {
        userStates[userId] = null;
        await bot.sendMessage(chatId, '❌ Product no longer available.');
        return;
      }
      if (isNaN(qty) || qty <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid quantity. Please reply with a valid number (e.g. 5):');
        return;
      }
      if (qty > prod.stock) {
        await bot.sendMessage(chatId, `❌ Requested quantity (${qty}) exceeds available stock (${prod.stock}). Please enter a smaller number:`);
        return;
      }
      userStates[userId] = null;
      await showDirectCheckoutSummary(chatId, userId, state.productId, qty);
      return;
    } else if (state.type === 'WAITING_PAYMENT_PROOF') {
      await processPaymentProof(msg, state);
      userStates[userId] = null;
      return;
    } else if (state.type === 'WAITING_DEPOSIT_AMOUNT') {
      const depAmount = parseFloat(text);
      if (isNaN(depAmount) || depAmount < 0.01) {
        await bot.sendMessage(chatId, '❌ Minimum deposit amount is <b>$0.01 USD</b>. Please enter a valid amount:');
        return;
      }
      userStates[userId] = {
        type: 'WAITING_DEPOSIT_TRX',
        requestedAmountUsd: depAmount
      };

      const bep20Address = db.getSettings().paymentMethods?.usdt_bep20 || '0x9917d2894072e53cd27542e4fc76c152c284a01c';

      const textMsg = `💳 <b>DEPOSIT FUNDS TO WALLET BALANCE</b>\n\n` +
        `Requested Amount: <b>$${depAmount.toFixed(2)} USD</b>\n\n` +
        `🟡 <b>Option 1: Binance Pay ID (Instant):</b>\n` +
        `<code>${BINANCE_PAY_ID}</code> <i>(Tap number to copy ID)</i>\n` +
        `👤 Account Name: ${BINANCE_ACCOUNT_NAME}\n\n` +
        `💎 <b>Option 2: USDT BEP20 (BSC) Address:</b>\n` +
        `<code>${bep20Address}</code> <i>(Tap address to copy)</i>\n` +
        `🌐 Network: BNB Smart Chain (BEP20 / BSC)\n\n` +
        `⏱ <b>Important Notice:</b>\n` +
        `BNB Smart Chain (BEP20) transactions require <b>5 to 10 minutes</b> for blockchain network confirmations. As soon as confirmed, your wallet balance will be credited automatically!\n\n` +
        `<i>After completing transfer, reply with your <b>Transaction ID / TxHash</b> below!</i>`;

      await bot.sendMessage(chatId, textMsg, {
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Cancel Deposit', callback_data: 'nav_main' }]]
        }
      });
      return;
    } else if (state.type === 'WAITING_DEPOSIT_TRX') {
      await processDepositTransaction(msg, state);
      userStates[userId] = null;
      return;
    } else if (state.type === 'ADMIN_ADD_SECTION_NAME') {
      if (!db.isAdmin(userId)) return;
      state.type = 'ADMIN_CONFIRM_ADD_SECTION';
      state.sectionName = text;
      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: CREATE NEW SECTION</b>\n\n` +
        `📁 <b>Section Name:</b> <code>${text}</code>\n\n` +
        `❓ <i>Are you sure you want to approve and create this section?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Yes, Confirm & Create', callback_data: 'admin_do_confirm_add_sec' }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_manage_sections' }]
            ]
          }
        });
      return;
    } else if (state.type === 'ADMIN_ADD_PRODUCT_NAME') {
      if (!db.isAdmin(userId)) return;
      state.productData.name = text;
      state.type = 'ADMIN_ADD_PRODUCT_PRICE';
      await bot.sendMessage(chatId, '💰 Enter product unit price in USD ($) e.g. 0.44:');
      return;
    } else if (state.type === 'ADMIN_ADD_PRODUCT_PRICE') {
      if (!db.isAdmin(userId)) return;
      const price = parseFloat(text);
      if (isNaN(price)) {
        await bot.sendMessage(chatId, '❌ Invalid price. Please enter a valid number (e.g. 0.44):');
        return;
      }
      state.productData.price = price;
      state.type = 'ADMIN_ADD_PRODUCT_DESC';
      await bot.sendMessage(chatId, '📝 Enter product description & warranty details:');
      return;
    } else if (state.type === 'ADMIN_ADD_PRODUCT_DESC') {
      if (!db.isAdmin(userId)) return;
      state.productData.description = text;
      state.type = 'ADMIN_ADD_PRODUCT_KEYS_FILE';
      await bot.sendMessage(chatId, `📁 <b>Upload Stock Keys / Links File (.txt)</b>\n\n` +
        `Please send/upload a <b>.txt document file</b> containing all keys, accounts, or links (one per line).\n\n` +
        `<i>Alternatively, paste text lines directly into chat:</i>`);
      return;
    } else if (state.type === 'ADMIN_ADD_PRODUCT_KEYS_FILE') {
      if (!db.isAdmin(userId)) return;
      let keyLines = [];

      if (msg.document) {
        await bot.sendMessage(chatId, '📥 <i>Downloading and parsing .txt stock file...</i>');
        const fileInfo = await bot.getFile(msg.document.file_id);
        if (fileInfo && fileInfo.ok && fileInfo.result.file_path) {
          const fileText = await bot.downloadFileText(fileInfo.result.file_path);
          keyLines = fileText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        }
      } else if (text) {
        keyLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      }

      if (keyLines.length === 0) {
        await bot.sendMessage(chatId, '❌ No valid keys or links found in file/text. Please upload a valid .txt file:');
        return;
      }

      state.productData.keyPool = keyLines;
      state.productData.digitalKey = keyLines[0] || 'Digital Product Credentials Active';
      state.type = 'ADMIN_CONFIRM_ADD_PRODUCT';
      state.keyLines = keyLines;

      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: CREATE NEW PRODUCT</b>\n\n` +
        `📦 <b>Product Name:</b> <b>${state.productData.name}</b>\n` +
        `💰 <b>Unit Selling Price:</b> <b>$${state.productData.price.toFixed(2)} USD</b>\n` +
        `📊 <b>Initial Stock Keys:</b> <b>${keyLines.length} Units</b>\n` +
        `📝 <b>Description:</b> <i>${state.productData.description || 'N/A'}</i>\n\n` +
        `❓ <i>Are you sure you want to approve and publish this product to the store?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Yes, Confirm & Publish', callback_data: 'admin_do_confirm_add_prod' }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_dashboard' }]
            ]
          }
        });
      return;
    } else if (state.type === 'ADMIN_RESTOCK_INPUT') {
      if (!db.isAdmin(userId)) return;
      let keyLines = [];

      if (msg.document) {
        await bot.sendMessage(chatId, '📥 <i>Downloading and parsing .txt stock file...</i>');
        const fileInfo = await bot.getFile(msg.document.file_id);
        if (fileInfo && fileInfo.ok && fileInfo.result.file_path) {
          const fileText = await bot.downloadFileText(fileInfo.result.file_path);
          keyLines = fileText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        }
      } else if (text) {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 1 && !isNaN(parseInt(lines[0]))) {
          const qty = parseInt(lines[0]);
          const prod = db.getProduct(state.productId);
          if (!prod) return;
          state.type = 'ADMIN_CONFIRM_RESTOCK_NUM';
          state.restockQty = qty;
          await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: RESTOCK PRODUCT</b>\n\n` +
            `📦 <b>Product:</b> <b>${prod.name}</b>\n` +
            `➕ <b>Stock Units to Add:</b> <b>+${qty} Units</b>\n` +
            `📊 <b>Current Stock:</b> <code>${prod.stock} Units</code>\n` +
            `📦 <b>New Total Stock:</b> <b>${prod.stock + qty} Units</b>\n\n` +
            `❓ <i>Are you sure you want to approve and restock this product?</i>`, {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '✅ Yes, Confirm & Restock', callback_data: 'admin_do_confirm_restock_num' }],
                  [{ text: '❌ Cancel / Abort', callback_data: 'admin_dashboard' }]
                ]
              }
            });
          return;
        } else {
          keyLines = lines;
        }
      }

      if (keyLines.length === 0) {
        await bot.sendMessage(chatId, '❌ No valid keys found. Upload a .txt file or paste keys line-by-line:');
        return;
      }

      const prod = db.getProduct(state.productId);
      if (!prod) return;
      state.type = 'ADMIN_CONFIRM_RESTOCK_KEYS';
      state.keyLines = keyLines;

      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: IMPORT STOCK KEYS</b>\n\n` +
        `📦 <b>Product:</b> <b>${prod.name}</b>\n` +
        `➕ <b>Keys to Import:</b> <b>+${keyLines.length} Units</b>\n` +
        `📊 <b>Current Stock:</b> <code>${prod.stock} Units</code>\n` +
        `📦 <b>New Total Stock:</b> <b>${prod.stock + keyLines.length} Units</b>\n\n` +
        `❓ <i>Are you sure you want to approve and import these stock keys?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Yes, Confirm & Import Keys', callback_data: 'admin_do_confirm_restock_keys' }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_dashboard' }]
            ]
          }
        });
      return;
    } else if (state.type === 'ADMIN_REDUCE_STOCK_INPUT') {
      if (!db.isAdmin(userId)) return;
      const reduceQty = parseInt(text);
      const prod = db.getProduct(state.productId);
      if (!prod) {
        userStates[userId] = null;
        await bot.sendMessage(chatId, '❌ Product not found.');
        return;
      }
      if (isNaN(reduceQty) || reduceQty <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid quantity. Enter a valid number (e.g. 200):');
        return;
      }
      if (reduceQty > prod.stock) {
        await bot.sendMessage(chatId, `❌ Deduct quantity (${reduceQty}) cannot be larger than current stock (${prod.stock}). Enter a smaller number:`);
        return;
      }

      state.type = 'ADMIN_CONFIRM_REDUCE_STOCK';
      state.reduceQty = reduceQty;

      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: DEDUCT & EXPORT STOCK</b>\n\n` +
        `📦 <b>Product:</b> <b>${prod.name}</b>\n` +
        `➖ <b>Quantity to Deduct:</b> <b>-${reduceQty} Units</b>\n` +
        `📊 <b>Current Stock:</b> <code>${prod.stock} Units</code>\n` +
        `📦 <b>New Remaining Stock:</b> <b>${prod.stock - reduceQty} Units</b>\n\n` +
        `<i>Note: Deducted keys will be exported into a .txt file and sent to you.</i>\n\n` +
        `❓ <i>Are you sure you want to approve and deduct these keys?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔴 ✅ Yes, Confirm & Deduct', callback_data: 'admin_do_confirm_reduce_stock' }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_manage_prods' }]
            ]
          }
        });
      return;
    } else if (state.type === 'ADMIN_EDIT_PRICE') {
      if (!db.isAdmin(userId)) return;
      const newPrice = parseFloat(text);
      if (isNaN(newPrice) || newPrice <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid price. Please enter a valid USD selling price (e.g. 0.80, 1.00, 1.50):');
        return;
      }
      const prod = db.getProduct(state.productId);
      if (!prod) return;

      state.type = 'ADMIN_CONFIRM_EDIT_PRICE';
      state.newPrice = newPrice;

      const wholesaleStr = prod.wholesaleCost ? `\n🏭 Wholesale Reseller Cost: <b>$${prod.wholesaleCost.toFixed(2)} USD</b>` : '';
      const profit = prod.wholesaleCost ? (newPrice - prod.wholesaleCost) : 0;
      const profitStr = prod.wholesaleCost ? `\n📈 <b>New Profit Margin per sale:</b> <b>+$${profit.toFixed(2)} USD</b>` : '';

      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: CHANGE PRODUCT PRICE</b>\n\n` +
        `📦 <b>Product:</b> <b>${prod.name}</b>${wholesaleStr}\n` +
        `💵 <b>Current Customer Price:</b> <code>$${prod.price.toFixed(2)} USD</code>\n` +
        `💰 <b>New Selling Price:</b> <b>$${newPrice.toFixed(2)} USD</b>${profitStr}\n\n` +
        `❓ <i>Are you sure you want to approve and update this price for all customers?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💰 ✅ Yes, Confirm & Update Price', callback_data: 'admin_do_confirm_edit_price' }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_manage_prods' }]
            ]
          }
        });
      return;
    } else if (state.type === 'ADMIN_CREATE_GIFT_LINK_INPUT') {
      if (!db.isAdmin(userId)) return;
      const amountUsd = parseFloat(text);
      if (isNaN(amountUsd) || amountUsd <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid amount. Please enter a valid number (e.g. 50, 100, 250):');
        return;
      }

      const gift = db.createGiftCode(amountUsd, userId);
      userStates[userId] = null;

      const botUsername = (await bot.getMe())?.username || 'RednoxSellerbot';
      const claimLink = `https://t.me/${botUsername}?start=claim_${gift.code}`;

      const msgText = `🎁 <b>GIFT CREDIT DEPOSIT LINK CREATED!</b> 🎉\n\n` +
        `🪙 <b>Deposit Amount:</b> <code>$${gift.amount.toFixed(2)} USD</code>\n` +
        `🔑 <b>Redeem Code:</b> <code>${gift.code}</code>\n\n` +
        `🔗 <b>Direct Claim Link:</b>\n` +
        `<code>${claimLink}</code>\n\n` +
        `<i>📌 <b>How it works:</b>\n` +
        `Send this claim link to any customer. When they click the link, <b>$${gift.amount.toFixed(2)} USD</b> will be automatically credited to their wallet balance instantly!</i>`;

      await bot.sendMessage(chatId, msgText, {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
        }
      });
      return;
    } else if (state.type === 'ADMIN_WAITING_ADD_BAL_USER_ID') {
      if (!db.isAdmin(userId)) return;
      const targetUser = db.findUserByIdOrUsername(text);
      if (!targetUser) {
        await bot.sendMessage(chatId, `❌ User <code>${text}</code> not found in database. Please enter a valid Telegram User ID or @username:`);
        return;
      }
      const currentBal = db.getUserBalance(targetUser.userId);
      userStates[userId] = { type: 'ADMIN_WAITING_ADD_BAL_AMOUNT', targetUserId: targetUser.userId, targetUser };
      await bot.sendMessage(chatId, `👤 <b>CUSTOMER FOUND!</b>\n\n` +
        `👤 <b>Customer:</b> ${targetUser.firstName} ${targetUser.username ? '(@' + targetUser.username + ')' : ''}\n` +
        `🆔 <b>Telegram ID:</b> <code>${targetUser.userId}</code>\n` +
        `💰 <b>Current Balance:</b> <code>$${currentBal.toFixed(2)} USD</code>\n\n` +
        `<i>Please enter the amount in $ USD to ADD to this user's wallet (e.g. 50, 100):</i>`);
      return;
    } else if (state.type === 'ADMIN_WAITING_ADD_BAL_AMOUNT') {
      if (!db.isAdmin(userId)) return;
      const amountUsd = parseFloat(text);
      if (isNaN(amountUsd) || amountUsd <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid amount. Please enter a valid positive number (e.g. 50, 100):');
        return;
      }
      const targetUid = state.targetUserId;
      const targetUser = state.targetUser;
      const currentBal = db.getUserBalance(targetUid);
      state.type = 'ADMIN_CONFIRM_ADD_BAL';
      state.amountUsd = amountUsd;

      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: ADD WALLET BALANCE</b>\n\n` +
        `👤 <b>Customer:</b> ${targetUser.firstName} ${targetUser.username ? '(@' + targetUser.username + ')' : ''} (ID: <code>${targetUid}</code>)\n` +
        `➕ <b>Amount to Credit:</b> <b>+$${amountUsd.toFixed(2)} USD</b>\n` +
        `💰 <b>Current Balance:</b> <code>$${currentBal.toFixed(2)} USD</code>\n` +
        `💳 <b>New Balance after Credit:</b> <b>$${(currentBal + amountUsd).toFixed(2)} USD</b>\n\n` +
        `❓ <i>Are you sure you want to approve and credit this balance?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ ✅ Yes, Confirm & Credit', callback_data: 'admin_do_confirm_add_bal' }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_dashboard' }]
            ]
          }
        });
      return;
    } else if (state.type === 'ADMIN_WAITING_DEDUCT_BAL_USER_ID') {
      if (!db.isAdmin(userId)) return;
      const targetUser = db.findUserByIdOrUsername(text);
      if (!targetUser) {
        await bot.sendMessage(chatId, `❌ User <code>${text}</code> not found in database. Please enter a valid Telegram User ID or @username:`);
        return;
      }
      const currentBal = db.getUserBalance(targetUser.userId);
      userStates[userId] = { type: 'ADMIN_WAITING_DEDUCT_BAL_AMOUNT', targetUserId: targetUser.userId, targetUser };
      await bot.sendMessage(chatId, `👤 <b>CUSTOMER FOUND!</b>\n\n` +
        `👤 <b>Customer:</b> ${targetUser.firstName} ${targetUser.username ? '(@' + targetUser.username + ')' : ''}\n` +
        `🆔 <b>Telegram ID:</b> <code>${targetUser.userId}</code>\n` +
        `💰 <b>Current Balance:</b> <code>$${currentBal.toFixed(2)} USD</code>\n\n` +
        `<i>Please enter the amount in $ USD to DEDUCT / REMOVE from this user's wallet (e.g. 50, 100):</i>`);
      return;
    } else if (state.type === 'ADMIN_WAITING_DEDUCT_BAL_AMOUNT') {
      if (!db.isAdmin(userId)) return;
      const amountUsd = parseFloat(text);
      if (isNaN(amountUsd) || amountUsd <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid amount. Please enter a valid positive number (e.g. 50, 100):');
        return;
      }
      const targetUid = state.targetUserId;
      const targetUser = state.targetUser;
      const currentBal = db.getUserBalance(targetUid);
      state.type = 'ADMIN_CONFIRM_DEDUCT_BAL';
      state.amountUsd = amountUsd;

      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: DEDUCT WALLET BALANCE</b>\n\n` +
        `👤 <b>Customer:</b> ${targetUser.firstName} ${targetUser.username ? '(@' + targetUser.username + ')' : ''} (ID: <code>${targetUid}</code>)\n` +
        `➖ <b>Amount to Deduct:</b> <b>-$${amountUsd.toFixed(2)} USD</b>\n` +
        `💰 <b>Current Balance:</b> <code>$${currentBal.toFixed(2)} USD</code>\n` +
        `💳 <b>New Balance after Deduction:</b> <b>$${(currentBal - amountUsd).toFixed(2)} USD</b>\n\n` +
        `❓ <i>Are you sure you want to approve and deduct this balance?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔴 ✅ Yes, Confirm & Deduct', callback_data: 'admin_do_confirm_deduct_bal' }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_dashboard' }]
            ]
          }
        });
      return;
    } else if (state.type === 'ADMIN_SET_BINANCE_KEY') {
      if (!db.isAdmin(userId)) return;
      state.binanceKey = text;
      state.type = 'ADMIN_SET_BINANCE_SECRET';
      await bot.sendMessage(chatId, '🔑 Now enter your Binance Pay API Secret Key:');
      return;
    } else if (state.type === 'ADMIN_SET_BINANCE_SECRET') {
      if (!db.isAdmin(userId)) return;
      db.setBinanceCredentials(state.binanceKey, text);
      userStates[userId] = null;
      await bot.sendMessage(chatId, `✅ <b>Binance Pay API Credentials Configured!</b>\n\n` +
        `🤖 Auto-Verification & Instant Delivery is now <b>ACTIVE</b>!`, {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
          }
        });
      return;
    } else if (state.type === 'ADMIN_SET_PRODSELLER_KEY_INPUT') {
      if (!db.isAdmin(userId)) return;
      db.setProdSellerApiKey(text);
      userStates[userId] = null;
      await bot.sendMessage(chatId, `✅ <b>ProdSeller API Key Saved!</b>\n\nKey: <code>${text}</code>`, {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 ProdSeller Manager', callback_data: 'admin_prodseller_menu' }]]
        }
      });
      return;
    } else if (state.type === 'ADMIN_SET_SELLER_DEPOSIT_INPUT') {
      if (!db.isAdmin(userId)) return;
      db.setSellerDepositAddress(text);
      userStates[userId] = null;
      await bot.sendMessage(chatId, `✅ <b>Seller Bot Deposit Target Configured!</b> 🎉\n\n` +
        `📍 <b>Target Address / Pay ID:</b> <code>${text}</code>\n\n` +
        `<i>Bot will now automatically transfer USDT from your Binance API whenever supplier balance is insufficient!</i>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 ProdSeller Manager', callback_data: 'admin_prodseller_menu' }]]
          }
        });
      return;
    } else if (state.type === 'ADMIN_WAITING_BUTTON_LABEL_INPUT') {
      if (!db.isAdmin(userId)) return;
      const btnKey = state.btnKey;
      db.setCustomButtonLabel(btnKey, text);
      userStates[userId] = null;
      await bot.sendMessage(chatId, `✅ <b>Button Label Updated Successfully!</b> 🎉\n\n` +
        `✏️ New Button Label: <b>${text}</b>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✏️ Customize More Buttons', callback_data: 'admin_rename_buttons_menu' }],
              [{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]
            ]
          }
        });
      return;
    } else if (state.type === 'ADMIN_BROADCAST') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = null;
      await processBroadcast(chatId, text);
      return;
    } else if (state.type === 'ADMIN_EDIT_PAYMENT') {
      if (!db.isAdmin(userId)) return;
      const methodKey = state.methodKey;
      db.updatePaymentMethods({ [methodKey]: text });
      userStates[userId] = null;
      await bot.sendMessage(chatId, `✅ <b>Payment Details Updated!</b>\n\nNew info for <code>${methodKey}</code>:\n<code>${text}</code>`, {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
        }
      });
      return;
      return;
    } else if (state.type === 'ADMIN_WAITING_TIER_MIN_SPENT') {
      if (!db.isAdmin(userId)) return;
      const minSpent = parseFloat(text);
      if (isNaN(minSpent) || minSpent < 0) {
        await bot.sendMessage(chatId, '❌ Invalid amount. Enter a positive number (e.g. 20 or 150):');
        return;
      }
      userStates[userId] = { type: 'ADMIN_WAITING_TIER_DISCOUNT', tierKey: state.tierKey, minSpent };
      await bot.sendMessage(chatId, `💎 <b>Tier:</b> <b>${state.tierKey.toUpperCase()}</b>\n` +
        `💵 <b>Min Spent Target:</b> <b>$${minSpent.toFixed(2)} USD</b>\n\n` +
        `<i>Step 2: Enter the Discount Percentage (%) for this tier (e.g. <code>3</code> for 3%, <code>5</code> for 5%, <code>10</code> for 10%):</i>`);
      return;
    } else if (state.type === 'ADMIN_WAITING_TIER_DISCOUNT') {
      if (!db.isAdmin(userId)) return;
      const disc = parseFloat(text);
      if (isNaN(disc) || disc < 0 || disc > 100) {
        await bot.sendMessage(chatId, '❌ Invalid percentage. Enter a number between 0 and 100 (e.g. 5):');
        return;
      }
      db.updateMembershipTier(state.tierKey, state.minSpent, disc);
      userStates[userId] = null;
      await bot.sendMessage(chatId, `✅ <b>MEMBERSHIP TIER UPDATED SUCCESSFULLY!</b> 🎉\n\n` +
        `💎 <b>Tier:</b> <b>${state.tierKey.toUpperCase()}</b>\n` +
        `💵 <b>Min Spent:</b> <b>$${state.minSpent.toFixed(2)} USD</b>\n` +
        `🏷️ <b>Discount:</b> <b>${disc}% OFF</b>`, {
          reply_markup: { inline_keyboard: [[{ text: '⚙️ Return to Membership Settings', callback_data: 'admin_membership_settings_menu' }]] }
        });
      return;
    } else if (state.type === 'ADMIN_WAITING_COUPON_CODE') {
      if (!db.isAdmin(userId)) return;
      const cleanCode = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!cleanCode) {
        await bot.sendMessage(chatId, '❌ Invalid coupon code. Use letters and numbers (e.g. SUMMER20):');
        return;
      }
      userStates[userId] = { type: 'ADMIN_WAITING_COUPON_DISCOUNT', couponCode: cleanCode };
      await bot.sendMessage(chatId, `🎟️ <b>Coupon Code:</b> <code>${cleanCode}</code>\n\n` +
        `<i>Please enter the Discount Percentage (e.g. 10 for 10% Off, 20 for 20% Off, 50 for 50% Off):</i>`);
      return;
    } else if (state.type === 'ADMIN_WAITING_COUPON_DISCOUNT') {
      if (!db.isAdmin(userId)) return;
      const discountPercent = parseFloat(text);
      if (isNaN(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
        await bot.sendMessage(chatId, '❌ Invalid discount percentage. Enter a number between 1 and 100 (e.g. 20):');
        return;
      }
      const code = state.couponCode;
      db.createCoupon(code, discountPercent, 100);
      userStates[userId] = null;

      await bot.sendMessage(chatId, `✅ <b>PROMO COUPON CREATED SUCCESSFULLY!</b> 🎉\n\n` +
        `🎟️ <b>Coupon Code:</b> <code>${code}</code>\n` +
        `🏷️ <b>Discount:</b> <b>${discountPercent}% OFF</b>\n` +
        `📊 <b>Max Uses:</b> 100 Customers`, {
          reply_markup: {
            inline_keyboard: [[{ text: '⚙️ Return to Coupon Manager', callback_data: 'admin_coupons_menu' }]]
          }
        });
      return;
    } else if (state.type === 'ADMIN_WAITING_PUBLIC_CHANNEL_INPUT') {
      if (!db.isAdmin(userId)) return;
      const channel = db.setPublicRestockChannel(text);
      userStates[userId] = null;
      await bot.sendMessage(chatId, `✅ <b>PUBLIC RESTOCK CHANNEL LINKED!</b> 🎉\n\n` +
        `📢 <b>Linked Channel:</b> <b>${channel}</b>\n\n` +
        `<i>All future restock alerts and announcements will automatically post to this channel!</i>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
          }
        });
      return;
    } else if (state.type === 'CUSTOMER_WAITING_COUPON_INPUT') {
      const code = text.trim();
      const validation = db.validateCoupon(code, userId, 10);
      userStates[userId] = null;
      if (validation.valid) {
        await bot.sendMessage(chatId, `🎉 <b>PROMO COUPON VALIDATED!</b> 🎟️\n\n` +
          `🎟️ <b>Coupon Code:</b> <code>${validation.coupon.code}</code>\n` +
          `🏷️ <b>Discount:</b> <b>${validation.coupon.discountPercent}% OFF</b>\n\n` +
          `<i>Your ${validation.coupon.discountPercent}% discount has been activated! Browse store products now to enjoy your discount.</i>`, {
            reply_markup: {
              inline_keyboard: [[{ text: '🛒 Browse Store Products', callback_data: 'nav_categories' }]]
            }
          });
      } else {
        await bot.sendMessage(chatId, `${validation.error}`, {
          reply_markup: {
            inline_keyboard: [[{ text: '🛍️ Return to Store Menu', callback_data: 'nav_main' }]]
          }
        });
      }
      return;
    } else if (state.type === 'CUSTOMER_WAITING_SEARCH_INPUT') {
      const query = text.trim();
      const results = db.searchProducts(query);
      userStates[userId] = null;

      if (results.length === 0) {
        await bot.sendMessage(chatId, `🔍 <b>NO MATCHING PRODUCTS FOUND</b>\n\n` +
          `No items matching "<b>${query}</b>" were found in stock.`, {
            reply_markup: {
              inline_keyboard: [[{ text: '🛒 Browse All Categories', callback_data: 'nav_categories' }], [{ text: '🛍️ Main Menu', callback_data: 'nav_main' }]]
            }
          });
        return;
      }

      let resText = `🔍 <b>SEARCH RESULTS FOR "${query.toUpperCase()}" (${results.length})</b>\n\n`;

      const prodButtons = results.map(prod => {
        const stockInfo = getProdStockDisplay(prod);
        return { text: `${stockInfo.icon} ${prod.name}`, callback_data: `prod_view_${prod.id}` };
      });
      const keyboard = formatTwoColumnKeyboard(prodButtons);
      keyboard.push([{ text: '🔙 Main Menu', callback_data: 'nav_main' }]);

      await bot.sendMessage(chatId, resText, {
        reply_markup: { inline_keyboard: keyboard }
      });
      return;
    }
  }

  await bot.sendMessage(chatId, userLang.unknown_command, {
    reply_markup: getMainMenuKeyboard(userId)
  });
}

const activeUserLocks = new Set();
const lastUserCallbackTime = {};

async function handleCallbackQuery(cb) {
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const userId = cb.from.id;
  const data = cb.data;

  const isUserAdmin = db.isAdmin(userId);
  const lockKey = `${userId}:${data}`;
  const now = Date.now();

  // Only lock critical purchase checkout actions for non-admins
  if (!isUserAdmin && data.startsWith('buy_pay_')) {
    if (activeUserLocks.has(lockKey) || (lastUserCallbackTime[lockKey] && (now - lastUserCallbackTime[lockKey]) < 2000)) {
      try { await bot.answerCallbackQuery(cb.id, '⏳ Payment is processing...', false); } catch (e) {}
      return;
    }
    lastUserCallbackTime[lockKey] = now;
    activeUserLocks.add(lockKey);
  }

  try {
    try { await bot.answerCallbackQuery(cb.id); } catch (e) {}
    const userLangCode = db.getLanguage(userId);
    const userLang = getLang(userLangCode);

    if (db.isMaintenanceMode() && !db.isAdmin(userId)) {
      await bot.sendMessage(chatId, `🚧 <b>STORE UNDER MAINTENANCE</b> 🔴\n\nThe store is currently offline for maintenance by <b>${OWNER_HANDLE}</b>.`);
      return;
    }

    if (data === 'check_joined_channels') {
      const joinCheck = await checkUserJoinedChannels(userId);
      if (joinCheck.allJoined) {
        await bot.sendMessage(chatId, `🎉 <b>VERIFICATION SUCCESSFUL!</b>\n\nThank you for joining our channel! The store is now unlocked.`, {
          reply_markup: getMainMenuKeyboard(userId)
        });
      } else {
        await bot.answerCallbackQuery(cb.id, '❌ You have not joined all required channels yet! Please join first.', true);
        await sendForceJoinPrompt(chatId, userId, joinCheck.unjoinedChannels, true, messageId);
      }
      return;
    }

    if (!data.startsWith('admin_') && !db.isAdmin(userId)) {
      const joinCheck = await checkUserJoinedChannels(userId);
      if (!joinCheck.allJoined) {
        await sendForceJoinPrompt(chatId, userId, joinCheck.unjoinedChannels, true, messageId);
        return;
      }
    }

    if (data === 'nav_main') {
      userStates[userId] = null;
      const customPhoto = db.getWelcomePhoto();
      const bannerPath = path.join(__dirname, 'kos_banner.png');
      const photoToSend = customPhoto || (fs.existsSync(bannerPath) ? bannerPath : null);

      const userObj = db.getUser(userId) || { firstName: username };
      const balance = db.getUserBalance(userId).toFixed(1);
      const lastOrder = db.getLastUserOrder(userId);
      const lastPurchaseText = lastOrder ? `#${lastOrder.id} (${lastOrder.items[0]?.name || 'Item'})` : 'No purchases yet';

      const captionText = `🖐️ <b>Welcome</b> <b>${userObj.firstName || 'Customer'}</b>\n` +
        `_____________________________________\n\n` +
        `🪙 <b>Balance:</b> <code>$${balance} USD</code>\n` +
        `👤 <b>Status:</b> 👤 Customer\n` +
        `🕒 <b>Last Purchase:</b> <i>${lastPurchaseText}</i>\n` +
        `_____________________________________\n\n` +
        `<b>RedNox Store</b>`;

      if (messageId) {
        const editRes = await bot.editMessageText(chatId, messageId, captionText, {
          reply_markup: getMainMenuKeyboard(userId)
        });
        if (editRes && editRes.ok) return;
      }

      if (photoToSend) {
        await bot.sendPhoto(chatId, photoToSend, {
          caption: captionText,
          reply_markup: getMainMenuKeyboard(userId)
        });
      } else {
        await bot.sendMessage(chatId, captionText, {
          reply_markup: getMainMenuKeyboard(userId)
        });
      }
    } else if (data === 'nav_referral') {
      const refCount = db.getUserReferralsCount(userId);
      const bonusPerRef = ((db.getSettings() && db.getSettings().referralBonusUsd) || 0.50).toFixed(2);
      const totalEarned = (refCount * bonusPerRef).toFixed(2);
      const me = await bot.getMe();
      const botUsername = me.result?.username || 'RednoxSellerbot';
      const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

      const text = `🎁 <b>Referral Program</b>\n\n` +
        `💰 <b>Reward Per Referral</b>\n` +
        `<b>$${bonusPerRef} USD</b>\n\n` +
        `👥 <b>Total Referrals</b>\n` +
        `<b>${refCount}</b>\n\n` +
        `💵 <b>Total Earned</b>\n` +
        `<b>$${totalEarned} USD</b>\n` +
        `_____________________________________\n\n` +
        `📌 <b>Referral Rules</b>\n\n` +
        `• Join both required channels.\n` +
        `• Self-referrals are not allowed.\n` +
        `• One reward per successful user.\n` +
        `• Reward is credited only after verification.\n` +
        `_____________________________________\n\n` +
        `🔗 <b>Your Referral Link</b>\n\n` +
        `<code>${refLink}</code>`;

      const keyboard = [
        [{ text: '🌝 My Referrals', callback_data: 'nav_my_referrals' }],
        [{ text: '🔄 Share Referral Link', url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Join RedNox Store for AI Subscriptions & Digital Accounts!')}` }],
        [{ text: '🔙 Back', callback_data: 'nav_main' }]
      ];

      if (messageId) {
        const editRes = await bot.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
        if (editRes && editRes.ok) return;
      }

      await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    } else if (data === 'nav_my_referrals') {
      const refList = db.getUserReferralsList(userId);
      let listStr = '';
      if (refList.length === 0) {
        listStr = `<i>You have not referred any users yet. Share your referral link to earn rewards!</i>`;
      } else {
        refList.forEach((r, idx) => {
          const userObj = db.getUser(r.userId);
          const nameStr = userObj ? (userObj.firstName || `User #${r.userId}`) : `User #${r.userId}`;
          const dateStr = new Date(r.createdAt).toLocaleDateString();
          listStr += `${idx + 1}. <b>${nameStr}</b> (ID: <code>${r.userId}</code>) - ${dateStr}\n`;
        });
      }

      const text = `👥 <b>MY REFERRED USERS (${refList.length})</b>\n\n` +
        `${listStr}\n\n` +
        `💰 <b>Total Bonus Earned:</b> <b>$${(refList.length * 0.50).toFixed(2)} USD</b>`;

      const keyboard = [
        [{ text: '🔙 Back to Referral Program', callback_data: 'nav_referral' }],
        [{ text: '🔙 Main Menu', callback_data: 'nav_main' }]
      ];

      if (messageId) {
        const editRes = await bot.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
        if (editRes && editRes.ok) return;
      }

      await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    } else if (data === 'nav_download_apk') {
      const apkFileId = db.getApkFileId();
      const apkFileName = db.getApkFileName();
      const apkUrl = db.getApkUrl();
      const apkDesc = db.getApkDescription();

      const caption = `📥 <b>DOWNLOAD REDNOX STORE OFFICIAL APP</b> 📱\n\n` +
        `<b>Official Release:</b> ${apkFileName}\n\n` +
        `${apkDesc}`;

      if (apkFileId) {
        await bot.sendDocument(chatId, apkFileId, apkFileName, {
          caption: caption,
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'nav_main' }]]
          }
        });
      } else {
        const keyboard = [
          [{ text: '📱 Download RedNox App', url: apkUrl }],
          [{ text: '🔙 Main Menu', callback_data: 'nav_main' }]
        ];
        if (messageId) {
          const editRes = await bot.editMessageText(chatId, messageId, caption, { reply_markup: { inline_keyboard: keyboard } });
          if (editRes && editRes.ok) return;
        }
        await bot.sendMessage(chatId, caption, { reply_markup: { inline_keyboard: keyboard } });
      }
    } else if (data === 'admin_edit_apk_url') {
      if (!db.isAdmin(userId)) return;
      const currentUrl = db.getApkUrl();
      const currentFileId = db.getApkFileId();
      const currentFileName = db.getApkFileName();

      let infoStr = currentFileId ? `Direct Telegram Document: <code>${currentFileName}</code>` : `Link: <code>${currentUrl}</code>`;

      userStates[userId] = { type: 'ADMIN_WAITING_APK_URL' };
      await bot.sendMessage(chatId, `📥 <b>UPDATE APK DOWNLOAD / FILE</b>\n\n` +
        `Current Status: ${infoStr}\n\n` +
        `📌 <b>Instructions:</b>\n` +
        `• Send an <b>.apk file document</b> directly in this chat\n` +
        `• OR send an <b>APK download URL link</b> (e.g. <code>https://...</code>)\n\n` +
        `<i>Send APK file or link now:</i>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_dashboard' }]]
          }
        });
    } else if (data === 'nav_reseller') {
      const text = `🤝 <b>BECOME AN OFFICIAL REDNOX RESELLER</b> 💼\n\n` +
        `Earn big profits by reselling RedNox AI & Digital Accounts to your customers!\n\n` +
        `💎 <b>Reseller Tier Discounts:</b>\n` +
        `• <b>10+ Items:</b> 20% Discount\n` +
        `• <b>50+ Items:</b> 35% Discount\n` +
        `• <b>100+ Items:</b> 50% VIP Bulk Rate\n\n` +
        `⚡ <i>Automated Panel Access & Bulk Product Fulfillment!</i>\n\n` +
        `<i>Tap below to contact Store Owner <b>${OWNER_HANDLE}</b> for Reseller Activation:</i>`;

      const keyboard = [
        [{ text: `💬 Contact Owner (${OWNER_HANDLE})`, url: `https://t.me/${OWNER_HANDLE.replace('@', '')}` }],
        [{ text: '🔙 Main Menu', callback_data: 'nav_main' }]
      ];

      if (messageId) {
        const editRes = await bot.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
        if (editRes && editRes.ok) return;
      }

      await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    } else if (data === 'nav_categories') {
      await showCategories(chatId, messageId, userId);
    } else if (data.startsWith('prod_group_')) {
      const groupKey = data.replace('prod_group_', '');
      await showProductGroupPlans(chatId, messageId, groupKey, userId);
    } else if (data.startsWith('cat_view_')) {
      const catId = data.replace('cat_view_', '');
      await showProductsInCategory(chatId, messageId, catId, userId);
    } else if (data.startsWith('prod_view_')) {
      const prodId = data.replace('prod_view_', '');
      await showProductDetails(chatId, messageId, prodId, userId);
    } else if (data.startsWith('buy_start_')) {
      const prodId = data.replace('buy_start_', '');
      await promptQuantitySelection(chatId, messageId, userId, prodId);
    } else if (data.startsWith('buy_qty_set:')) {
      const parts = data.split(':');
      const prodId = parts[1];
      const qty = parseInt(parts[2]);
      await showDirectCheckoutSummary(chatId, userId, prodId, qty, messageId);
    } else if (data.startsWith('buy_pay_wallet:')) {
      const parts = data.split(':');
      const prodId = parts[1];
      const qty = parseInt(parts[2]);
      await processDirectWalletPayment(chatId, userId, prodId, qty);
    } else if (data.startsWith('buy_pay_binance:')) {
      const parts = data.split(':');
      const prodId = parts[1];
      const qty = parseInt(parts[2]);
      await showBinanceDirectPaymentInstructions(chatId, userId, prodId, qty);
    } else if (data.startsWith('buy_pay_bep20:')) {
      const parts = data.split(':');
      const prodId = parts[1];
      const qty = parseInt(parts[2]);
      await showBep20DirectPaymentInstructions(chatId, userId, prodId, qty);
    } else if (data === 'cancel_order' || data === 'cancel_purchase') {
      await handleCancelOrder(chatId, userId, messageId);
    } else if (data === 'nav_profile' || data === 'nav_user_profile') {
      await showUserProfile(chatId, messageId, userId);
    } else if (data === 'nav_my_balance' || data === 'nav_balance') {
      await showCustomerBalanceView(chatId, messageId, userId);
    } else if (data === 'nav_deposit_start') {
      userStates[userId] = { type: 'WAITING_DEPOSIT_AMOUNT' };
      const currentBalance = db.getUserBalance(userId);
      await bot.sendMessage(chatId, `💳 <b>ADD FUNDS TO STORE WALLET</b>\n\n` +
        `Current Balance: <b>$${currentBalance.toFixed(2)} USD</b>\n` +
        `📌 Minimum Deposit: <b>$0.01 USD</b>\n\n` +
        `Please enter the amount in USD ($) you want to deposit (e.g. 0.01, 5.00, or 10.00):`);
    } else if (data === 'nav_orders') {
      await showUserOrders(chatId, messageId, userId);
    } else if (data === 'nav_payments') {
      await showPaymentInfo(chatId, messageId, userId);
    } else if (data === 'nav_support') {
      await showSupportMenu(chatId, userId, messageId);
    } else if (data === 'human_support_ticket') {
      userStates[userId] = { type: 'WAITING_SUPPORT_TICKET_MSG' };
      await bot.sendMessage(chatId, `👤 <b>DIRECT MESSAGE TO STORE OWNER ${OWNER_HANDLE}</b>\n\n` +
        `Are you experiencing any issue with your order, payment, or stock delivery?\n\n` +
        `✍️ <i>Please type and send your issue details in chat below. Store Owner <b>${OWNER_HANDLE}</b> will receive your message and reply directly to you inside this bot chat!</i>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'nav_main' }]]
          }
        });
    } else if (data === 'nav_language' || data === 'nav_language_select') {
      await showLanguageMenu(chatId, messageId, userId);
    } else if (data.startsWith('set_lang_')) {
      const langCode = data.replace('set_lang_', '');
      db.setLanguage(userId, langCode);
      const updatedLang = getLang(langCode);
      await bot.sendMessage(chatId, `🌐 <b>${updatedLang.lang_changed}</b>`, {
        reply_markup: getMainMenuKeyboard(userId)
      });
    }
    else if (data === 'admin_dashboard') {
      if (!db.isAdmin(userId)) {
        await bot.sendMessage(chatId, '🔒 Access Denied.');
        return;
      }
      await showAdminDashboard(chatId, userId, messageId);
    } else if (data === 'admin_user_balance_menu') {
      if (!db.isAdmin(userId)) return;
      await showAdminUserBalanceMenu(chatId, messageId);
    } else if (data === 'admin_feature_toggles_menu') {
      if (!db.isAdmin(userId)) return;
      await showAdminFeatureTogglesMenu(chatId, messageId);
    } else if (data === 'admin_toggle_maintenance') {
      if (!db.isAdmin(userId)) return;
      const isOffline = db.toggleMaintenanceMode();
      const statusStr = isOffline ? '🔴 MAINTENANCE MODE (STORE OFFLINE)' : '🟢 ONLINE (STORE ACTIVE)';
      await bot.sendMessage(chatId, `<b>Store Status Changed!</b>\n\nCurrent Status: <b>${statusStr}</b>`);
      await showAdminDashboard(chatId, userId, messageId);
    } else if (data === 'admin_toggle_force_join') {
      if (!db.isAdmin(userId)) return;
      const isEnabled = db.toggleForceJoin();
      const statusStr = isEnabled ? '🟢 FORCE JOIN ACTIVE' : '🔴 FORCE JOIN DISABLED';
      await bot.sendMessage(chatId, `<b>Force Join Status Changed!</b>\n\nCurrent Status: <b>${statusStr}</b>`);
      await showAdminChannelsMenu(chatId, messageId);
    } else if (data.startsWith('admin_toggle_')) {
      if (!db.isAdmin(userId)) return;
      const featureKey = data.replace('admin_toggle_', '');
      db.toggleFeature(featureKey);
      await showAdminFeatureTogglesMenu(chatId, messageId);
    } else if (data === 'nav_membership_menu') {
      await showMembershipMenu(chatId, userId, messageId);
    } else if (data === 'admin_membership_settings_menu') {
      if (!db.isAdmin(userId)) return;
      await showAdminMembershipSettingsMenu(chatId, messageId);
    } else if (data.startsWith('admin_edit_tier_')) {
      if (!db.isAdmin(userId)) return;
      const tierKey = data.replace('admin_edit_tier_', '');
      userStates[userId] = { type: 'ADMIN_WAITING_TIER_MIN_SPENT', tierKey };
      await bot.sendMessage(chatId, `💎 <b>EDIT MEMBERSHIP TIER [${tierKey.toUpperCase()}]</b>\n\n` +
        `<i>Step 1: Enter the Minimum Total Spent ($ USD) required for this tier (e.g. <code>20</code> or <code>150</code> or <code>500</code>):</i>`, {
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_membership_settings_menu' }]] }
        });
    } else if (data === 'admin_coupons_menu') {
      if (!db.isAdmin(userId)) return;
      await showAdminCouponsMenu(chatId, messageId);
    } else if (data === 'admin_create_coupon_start') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_WAITING_COUPON_CODE' };
      await bot.sendMessage(chatId, `🎟️ <b>CREATE NEW DISCOUNT PROMO COUPON</b>\n\n` +
        `<i>Please enter the Coupon Code (e.g. <code>SUMMER20</code>, <code>SAVE10</code>, <code>WELCOME50</code>):</i>`, {
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_coupons_menu' }]] }
        });
    } else if (data.startsWith('admin_del_coupon_')) {
      if (!db.isAdmin(userId)) return;
      const code = data.replace('admin_del_coupon_', '');
      db.deleteCoupon(code);
      await showAdminCouponsMenu(chatId, messageId);
    } else if (data === 'admin_public_channel_menu') {
      if (!db.isAdmin(userId)) return;
      await showAdminPublicChannelMenu(chatId, messageId);
    } else if (data === 'admin_set_public_channel_start') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_WAITING_PUBLIC_CHANNEL_INPUT' };
      await bot.sendMessage(chatId, `📢 <b>LINK PUBLIC RESTOCK CHANNEL</b>\n\n` +
        `<i>Please reply with your Public Channel Username (e.g. <code>@RedNoxStoreAlerts</code>):</i>`, {
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_public_channel_menu' }]] }
        });
    } else if (data === 'nav_referral_menu') {
      await showReferralMenu(chatId, userId, messageId);
    } else if (data === 'nav_coupon_start') {
      userStates[userId] = { type: 'CUSTOMER_WAITING_COUPON_INPUT' };
      await bot.sendMessage(chatId, `🎟️ <b>REDEEM DISCOUNT PROMO COUPON</b>\n\n` +
        `<i>Please reply with your Promo Coupon Code (e.g. <code>SUMMER20</code>):</i>`, {
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'nav_main' }]] }
        });
    } else if (data === 'nav_search_start') {
      userStates[userId] = { type: 'CUSTOMER_WAITING_SEARCH_INPUT' };
      await bot.sendMessage(chatId, `🔍 <b>INSTANT PRODUCT SEARCH</b>\n\n` +
        `<i>Please reply with the product name or keyword (e.g. <code>Gemini</code>, <code>Canva</code>, <code>Netflix</code>, <code>Office</code>):</i>`, {
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'nav_main' }]] }
        });
    } else if (data === 'admin_add_user_balance_start') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_WAITING_ADD_BAL_USER_ID' };
      await bot.sendMessage(chatId, `➕ <b>ADD BALANCE TO CUSTOMER WALLET</b>\n\n` +
        `<i>Please reply with the customer's <b>Telegram User ID</b> or <b>@username</b>:</i>\n\n` +
        `Examples:\n` +
        `• <code>6506288872</code>\n` +
        `• <code>@Hussain_xd</code>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_dashboard' }]]
          }
        });
    } else if (data === 'admin_deduct_user_balance_start') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_WAITING_DEDUCT_BAL_USER_ID' };
      await bot.sendMessage(chatId, `➖ <b>DEDUCT / TAKE BACK BALANCE FROM CUSTOMER</b>\n\n` +
        `<i>Please reply with the customer's <b>Telegram User ID</b> or <b>@username</b> from whom you want to deduct balance:</i>\n\n` +
        `Examples:\n` +
        `• <code>6506288872</code>\n` +
        `• <code>@Hussain_xd</code>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_dashboard' }]]
          }
        });
    } else if (data === 'admin_create_gift_link') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_CREATE_GIFT_LINK_INPUT' };
      await bot.sendMessage(chatId, `🎁 <b>CREATE GIFT CREDIT DEPOSIT LINK</b>\n\n` +
        `<i>Please enter the Credit Amount in <b>$ USD</b> you want to generate a gift link for:</i>\n\n` +
        `Examples:\n` +
        `• <code>50</code> ($50 USD)\n` +
        `• <code>100</code> ($100 USD)\n` +
        `• <code>250</code> ($250 USD)\n\n` +
        `<i>Enter amount in chat now:</i>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_dashboard' }]]
          }
        });
    } else if (data === 'admin_rename_buttons_menu') {
      if (!db.isAdmin(userId)) return;
      await showAdminButtonRenameMenu(chatId, messageId);
    } else if (data.startsWith('admin_rename_btn_')) {
      if (!db.isAdmin(userId)) return;
      const btnKey = data.replace('admin_rename_btn_', '');
      userStates[userId] = { type: 'ADMIN_WAITING_BUTTON_LABEL_INPUT', btnKey };
      await bot.sendMessage(chatId, `✍️ <b>RENAME MENU BUTTON LABEL</b>\n\n` +
        `Please reply with your new custom button text & emoji in chat:\n\n` +
        `<i>Examples:</i>\n` +
        `• <code>🛍️ Products Catalog</code>\n` +
        `• <code>💳 My Balance & Wallet</code>\n` +
        `• <code>🔍 Search Products</code>\n` +
        `• <code>💎 VIP Tier Perks</code>`, {
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_rename_buttons_menu' }]] }
        });
    } else if (data === 'admin_reset_btn_labels') {
      if (!db.isAdmin(userId)) return;
      db.resetCustomButtonLabels();
      await bot.sendMessage(chatId, `✅ <b>All Main Menu Buttons reset to original default labels!</b>`);
      await showAdminButtonRenameMenu(chatId, messageId);
    } else if (data === 'admin_prodseller_menu') {
      if (!db.isAdmin(userId)) return;
      await showAdminProdSellerMenu(chatId, messageId);
    } else if (data === 'admin_set_prodseller_key') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_SET_PRODSELLER_KEY_INPUT' };
      await bot.sendMessage(chatId, `🔑 <b>SET PRODSELLER API KEY</b>\n\n` +
        `<i>Please send your ProdSeller API Key below (starts with <code>psk_...</code>):</i>\n\n` +
        `Example:\n<code>psk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</code>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_prodseller_menu' }]]
          }
        });
    } else if (data === 'admin_set_seller_deposit') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_SET_SELLER_DEPOSIT_INPUT' };
      const currentTarget = db.getSellerDepositAddress() || '❌ Not Set';
      await bot.sendMessage(chatId, `⚡ <b>SET SELLER BOT DEPOSIT TARGET</b>\n\n` +
        `Current Destination: <code>${currentTarget}</code>\n\n` +
        `<i>Please send the Seller Bot's Binance Pay ID or USDT BEP20 (BSC) Deposit Address below:</i>\n\n` +
        `Example (Binance Pay ID): <code>123456789</code>\n` +
        `Example (BEP20 Address): <code>0x4a3b8c9d...</code>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_prodseller_menu' }]]
          }
        });
    } else if (data === 'admin_prodseller_import') {
      if (!db.isAdmin(userId)) return;
      const res = await prodseller.getProducts();
      if (!res.ok) {
        await bot.sendMessage(chatId, `❌ <b>Failed to fetch ProdSeller products:</b>\n<code>${res.error}</code>`);
        return;
      }
      const products = res.products || [];
      if (products.length === 0) {
        await bot.sendMessage(chatId, `📦 <b>No products returned from ProdSeller API.</b>`);
        return;
      }

      let text = `📦 <b>PRODSELLER AVAILABLE SUPPLIER PRODUCTS (${products.length})</b>\n\n`;
      products.forEach((p, idx) => {
        text += `${idx + 1}. <b>${p.name}</b>\n` +
          `   • Supplier Cost: <b>$${p.price.toFixed(2)} USD</b> (Public: $${p.publicPrice ? p.publicPrice.toFixed(2) : p.price.toFixed(2)})\n` +
          `   • Status: ${p.inStock ? '✅ In Stock' : '❌ Out of Stock'} (${p.sold || 0} sold)\n` +
          `   • Product ID: <code>${p.id}</code>\n\n`;
      });

      text += `<i>You can create a product in your bot using these supplier Product IDs for automated key delivery!</i>`;

      await bot.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 ProdSeller Manager', callback_data: 'admin_prodseller_menu' }]]
        }
      });
    } else if (data === 'admin_prodseller_do_import') {
      if (!db.isAdmin(userId)) return;
      await bot.sendMessage(chatId, `⏳ <b>Fetching & Importing products from ProdSeller API...</b> Please wait!`);
      const res = await prodseller.getProducts();
      if (!res.ok || !Array.isArray(res.products)) {
        await bot.sendMessage(chatId, `❌ <b>Import Failed:</b>\n<code>${res.error || 'Failed to fetch products'}</code>`);
        return;
      }
      const importStats = db.importProdSellerProducts(res.products, 20);
      await bot.sendMessage(chatId, `✅ <b>1-CLICK AUTO-IMPORT COMPLETED!</b> 🎉\n\n` +
        `📥 <b>New Products Added:</b> <b>${importStats.importedCount}</b>\n` +
        `🔄 <b>Existing Products Updated:</b> <b>${importStats.updatedCount}</b>\n` +
        `📦 <b>Total Store Products:</b> <b>${importStats.totalProducts}</b>\n\n` +
        `<i>All ${res.products.length} supplier products are now active in your store catalog for instant purchase!</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🛍️ View Customer Store Catalog', callback_data: 'nav_categories' }],
              [{ text: '🔙 ProdSeller Manager', callback_data: 'admin_prodseller_menu' }]
            ]
          }
        });
    } else if (data === 'admin_set_welcome_photo') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_WAITING_WELCOME_PHOTO' };
      await bot.sendMessage(chatId, `🖼️ <b>UPDATE WELCOME BANNER PHOTO</b>\n\n` +
        `<i>Please send a new photo or photo link in chat below to update the bot's welcome banner image!</i>\n\n` +
        `📌 <b>Instructions:</b>\n` +
        `• You can send a photo attachment directly in this chat\n` +
        `• Or send an image URL link (e.g. <code>https://.../image.png</code>)\n\n` +
        `<i>Send photo now:</i>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_dashboard' }]]
          }
        });
    } else if (data === 'admin_manage_channels') {
      if (!db.isAdmin(userId)) return;
      await showAdminChannelsMenu(chatId, messageId);
    } else if (data === 'admin_add_channel') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_ADD_CHANNEL_INPUT' };
      await bot.sendMessage(chatId, `📢 <b>ADD REQUIRED TELEGRAM CHANNEL</b>\n\n` +
        `Please send your Telegram Channel username or link below.\n\n` +
        `Examples:\n` +
        `• <code>@Hussain_xd_channel</code>\n` +
        `• <code>https://t.me/Hussain_xd_channel</code>\n\n` +
        `<i>Make sure to add this bot as an Admin in your channel so it can verify user memberships!</i>`);
    } else if (data === 'admin_do_confirm_add_chan') {
      if (!db.isAdmin(userId)) return;
      const state = userStates[userId];
      if (!state || state.type !== 'ADMIN_CONFIRM_ADD_CHANNEL') return;
      const chanObj = db.addRequiredChannel(state.channelInput);
      userStates[userId] = null;
      if (chanObj) {
        await bot.sendMessage(chatId, `✅ <b>Telegram Channel Added Successfully!</b>\n\n` +
          `📢 <b>Channel Name:</b> ${chanObj.name}\n` +
          `🆔 <b>Username:</b> ${chanObj.username}\n` +
          `🔗 <b>Link:</b> ${chanObj.link}\n\n` +
          `<i>Users must join this channel before using the bot!</i>`, {
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Force Join Channel Settings', callback_data: 'admin_manage_channels' }]]
            }
          });
      } else {
        await bot.sendMessage(chatId, '❌ Invalid channel username or link. Please try again.');
      }
    } else if (data.startsWith('admin_del_chan_')) {
      if (!db.isAdmin(userId)) return;
      const chanId = data.replace('admin_del_chan_', '');
      const channels = db.getRequiredChannels();
      const chan = channels.find(c => c.id === chanId);
      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: DELETE REQUIRED CHANNEL</b>\n\n` +
        `📢 <b>Channel:</b> <b>${chan ? chan.name : 'Channel'}</b>\n\n` +
        `❓ <i>Are you sure you want to remove this channel from Force Join?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🗑️ ✅ Yes, Approve & Delete', callback_data: `admin_do_confirm_del_chan_${chanId}` }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_manage_channels' }]
            ]
          }
        });
    } else if (data.startsWith('admin_do_confirm_del_chan_')) {
      if (!db.isAdmin(userId)) return;
      const chanId = data.replace('admin_do_confirm_del_chan_', '');
      db.deleteRequiredChannel(chanId);
      await bot.sendMessage(chatId, `✅ Channel removed from required list.`);
      await showAdminChannelsMenu(chatId, messageId);
    } else if (data.startsWith('admin_reply_ticket:')) {
      if (!db.isAdmin(userId)) return;
      const ticketId = data.split(':')[1];
      const ticket = db.getSupportTicket(ticketId);
      if (!ticket) {
        await bot.sendMessage(chatId, '❌ Ticket not found.');
        return;
      }
      userStates[userId] = { type: 'ADMIN_REPLY_TICKET_INPUT', ticketId };
      await bot.sendMessage(chatId, `💬 <b>REPLY TO CUSTOMER TICKET #${ticket.id}</b>\n\n` +
        `👤 <b>Customer:</b> @${ticket.username} (ID: <code>${ticket.userId}</code>)\n` +
        `📝 <b>Issue:</b> <i>"${ticket.issueText}"</i>\n\n` +
        `<i>Please type your response message to this customer below:</i>`);
    } else if (data === 'admin_sales_analytics') {
      if (!db.isAdmin(userId)) return;
      await showAdminSalesAnalytics(chatId, messageId);
    } else if (data === 'admin_manage_sections') {
      if (!db.isAdmin(userId)) return;
      await showAdminSectionMenu(chatId, messageId);
    } else if (data === 'admin_add_section') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_ADD_SECTION_NAME' };
      await bot.sendMessage(chatId, '📁 <b>Create New Section / Category</b>\n\nEnter Section Name (e.g. <code>☁️ Gemini Pro Accounts</code>):');
    } else if (data === 'admin_do_confirm_add_sec') {
      if (!db.isAdmin(userId)) return;
      const state = userStates[userId];
      if (!state || state.type !== 'ADMIN_CONFIRM_ADD_SECTION') return;
      const cat = db.addCategory(state.sectionName, '📁');
      userStates[userId] = null;
      await bot.sendMessage(chatId, `✅ <b>New Section Created!</b>\n\n📁 <b>Section Name:</b> ${cat.name}`, {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
        }
      });
    } else if (data.startsWith('admin_del_section_')) {
      if (!db.isAdmin(userId)) return;
      const catId = data.replace('admin_del_section_', '');
      const cat = db.getCategories().find(c => c.id === catId);
      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: DELETE SECTION FOLDER</b>\n\n` +
        `📁 <b>Section:</b> <b>${cat ? cat.name : 'Section'}</b>\n\n` +
        `⚠️ <i>Are you sure you want to delete this folder and all products inside it?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🗑️ ✅ Yes, Approve & Delete Folder', callback_data: `admin_do_confirm_del_sec_${catId}` }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_manage_sections' }]
            ]
          }
        });
    } else if (data.startsWith('admin_do_confirm_del_sec_')) {
      if (!db.isAdmin(userId)) return;
      const catId = data.replace('admin_do_confirm_del_sec_', '');
      db.deleteCategory(catId);
      await bot.sendMessage(chatId, `✅ Section folder deleted.`);
      await showAdminSectionMenu(chatId, messageId);
    } else if (data.startsWith('admin_extract_section_')) {
      if (!db.isAdmin(userId)) return;
      const catId = data.replace('admin_extract_section_', '');
      const cat = db.getCategories().find(c => c.id === catId);
      const count = db.getProducts(catId).length;
      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: EXTRACT PRODUCTS & DELETE FOLDER</b>\n\n` +
        `📁 <b>Section:</b> <b>${cat ? cat.name : 'Section'}</b> (${count} Products)\n\n` +
        `<i>All ${count} products will be moved to the Main Store Catalog, and this folder will be deleted.</i>\n\n` +
        `❓ <i>Are you sure you want to proceed?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📤 ✅ Yes, Approve & Extract', callback_data: `admin_do_confirm_extract_sec_${catId}` }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_manage_sections' }]
            ]
          }
        });
    } else if (data.startsWith('admin_do_confirm_extract_sec_')) {
      if (!db.isAdmin(userId)) return;
      const catId = data.replace('admin_do_confirm_extract_sec_', '');
      const cat = db.getCategories().find(c => c.id === catId);
      const catName = cat ? cat.name : 'Folder';
      const result = db.extractProductsAndDeleteCategory(catId);
      await bot.sendMessage(chatId, `✅ <b>PRODUCTS EXTRACTED & FOLDER DELETED!</b> 🎉\n\n` +
        `📁 Section folder <b>${catName}</b> has been deleted.\n` +
        `📦 Total <b>${result.extractedCount} Products</b> automatically extracted out to Main Store Catalog!`);
      await showAdminSectionMenu(chatId, messageId);
    } else if (data === 'admin_add_prod_start') {
      if (!db.isAdmin(userId)) return;
      await showAdminSelectSectionForNewProduct(chatId, messageId);
    } else if (data.startsWith('admin_prod_sec_select_')) {
      if (!db.isAdmin(userId)) return;
      const catId = data.replace('admin_prod_sec_select_', '');
      userStates[userId] = { type: 'ADMIN_ADD_PRODUCT_NAME', productData: { categoryId: catId } };
      await bot.sendMessage(chatId, '📦 <b>Add New Product</b>\n\nPlease enter the Product Name:');
    } else if (data === 'admin_do_confirm_add_prod') {
      if (!db.isAdmin(userId)) return;
      const state = userStates[userId];
      if (!state || state.type !== 'ADMIN_CONFIRM_ADD_PRODUCT') return;
      const newProd = db.addProduct(state.productData);
      const addedQty = newProd.stock;
      userStates[userId] = null;

      await bot.sendMessage(chatId, `✅ <b>Product Created & Stock Loaded!</b>\n\n` +
        `📦 <b>Name:</b> ${newProd.name}\n` +
        `➕ <b>Keys Imported:</b> ${addedQty}\n` +
        `💰 <b>Unit Price:</b> $${newProd.price.toFixed(2)}\n\n` +
        `📢 <i>Sending automated restock broadcast to all users...</i>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
          }
        });

      await broadcastRestockNotification(newProd.name, addedQty, newProd.stock, newProd.price);
    } else if (data === 'admin_restock_list') {
      if (!db.isAdmin(userId)) return;
      await showAdminRestockProductList(chatId, messageId);
    } else if (data.startsWith('admin_restock_prod_')) {
      if (!db.isAdmin(userId)) return;
      const prodId = data.replace('admin_restock_prod_', '');
      const prod = db.getProduct(prodId);
      userStates[userId] = { type: 'ADMIN_RESTOCK_INPUT', productId: prodId };
      await bot.sendMessage(chatId, `📁 <b>Upload Stock File for ${prod ? prod.name : 'Product'}</b>\n\n` +
        `Current Stock: <b>${prod ? prod.stock : 0}</b>\n\n` +
        `📄 Send a <b>.txt document file</b> containing keys/links (one per line) or paste text lines into chat:`);
    } else if (data === 'admin_do_confirm_restock_num') {
      if (!db.isAdmin(userId)) return;
      const state = userStates[userId];
      if (!state || state.type !== 'ADMIN_CONFIRM_RESTOCK_NUM') return;
      const result = db.addStock(state.productId, state.restockQty);
      userStates[userId] = null;
      if (result) {
        await bot.sendMessage(chatId, `✅ <b>Stock Updated!</b>\n\n` +
          `📦 <b>Product:</b> ${result.product.name}\n` +
          `➕ <b>Added:</b> ${result.addedQty}\n` +
          `📦 <b>Current Stock:</b> ${result.currentStock}\n` +
          `💵 <b>Unit Price:</b> $${result.product.price.toFixed(2)}\n\n` +
          `📢 <i>Sending automated restock broadcast to all users...</i>`, {
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
            }
          });
        await broadcastRestockNotification(result.product.name, result.addedQty, result.currentStock, result.product.price);
      }
    } else if (data === 'admin_do_confirm_restock_keys') {
      if (!db.isAdmin(userId)) return;
      const state = userStates[userId];
      if (!state || state.type !== 'ADMIN_CONFIRM_RESTOCK_KEYS') return;
      const result = db.addStockKeys(state.productId, state.keyLines);
      userStates[userId] = null;
      if (result) {
        await bot.sendMessage(chatId, `✅ <b>Stock Keys Imported & Updated!</b>\n\n` +
          `📦 <b>Product:</b> ${result.product.name}\n` +
          `➕ <b>Keys Imported:</b> ${result.addedQty}\n` +
          `📦 <b>Current Stock:</b> ${result.currentStock}\n` +
          `💵 <b>Unit Price:</b> $${result.product.price.toFixed(2)}\n\n` +
          `📢 <i>Sending automated restock broadcast to all users...</i>`, {
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
            }
          });
        await broadcastRestockNotification(result.product.name, result.addedQty, result.currentStock, result.product.price);
      }
    } else if (data === 'admin_manage_prods') {
      if (!db.isAdmin(userId)) return;
      await showAdminManageProducts(chatId, messageId);
    } else if (data.startsWith('admin_reduce_stock_prod_')) {
      if (!db.isAdmin(userId)) return;
      const prodId = data.replace('admin_reduce_stock_prod_', '');
      const prod = db.getProduct(prodId);
      if (!prod) return;

      userStates[userId] = { type: 'ADMIN_REDUCE_STOCK_INPUT', productId: prodId };
      await bot.sendMessage(chatId, `➖ <b>DEDUCT / REMOVE STOCK QUANTITY</b>\n\n` +
        `📦 Product: <b>${prod.name}</b>\n` +
        `📊 Current Stock: <b>${prod.stock} Units</b>\n\n` +
        `Please enter how many units of stock you want to deduct/remove (e.g. 200 or 250):\n` +
        `<i>The bot will export and send all deducted keys back to you in a downloadable .txt file!</i>`);
    } else if (data === 'admin_do_confirm_reduce_stock') {
      if (!db.isAdmin(userId)) return;
      const state = userStates[userId];
      if (!state || state.type !== 'ADMIN_CONFIRM_REDUCE_STOCK') return;
      const result = db.reduceStock(state.productId, state.reduceQty);
      userStates[userId] = null;

      if (result) {
        let exportContent = `==================================================\n`;
        exportContent += `🎁 REDNOX STORE - DEDUCTED / EXPORTED STOCK KEYS\n`;
        exportContent += `==================================================\n`;
        exportContent += `Product Name: ${result.product.name}\n`;
        exportContent += `Deducted Quantity: ${result.deductedQty} Units\n`;
        exportContent += `New Remaining Stock: ${result.currentStock} Units\n`;
        exportContent += `Date Exported: ${new Date().toLocaleString()}\n`;
        exportContent += `--------------------------------------------------\n`;
        exportContent += `REMOVED KEYS / ACCOUNTS:\n`;
        exportContent += `--------------------------------------------------\n\n`;

        result.deductedKeys.forEach((k, idx) => {
          exportContent += `${idx + 1}. ${k}\n`;
        });

        exportContent += `\n==================================================\n`;

        const cleanProdName = result.product.name.replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `Deducted_Stock_${cleanProdName}_${result.deductedQty}_Keys.txt`;
        const fileBuffer = Buffer.from(exportContent, 'utf8');

        const summaryText = `✅ <b>STOCK DEDUCTED & RETURNED TO ADMIN!</b>\n\n` +
          `📦 <b>Product:</b> ${result.product.name}\n` +
          `➖ <b>Deducted Quantity:</b> ${result.deductedQty} Units\n` +
          `📦 <b>New Remaining Stock:</b> <b>${result.currentStock} Units</b>\n\n` +
          `📄 <i>All ${result.deductedQty} deducted keys have been exported into the attached .txt file below and returned back to you!</i>`;

        await bot.sendDocument(chatId, fileBuffer, fileName, {
          caption: summaryText,
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
          }
        });
      }
    } else if (data.startsWith('admin_edit_price_')) {
      if (!db.isAdmin(userId)) return;
      const prodId = data.replace('admin_edit_price_', '');
      const prod = db.getProduct(prodId);
      userStates[userId] = { type: 'ADMIN_EDIT_PRICE', productId: prodId };
      const wholesaleStr = (prod && prod.wholesaleCost) ? `\n🏭 Wholesale Reseller Cost: <b>$${prod.wholesaleCost.toFixed(2)} USD</b>` : '';
      await bot.sendMessage(chatId, `💰 <b>EDIT RETAIL SELLING PRICE</b>\n\n` +
        `📦 Product: <b>${prod ? prod.name : 'Product'}</b>${wholesaleStr}\n` +
        `💵 Current Customer Price: <b>$${prod ? prod.price.toFixed(2) : 0} USD</b>\n\n` +
        `<i>Please reply with your custom retail Selling Price in $ USD (e.g. 0.80, 1.00, 1.50):</i>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_manage_prods' }]]
          }
        });
    } else if (data === 'admin_do_confirm_edit_price') {
      if (!db.isAdmin(userId)) return;
      const state = userStates[userId];
      if (!state || state.type !== 'ADMIN_CONFIRM_EDIT_PRICE') return;
      const updatedProd = db.updateProductPrice(state.productId, state.newPrice);
      userStates[userId] = null;
      if (updatedProd) {
        const wholesaleStr = updatedProd.wholesaleCost ? `\n🏭 Wholesale Reseller Cost: <b>$${updatedProd.wholesaleCost.toFixed(2)} USD</b>` : '';
        const profit = updatedProd.wholesaleCost ? (updatedProd.price - updatedProd.wholesaleCost) : 0;
        const profitStr = updatedProd.wholesaleCost ? `\n📈 <b>Your Profit Margin per sale:</b> <b>+$${profit.toFixed(2)} USD</b>` : '';

        await bot.sendMessage(chatId, `✅ <b>RETAIL SELLING PRICE UPDATED!</b> 🎉\n\n` +
          `📦 Product: <b>${updatedProd.name}</b>${wholesaleStr}\n` +
          `💵 New Retail Selling Price: <b>$${updatedProd.price.toFixed(2)} USD</b>${profitStr}\n\n` +
          `✨ <i>All customers will now see $${updatedProd.price.toFixed(2)} USD when browsing or buying this product!</i>`, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '⚙️ Change Another Product Price', callback_data: 'admin_manage_prods' }],
                [{ text: '👑 Admin Dashboard', callback_data: 'admin_dashboard' }]
              ]
            }
          });
      }
    } else if (data === 'admin_do_confirm_add_bal') {
      if (!db.isAdmin(userId)) return;
      const state = userStates[userId];
      if (!state || state.type !== 'ADMIN_CONFIRM_ADD_BAL') return;
      const updatedBal = db.addBalance(state.targetUid, state.amountUsd);
      const targetUser = state.targetUser;
      const targetUid = state.targetUid;
      const amountUsd = state.amountUsd;
      userStates[userId] = null;

      await bot.sendMessage(chatId, `✅ <b>BALANCE ADDED SUCCESSFULLY!</b> 🎉\n\n` +
        `👤 <b>Customer:</b> ${targetUser.firstName} ${targetUser.username ? '(@' + targetUser.username + ')' : ''} (ID: <code>${targetUid}</code>)\n` +
        `➕ <b>Added Amount:</b> <code>+$${amountUsd.toFixed(2)} USD</code>\n` +
        `💳 <b>New Wallet Balance:</b> <b>$${updatedBal.toFixed(2)} USD</b>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
          }
        });

      try {
        await bot.sendMessage(targetUid, `🎉 <b>WALLET BALANCE CREDIT NOTICE!</b> 💰\n\n` +
          `➕ <b>Added Balance:</b> <code>+$${amountUsd.toFixed(2)} USD</code>\n` +
          `💳 <b>New Wallet Balance:</b> <code>$${updatedBal.toFixed(2)} USD</code>\n\n` +
          `✨ <i>Your wallet balance has been updated by store admin! You can now browse products and buy items.</i>`);
      } catch (e) {}
    } else if (data === 'admin_do_confirm_deduct_bal') {
      if (!db.isAdmin(userId)) return;
      const state = userStates[userId];
      if (!state || state.type !== 'ADMIN_CONFIRM_DEDUCT_BAL') return;
      const updatedBal = db.deductBalance(state.targetUid, state.amountUsd);
      const targetUser = state.targetUser;
      const targetUid = state.targetUid;
      const amountUsd = state.amountUsd;
      userStates[userId] = null;

      await bot.sendMessage(chatId, `✅ <b>BALANCE DEDUCTED / REMOVED SUCCESSFULLY!</b> 🔴\n\n` +
        `👤 <b>Customer:</b> ${targetUser.firstName} ${targetUser.username ? '(@' + targetUser.username + ')' : ''} (ID: <code>${targetUid}</code>)\n` +
        `➖ <b>Deducted Amount:</b> <code>-$${amountUsd.toFixed(2)} USD</code>\n` +
        `💳 <b>New Wallet Balance:</b> <b>$${updatedBal.toFixed(2)} USD</b>`, {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
          }
        });

      try {
        await bot.sendMessage(targetUid, `💳 <b>WALLET BALANCE ADJUSTMENT NOTICE</b>\n\n` +
          `➖ <b>Deducted Amount:</b> <code>-$${amountUsd.toFixed(2)} USD</code>\n` +
          `💳 <b>Updated Wallet Balance:</b> <code>$${updatedBal.toFixed(2)} USD</code>\n\n` +
          `<i>Your wallet balance was adjusted by store administrator. Contact ${OWNER_HANDLE} if you have any questions.</i>`);
      } catch (e) {}
    } else if (data.startsWith('admin_clear_stock_')) {
      if (!db.isAdmin(userId)) return;
      const prodId = data.replace('admin_clear_stock_', '');
      const prod = db.getProduct(prodId);
      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: CLEAR ALL STOCK (OUT OF STOCK)</b>\n\n` +
        `📦 <b>Product:</b> <b>${prod ? prod.name : 'Product'}</b>\n` +
        `📊 <b>Current Stock:</b> <b>${prod ? prod.stock : 0} Units</b>\n\n` +
        `⚠️ <b>WARNING:</b> This will remove ALL stock keys and set stock to 0 (Out of Stock).\n\n` +
        `❓ <i>Are you sure you want to approve and clear all stock?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔴 ✅ Yes, Approve & Clear Stock', callback_data: `admin_do_confirm_clear_stock_${prodId}` }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_manage_prods' }]
            ]
          }
        });
    } else if (data.startsWith('admin_do_confirm_clear_stock_')) {
      if (!db.isAdmin(userId)) return;
      const prodId = data.replace('admin_do_confirm_clear_stock_', '');
      const cleared = db.clearProductStock(prodId);
      if (cleared) {
        let exportContent = `==================================================\n`;
        exportContent += `🎁 REDNOX STORE - CLEARED / EXPORTED STOCK KEYS\n`;
        exportContent += `==================================================\n`;
        exportContent += `Product Name: ${cleared.name}\n`;
        exportContent += `Total Cleared Keys: ${cleared.deductedKeys.length} Units\n`;
        exportContent += `Date Exported: ${new Date().toLocaleString()}\n`;
        exportContent += `--------------------------------------------------\n`;
        exportContent += `CLEARED KEYS / ACCOUNTS:\n`;
        exportContent += `--------------------------------------------------\n\n`;

        cleared.deductedKeys.forEach((k, idx) => {
          exportContent += `${idx + 1}. ${k}\n`;
        });

        exportContent += `\n==================================================\n`;

        const cleanProdName = (cleared.name || 'Product').replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `Cleared_Stock_${cleanProdName}_${cleared.deductedKeys.length}_Keys.txt`;
        const fileBuffer = Buffer.from(exportContent, 'utf8');

        const summaryText = `🔴 <b>ALL STOCK CLEARED & EXPORTED TO ADMIN!</b>\n\n` +
          `📦 <b>Product:</b> ${cleared.name}\n` +
          `🔴 <b>Cleared Keys:</b> ${cleared.deductedKeys.length} Units\n` +
          `📦 <b>New Stock Level:</b> <b>0 Units (Out of Stock)</b>\n\n` +
          `📄 <i>All ${cleared.deductedKeys.length} removed keys have been exported into the attached .txt file below and returned to you!</i>`;

        await bot.sendDocument(chatId, fileBuffer, fileName, {
          caption: summaryText,
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
          }
        });
      }
    } else if (data.startsWith('admin_del_prod_')) {
      if (!db.isAdmin(userId)) return;
      const prodId = data.replace('admin_del_prod_', '');
      const prod = db.getProduct(prodId);
      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: DELETE PRODUCT</b>\n\n` +
        `📦 <b>Product:</b> <b>${prod ? prod.name : 'Product'}</b>\n` +
        `💰 <b>Price:</b> <b>$${prod ? prod.price.toFixed(2) : 0} USD</b>\n` +
        `📊 <b>Remaining Stock:</b> <b>${prod ? prod.stock : 0} Units</b>\n\n` +
        `⚠️ <b>WARNING:</b> This will permanently delete this product from your store!\n\n` +
        `❓ <i>Are you sure you want to approve and delete this product?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🗑️ ✅ Yes, Approve & Delete Product', callback_data: `admin_do_confirm_del_prod_${prodId}` }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_manage_prods' }]
            ]
          }
        });
    } else if (data.startsWith('admin_do_confirm_del_prod_')) {
      if (!db.isAdmin(userId)) return;
      const prodId = data.replace('admin_do_confirm_del_prod_', '');
      const deletedInfo = db.deleteProduct(prodId);
      if (deletedInfo) {
        if (deletedInfo.remainingKeys && deletedInfo.remainingKeys.length > 0) {
          let exportContent = `==================================================\n`;
          exportContent += `🎁 REDNOX STORE - DELETED PRODUCT STOCK KEYS EXPORT\n`;
          exportContent += `==================================================\n`;
          exportContent += `Product Name: ${deletedInfo.product.name}\n`;
          exportContent += `Total Returned Keys: ${deletedInfo.remainingKeys.length} Units\n`;
          exportContent += `Date Exported: ${new Date().toLocaleString()}\n`;
          exportContent += `--------------------------------------------------\n`;
          exportContent += `RETURNED KEYS / ACCOUNTS:\n`;
          exportContent += `--------------------------------------------------\n\n`;

          deletedInfo.remainingKeys.forEach((k, idx) => {
            exportContent += `${idx + 1}. ${k}\n`;
          });

          exportContent += `\n==================================================\n`;

          const cleanProdName = (deletedInfo.product.name || 'Product').replace(/[^a-zA-Z0-9]/g, '_');
          const fileName = `Deleted_Product_${cleanProdName}_${deletedInfo.remainingKeys.length}_Keys.txt`;
          const fileBuffer = Buffer.from(exportContent, 'utf8');

          const summaryText = `🗑️ <b>PRODUCT DELETED & REMAINING STOCK RETURNED TO ADMIN!</b>\n\n` +
            `📦 <b>Deleted Product:</b> ${deletedInfo.product.name}\n` +
            `📦 <b>Returned Keys:</b> <b>${deletedInfo.remainingKeys.length} Units</b>\n\n` +
            `📄 <i>All ${deletedInfo.remainingKeys.length} remaining keys have been exported into the attached .txt file below and returned back to you!</i>`;

          await bot.sendDocument(chatId, fileBuffer, fileName, {
            caption: summaryText,
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]]
            }
          });
        } else {
          await bot.sendMessage(chatId, `🗑️ Product <b>${deletedInfo.product.name}</b> deleted successfully.`);
        }
      }
      await showAdminManageProducts(chatId, messageId);
    } else if (data === 'admin_prodseller_resync_all') {
      if (!db.isAdmin(userId)) return;
      await bot.sendMessage(chatId, `⚠️ <b>CONFIRM ACTION: RESTORE & SYNC ALL SUPPLIER PRODUCTS</b>\n\n` +
        `🔄 <b>ProdSeller Live Synchronization:</b>\n` +
        `• Re-imports any missing or deleted supplier products.\n` +
        `• Restores all stock counts to match the live supplier board 100%.\n\n` +
        `❓ <i>Are you sure you want to approve and execute full supplier sync?</i>`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 ✅ Yes, Approve & Restore All Products', callback_data: 'admin_do_confirm_prodseller_resync' }],
              [{ text: '❌ Cancel / Abort', callback_data: 'admin_prodseller_menu' }]
            ]
          }
        });
    } else if (data === 'admin_do_confirm_prodseller_resync') {
      if (!db.isAdmin(userId)) return;
      await resyncAndRestoreSupplierCatalog(chatId, userId);
    } else if (data === 'admin_broadcast') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_BROADCAST' };
      await bot.sendMessage(chatId, '📢 <b>Broadcast Announcement</b>\n\nSend the message text you wish to broadcast to all store users:');
    } else if (data === 'admin_edit_payments') {
      if (!db.isAdmin(userId)) return;
      await showAdminEditPaymentsMenu(chatId, messageId);
    } else if (data === 'admin_set_binance_api') {
      if (!db.isAdmin(userId)) return;
      userStates[userId] = { type: 'ADMIN_SET_BINANCE_KEY' };
      await bot.sendMessage(chatId, '🔑 <b>Configure Binance Pay API</b>\n\nPlease enter your Binance Pay API Key:');
    } else if (data.startsWith('admin_set_pay_')) {
      if (!db.isAdmin(userId)) return;
      const methodKey = data.replace('admin_set_pay_', '');
      userStates[userId] = { type: 'ADMIN_EDIT_PAYMENT', methodKey };
      await bot.sendMessage(chatId, `✏️ <b>Edit Payment Info for <code>${methodKey}</code></b>\n\nPlease enter the new account details or wallet address:`);
    }
  } catch (err) {
    console.error('Error in handleCallbackQuery:', err);
  } finally {
    activeUserLocks.delete(lockKey);
  }
}

const PLAN_GROUPS = [
  {
    key: 'claude',
    title: '🧠 Claude AI Plans',
    description: 'Official Claude AI API Keys & Accounts (1 Day, 2 Days, 30 Days)',
    match: p => (p.name || '').toLowerCase().includes('claude')
  },
  {
    key: 'codex',
    title: '💻 ChatGPT & Codex Plans',
    description: 'ChatGPT Codex High-Speed Tokens & API Keys (1 Day, 2 Days, 3 Days)',
    match: p => {
      const l = (p.name || '').toLowerCase();
      return l.includes('codex') || l.includes('chatgpt');
    }
  },
  {
    key: 'capcut',
    title: '🎬 CapCut Plans',
    description: 'CapCut Pro Official Subscriptions & Credits',
    match: p => (p.name || '').toLowerCase().includes('capcut')
  },
  {
    key: 'canva',
    title: '🎨 Canva Plans',
    description: 'Canva Pro Subscriptions & Admin Invites',
    match: p => (p.name || '').toLowerCase().includes('canva')
  },
  {
    key: 'gmail',
    title: '✉️ Gmail & Email Plans',
    description: 'Aged & Fresh Gmail, Outlook, Hotmail & iCloud Accounts',
    match: p => {
      const l = (p.name || '').toLowerCase();
      return l.includes('gmail') || l.includes('mail') || l.includes('outlook') || l.includes('hotmail') || l.includes('icloud');
    }
  }
];

async function showCategories(chatId, messageId, userId) {
  const userLangCode = db.getLanguage(userId);
  const userLang = getLang(userLangCode);
  const categories = db.getCategories();
  const allProducts = db.getProducts();

  if (categories.length === 0) {
    if (allProducts.length === 0) {
      const emptyText = `📁 No products available yet. Store owner is preparing stock!`;
      if (messageId) {
        await bot.editMessageText(chatId, messageId, emptyText, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'nav_main' }]] }
        });
      } else {
        await bot.sendMessage(chatId, emptyText, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'nav_main' }]] }
        });
      }
      return;
    }

    const keyboard = [];

    // 1. Featured Plan Boxes (Full-width buttons at the top)
    PLAN_GROUPS.forEach(g => {
      const prods = allProducts.filter(g.match);
      if (prods.length > 0) {
        const inStock = prods.some(p => p.stock > 0);
        const icon = inStock ? '🟢' : '🔴';
        keyboard.push([{
          text: `${icon} ${g.title} (${prods.length} Plans)`,
          callback_data: `prod_group_${g.key}`
        }]);
      }
    });

    // 2. Direct Standalone Single Products (Two neat columns below the plan boxes)
    const standaloneProds = allProducts.filter(p => !PLAN_GROUPS.some(g => g.match(p)));
    if (standaloneProds.length > 0) {
      const prodButtons = standaloneProds.map(prod => {
        const stockInfo = getProdStockDisplay(prod);
        return { text: `${stockInfo.icon} ${prod.name}`, callback_data: `prod_view_${prod.id}` };
      });
      const twoColRows = formatTwoColumnKeyboard(prodButtons);
      twoColRows.forEach(row => keyboard.push(row));
    }

    keyboard.push([{ text: '🔙 Main Menu', callback_data: 'nav_main' }]);

    const text = `🛒 <b>REDNOX PRODUCTS CATALOG</b>\n\n` +
      `📦 <b>Choose a Plan Box below for multi-day plans, or select any product directly:</b>\n\n` +
      `🟢 = In Stock | 🔴 = Out of Stock`;

    if (messageId) {
      try {
        const editRes = await bot.editMessageText(chatId, messageId, text, {
          reply_markup: { inline_keyboard: keyboard }
        });
        if (editRes && editRes.ok) return;
      } catch (e) {}
    }

    await bot.sendMessage(chatId, text, {
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  const keyboard = categories.map(cat => ([
    { text: `${cat.icon} ${cat.name}`, callback_data: `cat_view_${cat.id}` }
  ]));

  const uncategorizedProds = allProducts.filter(p => !p.categoryId || !categories.some(c => c.id === p.categoryId));
  if (uncategorizedProds.length > 0) {
    keyboard.unshift([{ text: `📦 Main Catalog / Direct Items (${uncategorizedProds.length})`, callback_data: `cat_view_uncategorized` }]);
  }

  keyboard.push([{ text: '🔙 Main Menu', callback_data: 'nav_main' }]);

  await bot.editMessageText(chatId, messageId, userLang.select_category, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showProductGroupPlans(chatId, messageId, groupKey, userId) {
  const allProducts = db.getProducts();
  const group = PLAN_GROUPS.find(g => g.key === groupKey);
  if (!group) {
    return showCategories(chatId, messageId, userId);
  }

  const groupProducts = allProducts.filter(group.match);

  if (groupProducts.length === 0) {
    const emptyText = `<b>${group.title}</b>\n\nNo plans currently available in this box.`;
    const emptyKb = { inline_keyboard: [[{ text: '🔙 Back to Products', callback_data: 'nav_categories' }]] };
    if (messageId) {
      await bot.editMessageText(chatId, messageId, emptyText, { reply_markup: emptyKb });
    } else {
      await bot.sendMessage(chatId, emptyText, { reply_markup: emptyKb });
    }
    return;
  }

  // Sort by price ascending
  groupProducts.sort((a, b) => (a.price || 0) - (b.price || 0));

  const prodButtons = groupProducts.map(prod => {
    const stockInfo = getProdStockDisplay(prod);
    const usdPrice = `$${(prod.price || 0).toFixed(2)}`;
    return [{
      text: `${stockInfo.icon} ${prod.name} — ${usdPrice}`,
      callback_data: `prod_view_${prod.id}`
    }];
  });

  prodButtons.push([{ text: '🔙 Back to Products', callback_data: 'nav_categories' }]);

  const descStr = group.description ? `<i>${group.description}</i>\n\n` : '';
  const text = `<b>${group.title}</b>\n${descStr}` +
    `Select a plan / duration below to view details and buy:`;

  if (messageId) {
    try {
      const editRes = await bot.editMessageText(chatId, messageId, text, {
        reply_markup: { inline_keyboard: prodButtons }
      });
      if (editRes && editRes.ok) return;
    } catch (e) {}
  }
  await bot.sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: prodButtons }
  });
}

function getProdStockDisplay(prod) {
  const stockCount = typeof prod.stock === 'number' ? prod.stock : 0;
  if (stockCount > 0) {
    return {
      isAvailable: true,
      icon: '🟢',
      badge: `🟢 ${stockCount} in stock`,
      text: `🟢 <b>${stockCount} in stock</b>`
    };
  } else {
    return {
      isAvailable: false,
      icon: '🔴',
      badge: '🔴 Out of stock',
      text: '🔴 <b>Out of stock</b>'
    };
  }
}

function formatTwoColumnKeyboard(buttons) {
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) {
    if (i + 1 < buttons.length) {
      keyboard.push([buttons[i], buttons[i + 1]]);
    } else {
      keyboard.push([buttons[i]]);
    }
  }
  return keyboard;
}

async function showProductsInCategory(chatId, messageId, categoryId, userId) {
  const userLangCode = db.getLanguage(userId);
  const userLang = getLang(userLangCode);

  let products = [];
  if (categoryId === 'uncategorized') {
    const categories = db.getCategories();
    products = db.getProducts().filter(p => !p.categoryId || !categories.some(c => c.id === p.categoryId));
  } else {
    products = db.getProducts(categoryId);
  }

  if (products.length === 0) {
    await bot.editMessageText(chatId, messageId, userLang.no_products, {
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Back to Categories', callback_data: 'nav_categories' }]]
      }
    });
    return;
  }

  const prodButtons = products.map(prod => {
    const stockInfo = getProdStockDisplay(prod);
    return { text: `${stockInfo.icon} ${prod.name}`, callback_data: `prod_view_${prod.id}` };
  });
  const keyboard = formatTwoColumnKeyboard(prodButtons);
  keyboard.push([{ text: '🔙 Back to Categories', callback_data: 'nav_categories' }]);

  await bot.editMessageText(chatId, messageId, userLang.products_available, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showProductDetails(chatId, messageId, productId, userId) {
  const userLangCode = db.getLanguage(userId);
  const userLang = getLang(userLangCode);
  const prod = db.getProduct(productId);
  if (!prod) return;

  // On-The-Fly Real-Time Live Stock Sync directly from ProdSeller API
  if (prod.prodsellerProductId) {
    try {
      const detailRes = await prodseller.getProductDetails(prod.prodsellerProductId);
      if (detailRes.ok && detailRes.product && typeof detailRes.product.stock === 'number') {
        prod.stock = detailRes.product.stock;
        prod.inStock = prod.stock > 0;
        db.save();
      }
    } catch (e) {}
  }

  const stockInfo = getProdStockDisplay(prod);
  const localPrice = formatLocalPrice(prod.price, userLangCode);
  const usdPrice = formatUsdPrice(prod.price);

  const text = `<b>📦 ${prod.name}</b>\n\n` +
    `💰 <b>Price:</b> ${localPrice} <i>(${usdPrice})</i>\n` +
    `📊 <b>Stock Status:</b> ${stockInfo.text}\n\n` +
    `📝 <b>Description:</b>\n${prod.description}\n\n` +
    `⚡ <i>Instant Digital Delivery upon payment confirmation!</i>`;

  const keyboard = [];
  if (stockInfo.isAvailable) {
    keyboard.push([{ text: `⚡ Buy Now (${usdPrice})`, callback_data: `buy_start_${prod.id}` }]);
  }

  const parentGroup = PLAN_GROUPS.find(g => g.match(prod));
  const backCallback = parentGroup ? `prod_group_${parentGroup.key}` : 'nav_categories';
  const backLabel = parentGroup ? `🔙 Back to ${parentGroup.title}` : '🔙 Back to Products';
  keyboard.push([{ text: backLabel, callback_data: backCallback }]);

  await bot.editMessageText(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function promptQuantitySelection(chatId, messageId, userId, productId) {
  const prod = db.getProduct(productId);
  if (!prod) return;

  // On-The-Fly Real-Time Live Stock Sync directly from ProdSeller API before quantity prompt
  if (prod.prodsellerProductId) {
    try {
      const detailRes = await prodseller.getProductDetails(prod.prodsellerProductId);
      if (detailRes.ok && detailRes.product && typeof detailRes.product.stock === 'number') {
        prod.stock = detailRes.product.stock;
        prod.inStock = prod.stock > 0;
        db.save();
      }
    } catch (e) {}
  }

  if (prod.stock <= 0) {
    await bot.sendMessage(chatId, '❌ Product is currently out of stock.');
    return;
  }

  userStates[userId] = {
    type: 'WAITING_BUY_QTY_INPUT',
    productId
  };

  const text = `🔢 <b>HOW MANY ACCOUNTS DO YOU WANT TO BUY?</b>\n\n` +
    `📦 Product: <b>${prod.name}</b>\n` +
    `💰 Unit Price: <b>$${prod.price.toFixed(2)} USD</b>\n` +
    `📊 Available Stock: <b>${prod.stock} Units</b>\n\n` +
    `<i>✍️ Reply by typing the number of accounts you want in chat (e.g. 1, 5, 10, 20):</i>\n\n` +
    `Or choose a quick quantity option below:`;

  const keyboard = [];
  const qtyOptions = [1, 5, 10, 20, 50];
  const validOpts = qtyOptions.filter(q => q <= prod.stock);

  if (validOpts.length > 0) {
    const row1 = [];
    const row2 = [];
    validOpts.forEach((q, idx) => {
      const label = q === 1 ? '1 Account' : `${q} Accounts`;
      const btn = { text: label, callback_data: `buy_qty_set:${prod.id}:${q}` };
      if (idx < 3) row1.push(btn);
      else row2.push(btn);
    });
    if (row1.length > 0) keyboard.push(row1);
    if (row2.length > 0) keyboard.push(row2);
  }

  keyboard.push([{ text: '🔙 Back to Product Details', callback_data: `prod_view_${prod.id}` }]);

  if (messageId) {
    try {
      const editRes = await bot.editMessageText(chatId, messageId, text, {
        reply_markup: { inline_keyboard: keyboard }
      });
      if (editRes && editRes.ok) return;
    } catch (e) {}
  }

  await bot.sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showDirectCheckoutSummary(chatId, userId, productId, qty, messageId = null) {
  const prod = db.getProduct(productId);
  if (!prod) return;

  const rawTotal = prod.price * qty;
  const userBalance = db.getUserBalance(userId);
  const memTier = db.getUserMembershipTier(userId);
  const discountPercent = memTier.currentTier.discountPercent || 0;
  const discountAmount = parseFloat(((rawTotal * discountPercent) / 100).toFixed(2));
  const finalTotal = parseFloat((rawTotal - discountAmount).toFixed(2));

  let discountText = '';
  if (discountPercent > 0) {
    discountText = `🏷️ <b>${memTier.currentTier.name} Discount (${discountPercent}% OFF):</b> -$${discountAmount.toFixed(2)} USD\n`;
  }

  const text = `⚡ <b>DIRECT CHECKOUT SUMMARY</b>\n\n` +
    `📦 Product: <b>${prod.name}</b>\n` +
    `📊 Quantity: <b>${qty} Accounts</b>\n` +
    `💰 Unit Price: <b>$${prod.price.toFixed(2)} USD</b>\n` +
    `💵 Subtotal: <b>$${rawTotal.toFixed(2)} USD</b>\n` +
    `${discountText}` +
    `💰 <b>Final Payable:</b> <b>$${finalTotal.toFixed(2)} USD</b>\n\n` +
    `💳 Your Available Wallet Balance: <b>$${userBalance.toFixed(2)} USD</b>\n\n` +
    `Select your payment option below:`;

  const keyboard = [
    [
      { text: `💳 Pay with Wallet Balance ($${userBalance.toFixed(2)})`, callback_data: `buy_pay_wallet:${prod.id}:${qty}` }
    ],
    [
      { text: '🟡 Pay via Binance Pay ID', callback_data: `buy_pay_binance:${prod.id}:${qty}` }
    ],
    [
      { text: '💎 Pay via USDT BEP20 (BSC)', callback_data: `buy_pay_bep20:${prod.id}:${qty}` }
    ],
    [
      { text: '❌ Cancel Order', callback_data: 'cancel_order' }
    ]
  ];

  if (messageId) {
    try {
      const editRes = await bot.editMessageText(chatId, messageId, text, {
        reply_markup: { inline_keyboard: keyboard }
      });
      if (editRes && editRes.ok) return;
    } catch (e) {}
  }

  await bot.sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function processDirectWalletPayment(chatId, userId, productId, qty) {
  const prod = db.getProduct(productId);
  if (!prod) return;

  const totalUsd = prod.price * qty;
  const currentBalance = db.getUserBalance(userId);

  if (currentBalance < totalUsd) {
    await bot.sendMessage(chatId, `❌ <b>Insufficient Wallet Balance!</b>\n\n` +
      `Order Total: <b>$${totalUsd.toFixed(2)} USD</b>\n` +
      `Your Balance: <b>$${currentBalance.toFixed(2)} USD</b>\n\n` +
      `Please deposit funds first or pay via Binance Pay / USDT BEP20!`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: `💳 Deposit Funds Now`, callback_data: 'nav_deposit_start' }],
            [{ text: '🟡 Pay via Binance Pay ID', callback_data: `buy_pay_binance:${prod.id}:${qty}` }],
            [{ text: '💎 Pay via USDT BEP20 (BSC)', callback_data: `buy_pay_bep20:${prod.id}:${qty}` }]
          ]
        }
      });
    return;
  }

  db.deductBalance(userId, totalUsd);
  const username = db.getUser(userId)?.username || 'User';
  const items = [{ id: prod.id, name: prod.name, qty, priceUsd: prod.price }];
  const order = db.createOrder(userId, username, items, totalUsd, 'Wallet Balance', 'Internal Wallet Deduction', true);

  await deliverOrderItems(chatId, userId, order);

  const adminMsg = `⚡ <b>WALLET PURCHASE ORDER #${order.id}!</b>\n\n` +
    `👤 <b>Buyer:</b> @${username} (ID: <code>${userId}</code>)\n` +
    `💵 <b>Deducted Amount:</b> $${totalUsd.toFixed(2)} USD\n` +
    `💰 <b>Remaining Wallet Balance:</b> $${db.getUserBalance(userId).toFixed(2)} USD\n\n` +
    `<i>Items automatically delivered via .txt receipt!</i>`;

  notifyOwnerAdmin(adminMsg);
}

async function showBinanceDirectPaymentInstructions(chatId, userId, productId, qty) {
  const prod = db.getProduct(productId);
  if (!prod) return;

  const totalUsd = prod.price * qty;
  const items = [{ id: prod.id, name: prod.name, qty, priceUsd: prod.price }];

  userStates[userId] = {
    type: 'WAITING_PAYMENT_PROOF',
    items,
    totalUsd,
    paymentMethod: 'binance_pay'
  };

  const text = `🟡 <b>BINANCE PAY PAYMENT INSTRUCTIONS</b>\n\n` +
    `📦 Product: <b>${prod.name}</b> (${qty} Accounts)\n` +
    `💵 <b>Total Payable Amount:</b> <b>$${totalUsd.toFixed(2)} USD</b>\n\n` +
    `🟡 <b>Binance Pay ID:</b>\n` +
    `<code>${BINANCE_PAY_ID}</code> <i>(Tap number to copy ID)</i>\n\n` +
    `👤 <b>Binance Account Name:</b>\n` +
    `${BINANCE_ACCOUNT_NAME}\n\n` +
    `<i>After transferring $${totalUsd.toFixed(2)} USD, reply with your <b>Binance Transaction ID</b> below for verification!</i>`;

  await bot.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ Cancel Purchase', callback_data: 'cancel_order' }]]
    }
  });
}

async function showBep20DirectPaymentInstructions(chatId, userId, productId, qty) {
  const prod = db.getProduct(productId);
  if (!prod) return;

  const totalUsd = prod.price * qty;
  const items = [{ id: prod.id, name: prod.name, qty, priceUsd: prod.price }];
  const bep20Address = db.getSettings().paymentMethods?.usdt_bep20 || '0x9917d2894072e53cd27542e4fc76c152c284a01c';

  userStates[userId] = {
    type: 'WAITING_PAYMENT_PROOF',
    items,
    totalUsd,
    paymentMethod: 'usdt_bep20'
  };

  const text = `💎 <b>USDT BEP20 (BNB SMART CHAIN) PAYMENT INSTRUCTIONS</b>\n\n` +
    `📦 Product: <b>${prod.name}</b> (${qty} Accounts)\n` +
    `💵 <b>Total Payable Amount:</b> <b>$${totalUsd.toFixed(2)} USD (USDT)</b>\n\n` +
    `🌐 <b>Network:</b> BNB Smart Chain (BEP20 / BSC)\n` +
    `📥 <b>Deposit Wallet Address:</b>\n` +
    `<code>${bep20Address}</code> <i>(Tap address to copy)</i>\n\n` +
    `⏱ <b>Important Notice:</b>\n` +
    `BNB Smart Chain (BEP20) transactions require <b>5 to 10 minutes</b> for blockchain network confirmations.\n\n` +
    `<i>After completing your transfer, reply with your <b>Transaction Hash (TxHash)</b> below. The bot will track network confirmations with a 10-minute timer and deliver your product immediately once confirmed!</i>`;

  await bot.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ Cancel Purchase', callback_data: 'cancel_order' }]]
    }
  });
}

async function handleCancelOrder(chatId, userId, messageId = null) {
  userStates[userId] = null;

  await bot.sendMessage(chatId, `🚫 <b>Your purchase order has been cancelled!</b>`);

  const customPhoto = db.getWelcomePhoto();
  const bannerPath = path.join(__dirname, 'kos_banner.png');
  const photoToSend = customPhoto || (fs.existsSync(bannerPath) ? bannerPath : null);

  const userObj = db.getUser(userId) || { firstName: 'Customer' };
  const balance = db.getUserBalance(userId).toFixed(1);
  const lastOrder = db.getLastUserOrder(userId);
  const lastPurchaseText = lastOrder ? `#${lastOrder.id} (${lastOrder.items[0]?.name || 'Item'})` : 'No purchases yet';

  const captionText = `🖐️ <b>Welcome</b> <b>${userObj.firstName || 'Customer'}</b>\n` +
    `_____________________________________\n\n` +
    `🪙 <b>Balance:</b> <code>$${balance} USD</code>\n` +
    `👤 <b>Status:</b> 👤 Customer\n` +
    `🕒 <b>Last Purchase:</b> <i>${lastPurchaseText}</i>\n` +
    `_____________________________________\n\n` +
    `<b>RedNox Store</b>`;

  if (photoToSend) {
    await bot.sendPhoto(chatId, photoToSend, {
      caption: captionText,
      reply_markup: getMainMenuKeyboard(userId)
    });
  } else {
    await bot.sendMessage(chatId, captionText, {
      reply_markup: getMainMenuKeyboard(userId)
    });
  }
}

async function verifyBscPaymentWithTimer(chatId, proofText, expectedAmountUsd) {
  let isDone = false;
  const startTime = Date.now();
  const durationMs = 600 * 1000; // 10 minutes = 600 seconds
  const endTime = startTime + durationMs;
  const spinnerFrames = ['⏳', '⚡', '🔄', '⛓️'];
  let frameIdx = 0;

  const binanceCreds = db.getBinanceCredentials();
  const verifier = new BinancePayVerifier(binanceCreds.apiKey, binanceCreds.apiSecret);

  const getTimerText = (remainingSec) => {
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;
    const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const pct = Math.min(99, Math.max(1, Math.floor((elapsedSec / 600) * 100)));
    const filledBars = Math.floor(pct / 10);
    const barStr = '▓'.repeat(filledBars) + '░'.repeat(10 - filledBars);
    const icon = spinnerFrames[frameIdx % spinnerFrames.length];

    return `⏳ <b>BNB SMART CHAIN (BEP20) PAYMENT VERIFICATION</b> ⛓️\n\n` +
      `${icon} <i>Checking BNB Smart Chain blockchain confirmations...</i>\n\n` +
      `⏱ <b>Confirmation Timer:</b> <code>${timeFormatted}</code>\n` +
      `📊 <b>Progress:</b> <code>[${barStr}] ${pct}%</code>\n` +
      `🆔 <b>TxHash:</b> <code>${proofText}</code>\n\n` +
      `ℹ️ <b>Important Notice:</b>\n` +
      `BNB Smart Chain (BEP20) transactions require <b>5 to 10 minutes</b> for blockchain network confirmations.\n\n` +
      `✨ <b>As soon as payment is confirmed, your digital product will be delivered automatically!</b>\n` +
      `🔒 <i>Please keep this chat open. Checking live network...</i>`;
  };

  let progressMsgId = null;
  try {
    const initMsg = await bot.sendMessage(chatId, getTimerText(600));
    if (initMsg && initMsg.ok && initMsg.result) {
      progressMsgId = initMsg.result.message_id;
    }
  } catch (e) {
    console.error('Error sending BSC timer init message:', e.message);
  }

  return new Promise((resolve) => {
    let timerInterval = null;
    let pollTimeout = null;
    let hardTimeout = null;

    const cleanup = () => {
      isDone = true;
      if (timerInterval) clearInterval(timerInterval);
      if (pollTimeout) clearTimeout(pollTimeout);
      if (hardTimeout) clearTimeout(hardTimeout);
    };

    const handleTimeout = async () => {
      if (isDone) return;
      cleanup();

      const notFoundText = `❌ <b>Payment Not Found!</b>\n\n` +
        `The transaction could not be verified on the BNB Smart Chain within the 10-minute window.\n\n` +
        `🆔 <b>Transaction Hash:</b>\n<code>${proofText}</code>\n\n` +
        `⚠️ <b>If you have already sent the payment:</b>\n` +
        `Please contact Store Owner <b>${OWNER_HANDLE}</b> directly with your Transaction Hash (TxHash) for manual verification and delivery!`;

      const keyboard = [
        [{ text: `💬 Contact Owner (${OWNER_HANDLE})`, url: `https://t.me/${OWNER_HANDLE.replace('@', '')}` }],
        [{ text: '🛍️ Return to Store Menu', callback_data: 'nav_main' }]
      ];

      if (progressMsgId) {
        try {
          await bot.editMessageText(chatId, progressMsgId, notFoundText, {
            reply_markup: { inline_keyboard: keyboard }
          });
        } catch (e) {
          try {
            await bot.sendMessage(chatId, notFoundText, { reply_markup: { inline_keyboard: keyboard } });
          } catch (e2) {}
        }
      } else {
        try {
          await bot.sendMessage(chatId, notFoundText, { reply_markup: { inline_keyboard: keyboard } });
        } catch (e) {}
      }

      resolve({ success: false, handled: true, reason: 'Payment Not Found' });
    };

    // 1. Live timer countdown interval (every 4 seconds)
    timerInterval = setInterval(async () => {
      if (isDone) return;

      const remainingSec = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      frameIdx++;

      if (remainingSec <= 0) {
        await handleTimeout();
        return;
      }

      if (progressMsgId) {
        try {
          await bot.editMessageText(chatId, progressMsgId, getTimerText(remainingSec));
        } catch (e) {
          // Ignore minor Telegram rate limits
        }
      }
    }, 4000);

    // 2. Poll verify function (every 8 seconds)
    const runPoll = async () => {
      if (isDone) return;

      if (Date.now() >= endTime) {
        await handleTimeout();
        return;
      }

      try {
        const verifyResult = await verifier.verifyTransaction(proofText, expectedAmountUsd);
        if (verifyResult.success) {
          cleanup();
          if (progressMsgId) {
            try {
              await bot.editMessageText(chatId, progressMsgId, `✅ <b>BNB SMART CHAIN PAYMENT CONFIRMED!</b> 🎉\n\n` +
                `⛓️ <i>Transaction verified on BNB Smart Chain ledger! Delivering your product now...</i> 🚀`);
            } catch (e) {}
          }
          resolve({ success: true, verifyResult });
          return;
        }
      } catch (err) {
        console.error('Error during BSC verification poll:', err.message);
      }

      if (!isDone && Date.now() < endTime) {
        pollTimeout = setTimeout(runPoll, 8000);
      } else if (!isDone) {
        await handleTimeout();
      }
    };

    // Start first verification check after 2 seconds
    pollTimeout = setTimeout(runPoll, 2000);

    // Safety net: hard timeout at 605 seconds
    hardTimeout = setTimeout(handleTimeout, durationMs + 5000);
  });
}

async function processDepositTransaction(msg, state) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || 'User';
  const proofText = (msg.text || '').trim();
  const reqAmount = state.requestedAmountUsd;

  if (db.isTrxUsed(proofText)) {
    await bot.sendMessage(chatId, `❌ <b>TRANSACTION ID ALREADY CLAIMED!</b>\n\n` +
      `This Transaction ID (<code>${proofText}</code>) has already been processed previously!\n\n` +
      `⚠️ Duplicate Transaction IDs cannot be reused. Please submit a new, unique Transaction ID.`, {
        reply_markup: {
          inline_keyboard: [[{ text: '🛍️ Return to Store Menu', callback_data: 'nav_main' }]]
        }
      });
    return;
  }

  const isBscPayment = proofText.startsWith('0x');
  let verifyResult;

  if (isBscPayment) {
    const bscResult = await verifyBscPaymentWithTimer(chatId, proofText, reqAmount);
    if (!bscResult.success) {
      if (!bscResult.handled && bscResult.reason) {
        await bot.sendMessage(chatId, bscResult.reason, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Try Again', callback_data: 'nav_deposit_start' }],
              [{ text: '🛍️ Main Menu', callback_data: 'nav_main' }]
            ]
          }
        });
      }
      return;
    }
    verifyResult = bscResult.verifyResult;
  } else {
    const binanceCreds = db.getBinanceCredentials();
    const verifier = new BinancePayVerifier(binanceCreds.apiKey, binanceCreds.apiSecret);

    await bot.sendMessage(chatId, `⚡ <b>VERIFYING TRANSACTION WITH BINANCE SECURE API...</b> 🛡️\n\n` +
      `<i>🤖 Syncing with Binance Live Ledger & Confirming Payment... Please wait a moment!</i> ⏳`);
    verifyResult = await verifier.verifyTransaction(proofText, reqAmount);
  }

  if (verifyResult.success) {
    db.markTrxUsed(proofText);
    const actualPaid = verifyResult.paidAmount || reqAmount;
    const newBal = db.addBalance(userId, actualPaid);

    await bot.sendMessage(chatId, `✅ <b>DEPOSIT CONFIRMED & ADDED TO WALLET!</b>\n\n` +
      `💵 <b>Deposited Amount:</b> $${actualPaid.toFixed(2)} USD\n` +
      `💰 <b>New Wallet Balance:</b> <b>$${newBal.toFixed(2)} USD</b>`, {
        reply_markup: {
          inline_keyboard: [[{ text: '🛍️ Shop Now', callback_data: 'nav_categories' }]]
        }
      });

    const adminMsg = `⚡ <b>WALLET DEPOSIT CONFIRMED VIA BINANCE API!</b>\n\n` +
      `👤 <b>User:</b> @${username} (ID: <code>${userId}</code>)\n` +
      `💵 <b>Deposit Amount:</b> $${actualPaid.toFixed(2)} USD\n` +
      `💰 <b>Updated User Balance:</b> $${newBal.toFixed(2)} USD\n` +
      `🆔 <b>Verified Trx ID:</b> <code>${proofText}</code>`;

    notifyOwnerAdmin(adminMsg);

  } else {
    await bot.sendMessage(chatId, verifyResult.reason, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Try Again', callback_data: 'nav_deposit_start' }],
          [{ text: '🛍️ Main Menu', callback_data: 'nav_main' }]
        ]
      }
    });
  }
}

async function processPaymentProof(msg, state) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || 'Buyer';
  const userLangCode = db.getLanguage(userId);
  const userLang = getLang(userLangCode);

  let proofText = (msg.text || '').trim();
  if (msg.photo && msg.photo.length > 0) {
    proofText = `[Photo Receipt Attached - File ID: ${msg.photo[msg.photo.length - 1].file_id}]`;
  }

  const usdTotalStr = formatUsdPrice(state.totalUsd);

  if (db.isTrxUsed(proofText)) {
    await bot.sendMessage(chatId, `❌ <b>TRANSACTION ID ALREADY CLAIMED!</b>\n\n` +
      `This Transaction ID (<code>${proofText}</code>) has already been processed previously!\n\n` +
      `⚠️ Duplicate Transaction IDs cannot be reused. Please submit a new, unique Transaction ID.`, {
        reply_markup: {
          inline_keyboard: [[{ text: '🛍️ Return to Store Menu', callback_data: 'nav_main' }]]
        }
      });
    return;
  }

  const isBscPayment = (state.paymentMethod === 'usdt_bep20') || proofText.startsWith('0x');
  let verifyResult;

  if (isBscPayment) {
    const bscResult = await verifyBscPaymentWithTimer(chatId, proofText, state.totalUsd);
    if (!bscResult.success) {
      if (!bscResult.handled && bscResult.reason) {
        await bot.sendMessage(chatId, bscResult.reason, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Try Again / Enter Valid Trx ID', callback_data: 'nav_categories' }],
              [{ text: '🛍️ Main Menu', callback_data: 'nav_main' }]
            ]
          }
        });
      }
      return;
    }
    verifyResult = bscResult.verifyResult;
  } else {
    const binanceCreds = db.getBinanceCredentials();
    const verifier = new BinancePayVerifier(binanceCreds.apiKey, binanceCreds.apiSecret);

    await bot.sendMessage(chatId, `⚡ <b>VERIFYING TRANSACTION WITH BINANCE SECURE API...</b> 🛡️\n\n` +
      `<i>🤖 Syncing with Binance Live Ledger & Confirming Payment... Please wait a moment!</i> ⏳`);
    verifyResult = await verifier.verifyTransaction(proofText, state.totalUsd);
  }

  if (verifyResult.success) {
    db.markTrxUsed(proofText);
    const order = db.createOrder(userId, username, state.items, state.totalUsd, state.paymentMethod, proofText, true);

    await deliverOrderItems(chatId, userId, order);

    const adminMsg = `⚡ <b>BINANCE API AUTO-VERIFIED ORDER #${order.id}!</b>\n\n` +
      `👤 <b>Buyer:</b> @${username} (ID: <code>${userId}</code>)\n` +
      `💳 <b>Method:</b> ${state.paymentMethod}\n` +
      `💵 <b>Paid Amount:</b> ${usdTotalStr}\n` +
      `🆔 <b>Verified Trx ID / TxHash:</b> <code>${proofText}</code>\n\n` +
      `<i>Digital credentials (.txt receipt) delivered to buyer automatically.</i>`;

    notifyOwnerAdmin(adminMsg);

  } else {
    await bot.sendMessage(chatId, verifyResult.reason, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Try Again / Enter Valid Trx ID', callback_data: 'nav_categories' }],
          [{ text: '🛍️ Main Menu', callback_data: 'nav_main' }]
        ]
      }
    });
  }
}

async function deliverOrderItems(chatId, userId, order) {
  // ----------------------------------------------------
  // 1. LIVE SECOND-BY-SECOND COUNTDOWN TIMER INITIALIZATION
  // ----------------------------------------------------
  let isCompleted = false;
  let secondsRemaining = 60;
  const startTime = Date.now();
  const spinnerFrames = ['⏳', '⚡', '🔄', '⚙️'];
  let frameIdx = 0;

  let progressMsgId = null;
  try {
    const initMsg = await bot.sendMessage(chatId, `⚡ <b>JUST-IN-TIME (JIT) AUTO-TOPUP & FULFILLMENT</b> 🛡️\n\n` +
      `🔄 <i>Connecting to Binance & Supplier Network...</i>\n\n` +
      `⏱ <b>Live Fulfillment Timer:</b> <code>60s</code>\n` +
      `📊 <b>Progress:</b> <code>[░░░░░░░░░░] 0%</code>\n\n` +
      `🔒 <i>Please keep chat open. Credentials will be delivered directly here!</i>`);
    if (initMsg && initMsg.ok && initMsg.result) {
      progressMsgId = initMsg.result.message_id;
    }
  } catch (e) {}

  let timerInterval = null;
  if (progressMsgId) {
    timerInterval = setInterval(async () => {
      if (isCompleted || secondsRemaining <= 1) {
        if (timerInterval) clearInterval(timerInterval);
        return;
      }
      secondsRemaining -= 2;
      if (secondsRemaining < 1) secondsRemaining = 1;
      frameIdx++;
      const icon = spinnerFrames[frameIdx % spinnerFrames.length];
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      const pct = Math.min(95, Math.max(5, Math.floor((elapsedSec / 60) * 100)));
      const filledBars = Math.floor(pct / 10);
      const barStr = '▓'.repeat(filledBars) + '░'.repeat(10 - filledBars);

      const statusText = `⚡ <b>JUST-IN-TIME (JIT) AUTO-TOPUP & FULFILLMENT</b> 🛡️\n\n` +
        `${icon} <i>Settling USDT & securing digital credentials from supplier network...</i>\n\n` +
        `⏱ <b>Live Fulfillment Timer:</b> <code>${secondsRemaining}s</code>\n` +
        `📊 <b>Progress:</b> <code>[${barStr}] ${pct}%</code>\n\n` +
        `🔒 <i>Instant digital delivery upon completion. Please keep this chat open!</i>`;

      try {
        await bot.editMessageText(chatId, progressMsgId, statusText);
      } catch (err) {
        // FloodWait rate limit protection - ignore minor edit delays
      }
    }, 1800);
  }

  // ----------------------------------------------------
  // 2. BACKGROUND AUTO-FULFILLMENT & SUPPLIER PURCHASE
  // ----------------------------------------------------
  let fileContent = `==================================================\n`;
  fileContent += `🎁 REDNOX SELLING STORE - DIGITAL DELIVERY RECEIPT\n`;
  fileContent += `==================================================\n`;
  fileContent += `Order ID: #${order.id}\n`;
  fileContent += `Customer ID: ${order.userId}\n`;
  fileContent += `Total Amount Paid: $${order.totalAmount.toFixed(2)} USD\n`;
  fileContent += `Date: ${new Date(order.createdAt).toLocaleString()}\n`;
  fileContent += `--------------------------------------------------\n`;
  fileContent += `DELIVERED DIGITAL KEYS / LINKS / ACCOUNTS:\n`;
  fileContent += `--------------------------------------------------\n\n`;

  const itemNamesStr = [];

  for (let pIdx = 0; pIdx < order.items.length; pIdx++) {
    const item = order.items[pIdx];
    fileContent += `📦 PRODUCT #${pIdx + 1}: ${item.name} (Qty: ${item.qty})\n`;
    fileContent += `--------------------------------------------------\n`;

    let keysDelivered = db.dispatchOrderKeys(item.id, item.qty);
    const dbProd = db.getProduct(item.id);
    const supplierProdId = (dbProd && dbProd.prodsellerProductId) || item.prodsellerProductId || (item.id.length === 24 ? item.id : null);

    if (supplierProdId && prodseller.getApiKey()) {
      const neededQty = item.qty - keysDelivered.length;
      if (neededQty > 0) {
        // --- JUST-IN-TIME (JIT) AUTO-TOPUP CHECK VIA BINANCE API ---
        try {
          const balRes = await prodseller.getBalance();
          const currentBal = (balRes.ok && balRes.data && typeof balRes.data.balance === 'number') ? balRes.data.balance : 0;
          const wholesaleUnit = typeof dbProd?.wholesaleCost === 'number' ? dbProd.wholesaleCost : 0;
          const neededTotalCost = wholesaleUnit * neededQty;

          if (currentBal < neededTotalCost) {
            console.log(`⚠️ Supplier Balance Low ($${currentBal} < $${neededTotalCost}). Initiating JIT Auto-Topup via Binance API...`);

            const binanceCreds = db.getBinanceCredentials();
            const verifier = new BinancePayVerifier(binanceCreds.apiKey, binanceCreds.apiSecret);
            const sellerDepositTarget = db.getSellerDepositAddress();
            const deficitAmount = Math.max(0.10, parseFloat((neededTotalCost - currentBal).toFixed(2)));

            if (sellerDepositTarget && verifier.isConfigured()) {
              const transferRes = await verifier.withdrawUsdt(deficitAmount, sellerDepositTarget);
              if (transferRes.success) {
                console.log(`✅ JIT Auto-Deposit of $${deficitAmount} USDT sent to Seller Bot! TxID: ${transferRes.txId}`);
                notifyOwnerAdmin(`⚡ <b>JIT AUTO-TOPUP SENT VIA BINANCE API!</b> 🚀\n\n` +
                  `📦 <b>Product:</b> ${item.name}\n` +
                  `💵 <b>Amount Deposited:</b> $${deficitAmount.toFixed(2)} USDT\n` +
                  `🆔 <b>Binance TxID:</b> <code>${transferRes.txId}</code>\n` +
                  `📍 <b>Target:</b> <code>${sellerDepositTarget}</code>\n\n` +
                  `<i>Deposit transferred to supplier for instant customer fulfillment!</i>`);
                // Wait for supplier ledger confirmation
                await new Promise(r => setTimeout(r, 4000));
              } else {
                console.error(`❌ Binance JIT Auto-Deposit error:`, transferRes.error);
                notifyOwnerAdmin(`⚠️ <b>JIT Auto-Deposit Failed on Binance!</b>\n\n` +
                  `❌ <b>Error:</b> <code>${transferRes.error}</code>\n` +
                  `💵 <b>Required:</b> $${deficitAmount.toFixed(2)} USDT\n` +
                  `<i>Please check your Binance balance or top up seller bot manually!</i>`);
              }
            } else if (!sellerDepositTarget) {
              console.warn('⚠️ Seller Deposit Address not yet configured in settings.');
              notifyOwnerAdmin(`⚠️ <b>Supplier Balance Low ($${currentBal.toFixed(2)} < $${neededTotalCost.toFixed(2)})!</b>\n\n` +
                `Order #${order.id} needs $${neededTotalCost.toFixed(2)} for ${item.name}.\n` +
                `💡 <i>To enable automated Binance deposits, set your Seller Bot Deposit Target in Admin Panel!</i>`);
            }
          }
        } catch (e) {
          console.error('Error during JIT balance check:', e.message);
        }

        const idempotencyKey = `ord_${order.id}_${item.id}_${Date.now()}`;
        const res = await prodseller.createOrder(supplierProdId, neededQty, idempotencyKey);

        if (res.ok && Array.isArray(res.deliveredKeys) && res.deliveredKeys.length > 0) {
          keysDelivered = keysDelivered.concat(res.deliveredKeys);
        } else if (res.error) {
          fileContent += `⚠️ Supplier Auto-Delivery Notice: ${res.error}\n`;
          const adminMsg = `⚠️ <b>ProdSeller API Delivery Alert!</b>\n\n` +
            `📦 <b>Product:</b> ${item.name}\n` +
            `❌ <b>Error:</b> <code>${res.error}</code>\n` +
            `📦 <b>Order ID:</b> #${order.id}\n` +
            `👤 <b>Customer ID:</b> <code>${order.userId}</code>\n\n` +
            `<i>Please check your ProdSeller balance or restock supplier account!</i>`;
          notifyOwnerAdmin(adminMsg);
        }
      }
    }

    if (keysDelivered.length > 0) {
      keysDelivered.forEach((k, kIdx) => {
        fileContent += `${kIdx + 1}. ${k}\n`;
      });
    } else {
      fileContent += `⚠️ Key delivery pending. Please contact store owner ${OWNER_HANDLE}.\n`;
    }
    fileContent += `\n`;

    itemNamesStr.push(`<b>${item.name}</b> (Qty: ${item.qty})`);
  }

  // ----------------------------------------------------
  // 3. INSTANT STOP: TIMER HALTED IMMEDIATELY ON FULFILLMENT
  // ----------------------------------------------------
  isCompleted = true;
  if (timerInterval) clearInterval(timerInterval);

  const durationSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));

  if (progressMsgId) {
    try {
      const finalStatusText = `🎉 <b>JUST-IN-TIME FULFILLMENT COMPLETED!</b> ⚡\n\n` +
        `⏱ <b>Total Fulfillment Speed:</b> <code>${durationSec} seconds</code> ⚡\n` +
        `📦 <b>Status:</b> <b>✅ All Digital Credentials Successfully Secured & Delivered!</b>\n\n` +
        `<i>Your accounts & login keys are attached in the receipt below:</i> 👇`;
      await bot.editMessageText(chatId, progressMsgId, finalStatusText);
    } catch (e) {}
  }

  fileContent += `==================================================\n`;
  fileContent += `Thank you for shopping with us! Support: ${OWNER_HANDLE}\n`;
  fileContent += `==================================================\n`;

  const captionText = `🎉 <b>ORDER APPROVED & DELIVERED! (#${order.id})</b>\n\n` +
    `Thank you for shopping with <b>RedNox Store</b>!\n\n` +
    `📦 <b>Purchased Items:</b> ${itemNamesStr.join(', ')}\n` +
    `💵 <b>Total Paid:</b> $${order.totalAmount.toFixed(2)} USD\n` +
    `⏱ <b>Fulfillment Time:</b> <code>${durationSec}s (Instant JIT Delivery)</code>\n\n` +
    `📄 <i>Your accounts/links have been generated into the attached .txt file above!</i>\n\n` +
    `💬 <i>Need assistance? Feel free to contact ${OWNER_HANDLE} anytime!</i>`;

  const fileName = `Order_${order.id}_Items.txt`;
  const fileBuffer = Buffer.from(fileContent, 'utf8');

  await bot.sendDocument(chatId, fileBuffer, fileName, {
    caption: captionText,
    reply_markup: {
      inline_keyboard: [[{ text: '🛍️ Return to Store Menu', callback_data: 'nav_main' }]]
    }
  });
}

async function showUserProfile(chatId, messageId, userId) {
  const user = db.getUser(userId) || { firstName: 'Customer', username: '', joinedAt: new Date().toISOString() };
  const balance = db.getUserBalance(userId);
  const stats = db.getUserPurchasesStats(userId);
  const memTier = db.getUserMembershipTier(userId);

  const depositStatus = balance > 0
    ? `<b>$${balance.toFixed(2)} USD</b> 🟢 (Deposit Active)`
    : `<b>$0.00 USD</b> 🔴 (No Deposit)`;

  const text = `<b>👤 USER ACCOUNT PROFILE</b>\n\n` +
    `👤 <b>Name:</b> ${user.firstName || 'Customer'} ${user.username ? '(@' + user.username + ')' : ''}\n` +
    `🆔 <b>Telegram ID:</b> <code>${userId}</code>\n` +
    `💎 <b>VIP Level:</b> <b>${memTier.currentTier.name}</b> (${memTier.currentTier.discountPercent}% OFF)\n` +
    `🗓️ <b>Member Since:</b> ${new Date(user.joinedAt).toLocaleDateString()}\n\n` +
    `💰 <b>Store Deposit Balance:</b> ${depositStatus}\n\n` +
    `🛍️ <b>Total Orders Purchased:</b> <b>${stats.totalOrders} Orders</b> <i>(${stats.totalItemsPurchased} items)</i>\n` +
    `💵 <b>Total Spent:</b> <b>$${stats.totalSpent.toFixed(2)} USD</b>`;

  const keyboard = [
    [{ text: `💳 Add Deposit Funds ($${balance.toFixed(2)})`, callback_data: 'nav_deposit_start' }],
    [{ text: '💎 VIP Membership Status', callback_data: 'nav_membership_menu' }],
    [{ text: '🛍️ Return to Store Menu', callback_data: 'nav_main' }]
  ];

  if (messageId) {
    try {
      const editRes = await bot.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      if (editRes && editRes.ok) return;
    } catch (e) {}
  }

  await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function showCustomerBalanceView(chatId, messageId, userId) {
  const balance = db.getUserBalance(userId);
  const user = db.getUser(userId) || { firstName: 'Customer' };
  const memTier = db.getUserMembershipTier(userId);

  const text = `💳 <b>YOUR STORE WALLET BALANCE</b>\n\n` +
    `👤 <b>Customer:</b> ${user.firstName || 'Customer'}\n` +
    `🪙 <b>Available Balance:</b> <code>$${balance.toFixed(2)} USD</code>\n` +
    `💎 <b>VIP Membership Tier:</b> <b>${memTier.currentTier.name}</b> (${memTier.currentTier.discountPercent}% OFF)\n\n` +
    `<i>Use your store wallet balance for instant 1-click purchases without waiting for payment verification!</i>`;

  const keyboard = [
    [{ text: '💰 Deposit Funds to Wallet', callback_data: 'nav_deposit_start' }],
    [{ text: '📜 My Order History', callback_data: 'nav_orders' }],
    [{ text: '🛍️ Return to Store Menu', callback_data: 'nav_main' }]
  ];

  if (messageId) {
    try {
      const editRes = await bot.editMessageText(chatId, messageId, text, {
        reply_markup: { inline_keyboard: keyboard }
      });
      if (editRes && editRes.ok) return;
    } catch (e) {}
  }

  await bot.sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminSalesAnalytics(chatId, messageId) {
  const analytics = db.getStoreAnalytics();

  let text = `<b>📊 STORE SALES & STOCK ANALYTICS DASHBOARD</b>\n\n` +
    `💰 <b>Total Revenue Earned:</b> <b>$${analytics.totalRevenue.toFixed(2)} USD</b>\n` +
    `📦 <b>Total Items Sold:</b> <b>${analytics.totalItemsSold} Units</b>\n` +
    `🛒 <b>Total Completed Orders:</b> <b>${analytics.totalApprovedOrders} Orders</b>\n\n` +
    `======================================\n` +
    `📦 <b>PRODUCT-BY-PRODUCT STOCK & SALES:</b>\n` +
    `--------------------------------------\n`;

  const prodKeys = Object.keys(analytics.productSalesMap);
  if (prodKeys.length === 0) {
    text += `<i>No products created yet.</i>\n`;
  } else {
    prodKeys.forEach((pid, idx) => {
      const p = analytics.productSalesMap[pid];
      text += `${idx + 1}. <b>${p.name}</b>\n` +
        `   • Total Sold: <b>${p.soldQty} Units</b> ($${p.revenueUsd.toFixed(2)} USD)\n` +
        `   • Remaining Stock: <b>${p.remainingStock} Units</b>\n\n`;
    });
  }

  text += `======================================\n` +
    `👥 <b>CUSTOMER PURCHASES (WHO BOUGHT WHAT):</b>\n` +
    `--------------------------------------\n`;

  const custKeys = Object.keys(analytics.customerSalesMap);
  if (custKeys.length === 0) {
    text += `<i>No customer purchases recorded yet.</i>\n`;
  } else {
    custKeys.forEach((uid, idx) => {
      const c = analytics.customerSalesMap[uid];
      const handleStr = c.username ? `@${c.username}` : `User ${uid}`;
      text += `${idx + 1}. 👤 <b>${handleStr}</b> (ID: <code>${uid}</code>)\n` +
        `   • Total Spent: <b>$${c.totalSpent.toFixed(2)} USD</b> (${c.ordersCount} Orders)\n` +
        `   • Items Bought: ${c.itemsPurchased.join(', ')}\n\n`;
    });
  }

  const keyboard = [
    [{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]
  ];

  if (messageId) {
    await bot.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
  } else {
    await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  }
}

async function showLanguageMenu(chatId, messageId, userId) {
  const userLangCode = db.getLanguage(userId);
  const userLang = getLang(userLangCode);

  const keyboard = [
    [
      { text: translations.en.name, callback_data: 'set_lang_en' },
      { text: translations.ar.name, callback_data: 'set_lang_ar' }
    ],
    [
      { text: translations.zh.name, callback_data: 'set_lang_zh' },
      { text: translations.fr.name, callback_data: 'set_lang_fr' }
    ],
    [
      { text: translations.ru.name, callback_data: 'set_lang_ru' },
      { text: translations.si.name, callback_data: 'set_lang_si' }
    ],
    [
      { text: translations.es.name, callback_data: 'set_lang_es' },
      { text: translations.de.name, callback_data: 'set_lang_de' }
    ],
    [
      { text: userLang.btn_main, callback_data: 'nav_main' }
    ]
  ];

  if (messageId) {
    try {
      const editRes = await bot.editMessageText(chatId, messageId, userLang.select_language, {
        reply_markup: { inline_keyboard: keyboard }
      });
      if (editRes && editRes.ok) return;
    } catch (e) {}
  }

  await bot.sendMessage(chatId, userLang.select_language, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showUserOrders(chatId, messageId, userId) {
  const userLangCode = db.getLanguage(userId);
  const userLang = getLang(userLangCode);
  const orders = db.getUserOrders(userId);

  if (orders.length === 0) {
    await bot.sendMessage(chatId, userLang.no_orders, {
      reply_markup: {
        inline_keyboard: [[{ text: userLang.btn_main, callback_data: 'nav_main' }]]
      }
    });
    return;
  }

  let text = userLang.order_history;
  orders.slice(-5).forEach(o => {
    const statusEmoji = o.status === 'approved' ? '✅ Approved' : (o.status === 'rejected' ? '❌ Rejected' : '⏳ Pending');
    const usdVal = formatUsdPrice(o.totalAmount);
    text += `<b>Order #${o.id}</b>\n` +
      `Amount: ${usdVal} | Status: ${statusEmoji}\n` +
      `Items: ${o.items.map(i => i.name).join(', ')}\n` +
      `----------------------------------------\n`;
  });

  await bot.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [[{ text: userLang.btn_main, callback_data: 'nav_main' }]]
    }
  });
}

async function showPaymentInfo(chatId, messageId, userId) {
  const userLangCode = db.getLanguage(userId);
  const userLang = getLang(userLangCode);
  const bep20Address = db.getSettings().paymentMethods?.usdt_bep20 || '0x1245075177BEP20AddressHolder';

  const text = `<b>💳 STORE ACCEPTED PAYMENT METHODS</b>\n\n` +
    `🟡 <b>Option 1: Binance Pay ID</b>\n` +
    `<code>${BINANCE_PAY_ID}</code> <i>(Tap number to copy ID)</i>\n` +
    `👤 <b>Binance Account Name:</b> ${BINANCE_ACCOUNT_NAME}\n\n` +
    `💎 <b>Option 2: USDT BEP20 (BSC) Address</b>\n` +
    `<code>${bep20Address}</code> <i>(Tap address to copy)</i>\n` +
    `🌐 <b>Network:</b> BNB Smart Chain (BEP20 / BSC)\n\n` +
    `<i>Note: Payments are accepted in $ USD via Binance Pay & USDT (BEP20)!</i>`;

  await bot.editMessageText(chatId, messageId, text, {
    reply_markup: {
      inline_keyboard: [[{ text: userLang.btn_main, callback_data: 'nav_main' }]]
    }
  });
}

async function showAdminDashboard(chatId, userId, messageId = null) {
  const products = db.getProducts();
  const categories = db.getCategories();
  const isOffline = db.isMaintenanceMode();
  const statusBtnText = isOffline ? '🔴 Store Mode: MAINTENANCE (Turn ON)' : '🟢 Store Mode: ONLINE & ACTIVE (Turn OFF)';

  const channels = db.getRequiredChannels();
  const chanStatusStr = channels.length > 0 ? `(${channels.length} Active)` : `(None Set)`;

  const text = `<b>👑 RedNox Store Admin Dashboard</b>\n` +
    `👤 <b>Owner:</b> ${OWNER_HANDLE}\n` +
    `⚡ <b>Store Mode:</b> <b>${isOffline ? '🔴 MAINTENANCE MODE' : '🟢 ONLINE & ACTIVE'}</b>\n\n` +
    `📊 <b>Store Stats:</b>\n` +
    `- Total Sections: <b>${categories.length}</b>\n` +
    `- Total Products: <b>${products.length}</b>\n` +
    `- Required Channels: <b>${channels.length}</b>\n\n` +
    `Select an administrative action below:`;

  const keyboard = {
    inline_keyboard: [
      [{ text: statusBtnText, callback_data: 'admin_toggle_maintenance' }],
      [{ text: '🖼️ Set Welcome Banner Photo', callback_data: 'admin_set_welcome_photo' }],
      [{ text: '📥 Update APK Download Link', callback_data: 'admin_edit_apk_url' }],
      [{ text: `📢 Force Join Channels Settings ${chanStatusStr}`, callback_data: 'admin_manage_channels' }],
      [{ text: '📊 Sales Stats & Revenue Analytics', callback_data: 'admin_sales_analytics' }],
      [{ text: '📁 Create & Manage Sections', callback_data: 'admin_manage_sections' }],
      [{ text: '📦 Create New Product', callback_data: 'admin_add_prod_start' }, { text: '📑 Restock Stock (.txt)', callback_data: 'admin_restock_list' }],
      [{ text: '⚙️ Products, Prices & Stock Controls', callback_data: 'admin_manage_prods' }, { text: '💳 Edit Payment Accounts Info', callback_data: 'admin_edit_payments' }],
      [{ text: '🎛️ System Feature Toggles & Switches', callback_data: 'admin_feature_toggles_menu' }],
      [{ text: '✏️ Customize Menu Buttons (Rename Buttons)', callback_data: 'admin_rename_buttons_menu' }],
      [{ text: '💎 VIP Membership Tiers Settings', callback_data: 'admin_membership_settings_menu' }],
      [{ text: '🎟️ Manage Discount Coupons', callback_data: 'admin_coupons_menu' }],
      [{ text: '📢 Public Restock Channel Sync Settings', callback_data: 'admin_public_channel_menu' }],
      [{ text: '🎁 Create Gift Deposit Link ($100 / $50)', callback_data: 'admin_create_gift_link' }],
      [{ text: '💳 Customer Wallet Controls (Add / Deduct Balance)', callback_data: 'admin_user_balance_menu' }],
      [{ text: '🔌 ProdSeller API Settings & Balance', callback_data: 'admin_prodseller_menu' }],
      [{ text: '🔑 Binance Pay API Key & Secret', callback_data: 'admin_set_binance_api' }],
      [{ text: `⚡ Set Seller Bot Binance UID (${db.getSellerDepositAddress() || 'Not Set'})`, callback_data: 'admin_set_seller_deposit' }],
      [{ text: '📢 Broadcast Announcement to All', callback_data: 'admin_broadcast' }],
      [{ text: '🔙 Return to Customer Store View', callback_data: 'nav_main' }]
    ]
  };

  if (messageId) {
    await bot.editMessageText(chatId, messageId, text, { reply_markup: keyboard });
  } else {
    await bot.sendMessage(chatId, text, { reply_markup: keyboard });
  }
}
async function showAdminButtonRenameMenu(chatId, messageId) {
  const customLabels = db.getCustomButtonLabels();

  const btnProducts = customLabels.btn_products || '🛒 Products';
  const btnBalance = customLabels.btn_balance || '💳 My Balance';
  const btnSearch = customLabels.btn_search || '🔍 Search Item';
  const btnCoupon = customLabels.btn_coupon || '🎟️ Promo Coupon';
  const btnDeposit = customLabels.btn_deposit || '💰 Deposit Funds';
  const btnProfile = customLabels.btn_profile || '👤 My Profile';
  const btnVip = customLabels.btn_vip || '💎 VIP Membership Program';
  const btnLang = customLabels.btn_lang || '🌐 Language';
  const btnAdmin = customLabels.btn_admin || '👑 Admin Panel (Owner)';

  const text = `<b>✏️ CUSTOMIZE & RENAME MENU BUTTON LABELS</b>\n\n` +
    `<i>You can rename ANY button label in the bot's Main Menu according to your choice!</i>\n\n` +
    `<b>Current Main Menu Button Labels:</b>\n` +
    `1. 🛒 Products: <b>${btnProducts}</b>\n` +
    `2. 💳 My Balance: <b>${btnBalance}</b>\n` +
    `3. 🔍 Search Item: <b>${btnSearch}</b>\n` +
    `4. 🎟️ Promo Coupon: <b>${btnCoupon}</b>\n` +
    `5. 💰 Deposit Funds: <b>${btnDeposit}</b>\n` +
    `6. 👤 My Profile: <b>${btnProfile}</b>\n` +
    `7. 💎 VIP Membership: <b>${btnVip}</b>\n` +
    `8. 🌐 Language: <b>${btnLang}</b>\n` +
    `9. 👑 Admin Panel: <b>${btnAdmin}</b>\n\n` +
    `Select a button below to rename its label:`;

  const keyboard = [
    [{ text: `✏️ Rename Products Button (${btnProducts})`, callback_data: 'admin_rename_btn_btn_products' }],
    [{ text: `✏️ Rename Balance Button (${btnBalance})`, callback_data: 'admin_rename_btn_btn_balance' }],
    [{ text: `✏️ Rename Search Button (${btnSearch})`, callback_data: 'admin_rename_btn_btn_search' }],
    [{ text: `✏️ Rename Coupon Button (${btnCoupon})`, callback_data: 'admin_rename_btn_btn_coupon' }],
    [{ text: `✏️ Rename Deposit Button (${btnDeposit})`, callback_data: 'admin_rename_btn_btn_deposit' }],
    [{ text: `✏️ Rename Profile Button (${btnProfile})`, callback_data: 'admin_rename_btn_btn_profile' }],
    [{ text: `✏️ Rename VIP Button (${btnVip})`, callback_data: 'admin_rename_btn_btn_vip' }],
    [{ text: `✏️ Rename Language Button (${btnLang})`, callback_data: 'admin_rename_btn_btn_lang' }],
    [{ text: `✏️ Rename Admin Button (${btnAdmin})`, callback_data: 'admin_rename_btn_btn_admin' }],
    [{ text: '🔄 Reset All Buttons to Default', callback_data: 'admin_reset_btn_labels' }],
    [{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]
  ];

  await bot.editMessageText(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminUserBalanceMenu(chatId, messageId) {
  const text = `<b>💳 CUSTOMER WALLET BALANCE CONTROLS</b>\n\n` +
    `<i>You can add custom deposit funds to any customer's wallet or deduct/take back balance if extra credits were added by mistake!</i>\n\n` +
    `Select an action below:`;

  const keyboard = [
    [{ text: '➕ Add Balance / Credits to User', callback_data: 'admin_add_user_balance_start' }],
    [{ text: '➖ Deduct / Take Back Balance from User', callback_data: 'admin_deduct_user_balance_start' }],
    [{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]
  ];

  await bot.editMessageText(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminFeatureTogglesMenu(chatId, messageId) {
  const toggles = db.getFeatureToggles();
  const restockChannel = db.getPublicRestockChannel() || '❌ Not Set';
  const mode = db.getReferralRewardMode();

  let modeText = '🌟 ALL IN ONE (Cash + Coupons + Tiers Combined)';
  if (mode === 'cash') modeText = '💰 Cash Commission (5% Wallet Credit)';
  if (mode === 'coupon') modeText = '🎟️ Milestone Coupons (5, 10, 15 Refs)';
  if (mode === 'tier') modeText = '📈 Account Tier Discounts (3% - 20% OFF)';

  const text = `<b>🎛️ SYSTEM FEATURE TOGGLES & REWARD MODES</b>\n\n` +
    `<i>You can turn ON or OFF any feature and change Referral Reward Mode anytime according to your choice!</i>\n\n` +
    `• Discount Coupons: <b>${toggles.couponsEnabled ? '🟢 ON' : '🔴 OFF'}</b>\n` +
    `• Referral Program: <b>${toggles.referralsEnabled ? '🟢 ON' : '🔴 OFF'}</b>\n` +
    `• <b>👥 Active Referral Mode:</b> <b>${modeText}</b>\n` +
    `• Customer Ratings & Reviews: <b>${toggles.reviewsEnabled ? '🟢 ON' : '🔴 OFF'}</b>\n` +
    `• Public Restock Channel Sync: <b>${toggles.channelRestockEnabled ? '🟢 ON' : '🔴 OFF'} (${restockChannel})</b>\n` +
    `• Product Search Bar: <b>${toggles.searchEnabled ? '🟢 ON' : '🔴 OFF'}</b>\n` +
    `• Low Stock Alerts: <b>${toggles.lowStockAlertsEnabled ? '🟢 ON' : '🔴 OFF'}</b>\n\n` +
    `Click a button below to toggle a feature ON/OFF or switch Referral Mode:`;

  const keyboard = [
    [{ text: `🎟️ Discount Coupons: ${toggles.couponsEnabled ? '🟢 Enabled (Turn OFF)' : '🔴 Disabled (Turn ON)'}`, callback_data: 'admin_toggle_couponsEnabled' }],
    [{ text: `👥 Referral Program: ${toggles.referralsEnabled ? '🟢 Enabled (Turn OFF)' : '🔴 Disabled (Turn ON)'}`, callback_data: 'admin_toggle_referralsEnabled' }],
    [{ text: `🔄 Switch Referral Mode: ${modeText}`, callback_data: 'admin_switch_ref_mode' }],
    [{ text: `⭐️ Ratings & Reviews: ${toggles.reviewsEnabled ? '🟢 Enabled (Turn OFF)' : '🔴 Disabled (Turn ON)'}`, callback_data: 'admin_toggle_reviewsEnabled' }],
    [{ text: `📢 Channel Restock Sync: ${toggles.channelRestockEnabled ? '🟢 Enabled (Turn OFF)' : '🔴 Disabled (Turn ON)'}`, callback_data: 'admin_toggle_channelRestockEnabled' }],
    [{ text: `🔍 Product Search Bar: ${toggles.searchEnabled ? '🟢 Enabled (Turn OFF)' : '🔴 Disabled (Turn ON)'}`, callback_data: 'admin_toggle_searchEnabled' }],
    [{ text: `⚠️ Low Stock Alerts: ${toggles.lowStockAlertsEnabled ? '🟢 Enabled (Turn OFF)' : '🔴 Disabled (Turn ON)'}`, callback_data: 'admin_toggle_lowStockAlertsEnabled' }],
    [{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]
  ];

  await bot.editMessageText(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminMembershipSettingsMenu(chatId, messageId) {
  const tiers = db.getMembershipTiers();
  const toggles = db.getFeatureToggles();

  let tierStr = '';
  tiers.forEach((t, idx) => {
    tierStr += `${idx + 1}. <b>${t.name}</b> — Min Spent: <b>$${t.minSpent}</b> | Discount: <b>${t.discountPercent}% OFF</b>\n`;
  });

  const text = `<b>💎 VIP MEMBERSHIP TIERS MANAGER</b>\n\n` +
    `• Membership System: <b>${toggles.membershipEnabled ? '🟢 ON' : '🔴 OFF'}</b>\n\n` +
    `${tierStr}\n` +
    `<i>Customers automatically unlock higher tier discounts on all purchases based on their total spending ($)!</i>`;

  const keyboard = [
    [{ text: `💎 Membership System: ${toggles.membershipEnabled ? '🟢 Enabled (Turn OFF)' : '🔴 Disabled (Turn ON)'}`, callback_data: 'admin_toggle_membershipEnabled' }]
  ];

  tiers.forEach(t => {
    keyboard.push([{ text: `✏️ Edit ${t.name} (Min $${t.minSpent} / ${t.discountPercent}% OFF)`, callback_data: `admin_edit_tier_${t.key}` }]);
  });

  keyboard.push([{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]);

  await bot.editMessageText(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminCouponsMenu(chatId, messageId = null) {
  const coupons = db.getCoupons();
  let text = `🎟️ <b>PROMO COUPONS MANAGEMENT</b>\n\n` +
    `Create and manage discount promo coupons for store customers.\n\n` +
    `<b>Active Coupons (${coupons.length}):</b>\n`;

  if (coupons.length === 0) {
    text += `<i>No active coupons created yet.</i>\n`;
  } else {
    coupons.forEach((c, idx) => {
      text += `${idx + 1}. <b>${c.code}</b> — <b>${c.discountPercent}% OFF</b> (Used: ${c.usedCount || 0}/${c.maxUses || 100})\n`;
    });
  }

  const keyboard = [
    [{ text: '➕ 🎟️ Create New Coupon', callback_data: 'admin_create_coupon_start' }]
  ];

  coupons.forEach(c => {
    keyboard.push([{ text: `🗑️ Delete ${c.code}`, callback_data: `admin_del_coupon_${c.code}` }]);
  });

  keyboard.push([{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]);

  if (messageId) {
    try {
      const res = await bot.editMessageText(chatId, messageId, text, {
        reply_markup: { inline_keyboard: keyboard }
      });
      if (res && res.ok) return;
    } catch (e) {}
  }

  await bot.sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showMembershipMenu(chatId, userId, messageId = null) {
  const memData = db.getUserMembershipTier(userId);
  const currentTier = memData.currentTier;
  const tiers = memData.allTiers;

  let plansText = '';
  tiers.forEach(t => {
    const isCurrent = t.key === currentTier.key;
    const badge = isCurrent ? ' ← Current' : '';
    plansText += `${t.name}${badge}\n` +
      `${t.discountPercent}% discount · Min $${t.minSpent} spent\n`;
    
    t.perks.forEach(p => {
      plansText += `   • ${p}\n`;
    });
    plansText += `\n`;
  });

  const text = `💎 <b>Your Membership</b>\n\n` +
    `${currentTier.name} <b>Current tier: ${currentTier.name.replace(/[^a-zA-Z]/g, '').trim()}</b>\n` +
    `💵 <b>Total spent: $${memData.totalSpentUsd.toFixed(2)}</b>\n` +
    `📦 <b>Orders: ${memData.totalOrders}</b>\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📋 <b>All Plans:</b>\n\n` +
    `${plansText.trim()}\n\n` +
    `💡 <i>Spend more to unlock higher tiers and bigger discounts!</i>`;

  const keyboard = [
    [{ text: '🛒 Open Store Catalog', callback_data: 'nav_categories' }],
    [{ text: '🔙 Main Menu', callback_data: 'nav_main' }]
  ];

  if (messageId) {
    await bot.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
  } else {
    await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  }
}

async function showAdminProdSellerMenu(chatId, messageId = null) {
  const currentKey = db.getProdSellerApiKey();
  const maskKey = currentKey ? `${currentKey.slice(0, 8)}...${currentKey.slice(-6)}` : '❌ NOT SET';
  const balRes = await prodseller.getBalance();

  let balText = '<i>Click Refresh Balance below or Set API Key</i>';
  if (balRes.ok && balRes.data) {
    balText = `💰 <b>Supplier Balance:</b> <code>$${balRes.data.balance.toFixed(2)} USD</code>\n` +
      `🏅 <b>Membership Tier:</b> <b>${String(balRes.data.membership || 'standard').toUpperCase()}</b>\n` +
      `👤 <b>Supplier Account:</b> ${balRes.data.username ? '@' + balRes.data.username : balRes.data.telegramId}`;
  } else if (balRes.error) {
    balText = `⚠️ <b>Balance Check:</b> <code>${balRes.error}</code>`;
  }

  const sellerDepositTarget = db.getSellerDepositAddress() || '❌ NOT SET';

  const text = `<b>🔌 PRODSELLER API AUTOMATION MANAGER</b>\n\n` +
    `🔑 <b>API Key:</b> <code>${maskKey}</code>\n` +
    `⚡ <b>JIT Auto-Deposit Target:</b> <code>${sellerDepositTarget}</code>\n\n` +
    `${balText}\n\n` +
    `<i>Connect ProdSeller API to check supplier balance, auto-topup via Binance API, and auto-fulfill orders!</i>`;

  const keyboard = [
    [{ text: '⚡ Set Seller Bot Deposit Address / Pay ID', callback_data: 'admin_set_seller_deposit' }],
    [{ text: '🔄 📦 Restore & Sync All Supplier Products & Stock', callback_data: 'admin_prodseller_resync_all' }],
    [{ text: '📥 1-Click Auto-Import All Supplier Products', callback_data: 'admin_prodseller_do_import' }],
    [{ text: '🔑 Set / Update ProdSeller API Key', callback_data: 'admin_set_prodseller_key' }],
    [{ text: '🔄 Refresh Supplier Balance', callback_data: 'admin_prodseller_menu' }],
    [{ text: '📦 View Supplier Products Catalog', callback_data: 'admin_prodseller_import' }],
    [{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]
  ];

  if (messageId) {
    await bot.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
  } else {
    await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  }
}

async function showAdminChannelsMenu(chatId, messageId) {
  const channels = db.getRequiredChannels();
  const isEnabled = db.isForceJoinEnabled();

  let text = `<b>📢 FORCE JOIN TELEGRAM CHANNELS SETTINGS</b>\n\n` +
    `Status: <b>${isEnabled ? '🟢 ACTIVE (FORCE JOIN ENFORCED)' : '🔴 DISABLED (OPEN ACCESS)'}</b>\n\n` +
    `<i>Users cannot use the bot without joining all channels listed below:</i>\n\n`;

  if (channels.length === 0) {
    text += `<i>No channels added yet. Click <b>➕ Add Channel Link</b> to set up your channel!</i>\n`;
  } else {
    channels.forEach((c, idx) => {
      text += `${idx + 1}. 📢 <b>${c.name}</b> (${c.username})\n   🔗 Link: <code>${c.link}</code>\n\n`;
    });
  }

  const toggleBtnText = isEnabled ? '🔴 🔒 Turn Force Join OFF' : '🟢 🔒 Turn Force Join ON';

  const keyboard = [
    [{ text: '➕ 📢 Add Channel Link / Username', callback_data: 'admin_add_channel' }],
    [{ text: toggleBtnText, callback_data: 'admin_toggle_force_join' }]
  ];

  channels.forEach(c => {
    keyboard.push([{ text: `❌ 📢 Delete Channel: ${c.name}`, callback_data: `admin_del_chan_${c.id}` }]);
  });

  keyboard.push([{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]);

  await bot.editMessageText(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminSectionMenu(chatId, messageId) {
  const categories = db.getCategories();
  let text = `<b>📁 SECTION & FOLDER MANAGEMENT MANAGER</b>\n\n` +
    `<i>You can create section folders or extract all products inside a folder out to main store catalog & delete the folder!</i>\n\n` +
    `<b>Existing Section Folders:</b>\n`;

  if (categories.length === 0) {
    text += `<i>No section folders created yet. All products are listed in Main Catalog.</i>\n`;
  } else {
    categories.forEach((c, idx) => {
      const prodsInCat = db.getProducts(c.id);
      text += `${idx + 1}. 📁 <b>${c.name}</b> (${prodsInCat.length} Products Inside)\n`;
    });
  }

  const keyboard = [
    [{ text: '➕ 📁 Create New Section Folder', callback_data: 'admin_add_section' }]
  ];

  categories.forEach(c => {
    const count = db.getProducts(c.id).length;
    keyboard.push([
      { text: `📤 Extract Products Out & Delete Folder: ${c.name} (${count})`, callback_data: `admin_extract_section_${c.id}` }
    ]);
    keyboard.push([
      { text: `🗑️ Delete Folder + Delete Products: ${c.name}`, callback_data: `admin_del_section_${c.id}` }
    ]);
  });

  keyboard.push([{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]);

  await bot.editMessageText(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminSelectSectionForNewProduct(chatId, messageId) {
  const categories = db.getCategories();
  if (categories.length === 0) {
    await bot.editMessageText(chatId, messageId, `❌ No sections available. Please create a section first!`, {
      reply_markup: {
        inline_keyboard: [[{ text: '➕ 📁 Create New Section', callback_data: 'admin_add_section' }], [{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]]
      }
    });
    return;
  }

  const keyboard = categories.map(c => ([
    { text: `📁 📦 Add to: ${c.name}`, callback_data: `admin_prod_sec_select_${c.id}` }
  ]));
  keyboard.push([{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]);

  await bot.editMessageText(chatId, messageId, `<b>📁 Select Section for New Product:</b>`, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminRestockProductList(chatId, messageId) {
  const products = db.getProducts();
  if (products.length === 0) {
    await bot.editMessageText(chatId, messageId, `No products found to restock. Add a product first!`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]] }
    });
    return;
  }

  const keyboard = products.map(p => ([
    { text: `➕ 📑 Restock ${p.name} (Current Stock: ${p.stock})`, callback_data: `admin_restock_prod_${p.id}` }
  ]));
  keyboard.push([{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]);

  await bot.editMessageText(chatId, messageId, `<b>📦 Select a product to upload .txt stock file / add keys:</b>`, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminEditPaymentsMenu(chatId, messageId) {
  const text = `<b>⚙️ 💳 Edit Payment Accounts Info:</b>`;
  const keyboard = [
    [{ text: '🟡 ⚡ Edit Binance Pay ID', callback_data: 'admin_set_pay_binance_pay' }],
    [{ text: '💎 🌐 Edit USDT BEP20 (BSC) Address', callback_data: 'admin_set_pay_usdt_bep20' }],
    [{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]
  ];

  await bot.editMessageText(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminManageProducts(chatId, messageId) {
  const products = db.getProducts();
  if (products.length === 0) {
    await bot.editMessageText(chatId, messageId, `No products found. Add some!`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Admin Dashboard', callback_data: 'admin_dashboard' }]] }
    });
    return;
  }

  let text = `<b>⚙️ Product, Price & Stock Management:</b>\nSelect an action for a product below:\n\n`;
  const keyboard = [];

  products.forEach(p => {
    keyboard.push([{ text: `➖ 📑 Deduct Stock & Export .txt (${p.stock}): ${p.name}`, callback_data: `admin_reduce_stock_prod_${p.id}` }]);
    keyboard.push([{ text: `✏️ 💰 Change Price ($${p.price.toFixed(2)}): ${p.name}`, callback_data: `admin_edit_price_${p.id}` }]);
    keyboard.push([{ text: `🔴 🗑️ Clear Stock & Export .txt: ${p.name}`, callback_data: `admin_clear_stock_${p.id}` }]);
    keyboard.push([{ text: `❌ 🗑️ Delete Product: ${p.name}`, callback_data: `admin_del_prod_${p.id}` }]);
  });

  keyboard.push([{ text: '🔙 👑 Admin Dashboard', callback_data: 'admin_dashboard' }]);

  await bot.editMessageText(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function rejectOrder(chatId, messageId, orderId) {
  const order = db.updateOrderStatus(orderId, 'rejected');
  if (!order) return;

  await bot.sendMessage(order.userId, `<b>❌ Order #${order.id} Verification Failed</b>\n\n` +
    `Your payment receipt could not be verified. Please contact store owner ${OWNER_HANDLE} if you believe this is an error.`);

  await bot.sendMessage(chatId, `❌ Order #${order.id} has been REJECTED.`);
}

async function broadcastRestockNotification(productName, addedQty, currentStock, unitPriceUsd) {
  const allUsers = Object.keys(db.data.users);
  const formattedMsg = `<b>New Stock Add</b>\n\n` +
    `☁️ <b>${productName}</b>\n` +
    `➕ <b>Added: ${addedQty}</b>\n` +
    `📦 <b>Current stock: ${currentStock}</b>\n` +
    `💵 <b>Unit price: $${unitPriceUsd.toFixed(2)}</b>\n\n` +
    `✨ <i>Fresh stock just added from supplier! Open store catalog now to grab yours before stock runs out! 🚀</i>`;

  let sentCount = 0;
  for (const uid of allUsers) {
    try {
      await bot.sendMessage(uid, formattedMsg, {
        reply_markup: {
          inline_keyboard: [[{ text: '🛍️ Open Store Catalog', callback_data: 'nav_categories' }]]
        }
      });
      sentCount++;
    } catch (e) {
      console.error(`Failed restock broadcast to ${uid}:`, e.message);
    }
  }

  console.log(`Automated restock broadcast sent to ${sentCount} users.`);
}

async function processBroadcast(adminChatId, broadcastText) {
  const allUsers = Object.keys(db.data.users);
  let sentCount = 0;

  for (const uid of allUsers) {
    try {
      await bot.sendMessage(uid, `<b>📢 STORE ANNOUNCEMENT</b>\n\n${broadcastText}`);
      sentCount++;
    } catch (e) {
      console.error(`Failed to send broadcast to ${uid}:`, e.message);
    }
  }

  await bot.sendMessage(adminChatId, `✅ <b>Broadcast Completed!</b> Sent to ${sentCount} users.`);
}

async function resyncAndRestoreSupplierCatalog(chatId, userId) {
  try {
    await bot.sendMessage(chatId, `🔄 <b>Connecting to ProdSeller Live Supplier API...</b>\n\n<i>Fetching full supplier catalog and real-time stock balances...</i>`);
    
    const res = await prodseller.getProducts();
    if (!res.ok || !Array.isArray(res.products)) {
      await bot.sendMessage(chatId, `❌ <b>Supplier Sync Failed:</b>\n<code>${res.error || 'Failed to fetch supplier products'}</code>\n\n<i>Please check your ProdSeller API Key or try again in a few minutes.</i>`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 ProdSeller Manager', callback_data: 'admin_prodseller_menu' }]] }
      });
      return;
    }

    const supplierProducts = res.products;
    const supplierProductIds = new Set(supplierProducts.map(p => p.id));
    let updatedStockCount = 0;
    let totalStockCount = 0;

    // Step 1: Ensure all supplier products exist locally (restore deleted ones)
    db.importProdSellerProducts(supplierProducts, 20);
    const localProds = db.getProducts();

    // Step 2: Fetch exact real-time live stock for each product with polite delay
    for (let i = 0; i < supplierProducts.length; i++) {
      const p = supplierProducts[i];
      await new Promise(resolve => setTimeout(resolve, 250)); // Polite spacing to prevent 429 rate limit
      
      const detailRes = await prodseller.getProductDetails(p.id);
      if (detailRes.ok && detailRes.product && typeof detailRes.product.stock === 'number') {
        const liveStock = detailRes.product.stock;
        const matchingLocal = localProds.find(lp => lp.prodsellerProductId === p.id || lp.name.toLowerCase() === p.name.toLowerCase());
        if (matchingLocal) {
          matchingLocal.stock = liveStock;
          matchingLocal.inStock = liveStock > 0;
          matchingLocal.wholesaleCost = p.price;
          updatedStockCount++;
          totalStockCount += liveStock;
        }
      }
    }

    // Step 3: Check for delisted supplier products and mark out of stock
    localProds.forEach(lp => {
      if (lp.prodsellerProductId && !supplierProductIds.has(lp.prodsellerProductId)) {
        lp.stock = 0;
        lp.inStock = false;
      }
    });

    db.save();

    await bot.sendMessage(chatId, `✅ <b>SUPPLIER CATALOG RESTORED & 100% SYNCED!</b> 🎉\n\n` +
      `📦 <b>Total Supplier Products:</b> <b>${supplierProducts.length} Items</b>\n` +
      `🔄 <b>Live Stock Synchronized:</b> <b>${updatedStockCount} Products</b>\n` +
      `📊 <b>Total Stock Available in Store:</b> <b>${totalStockCount} Units</b>\n\n` +
      `✨ <i>All deleted or modified supplier items have been fully restored and aligned 1:1 with your live ProdSeller board!</i>`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛍️ View Customer Store Catalog', callback_data: 'nav_categories' }],
            [{ text: '🔙 ProdSeller Manager', callback_data: 'admin_prodseller_menu' }]
          ]
        }
      });
  } catch (err) {
    console.error('Error in resyncAndRestoreSupplierCatalog:', err);
    await bot.sendMessage(chatId, `❌ <b>Error during restore & sync:</b>\n<code>${err.message}</code>`);
  }
}

let lastSupplierProductState = {};
let isFirstSupplierPoll = true;

async function pollSupplierStockChanges() {
  try {
    const apiKey = prodseller.getApiKey();
    if (!apiKey) return;

    const res = await prodseller.getProducts();
    if (!res.ok || !Array.isArray(res.products)) {
      if (res.error && (res.error.includes('requêtes') || res.error.includes('API'))) {
        console.warn('⚠️ ProdSeller API Rate Limited. Poller holding current live stock levels until limit clears.');
      }
      return; // CRITICAL RATE-LIMIT GUARD: DO NOT TOUCH EXISTING STOCK IF API CALL FAILS OR RATE-LIMITED!
    }

    let allLocalProds = db.getProducts();
    const activeSupplierIds = new Set(res.products.map(p => p.id));

    for (const p of res.products) {
      await new Promise(resolve => setTimeout(resolve, 250)); // Polite spacing between item calls
      let localProd = allLocalProds.find(lp => lp.prodsellerProductId === p.id || lp.name.toLowerCase() === p.name.toLowerCase());

      const detailRes = await prodseller.getProductDetails(p.id);
      if (!detailRes.ok || !detailRes.product || typeof detailRes.product.stock !== 'number') {
        continue; // Skip updating individual product if single call fails or rate limited
      }

      const newStock = detailRes.product.stock;

      // AUTO-DISCOVERY & AUTO-IMPORT OF NEW SUPPLIER PRODUCTS
      if (!localProd) {
        console.log(`✨ NEW SUPPLIER PRODUCT DISCOVERED: ${p.name} (ID: ${p.id}, Stock: ${newStock})`);
        db.importProdSellerProducts([p], 20);
        allLocalProds = db.getProducts();
        localProd = allLocalProds.find(lp => lp.prodsellerProductId === p.id || lp.name.toLowerCase() === p.name.toLowerCase());

        if (localProd) {
          localProd.stock = newStock;
          localProd.inStock = newStock > 0;
        }

        lastSupplierProductState[p.id] = newStock;
        db.save();

        if (!isFirstSupplierPoll) {
          setImmediate(() => {
            broadcastNewProductAlert(p.name, newStock, localProd ? localProd.price : (p.price * 1.2));
          });
        }
        continue;
      }

      // UPDATE EXISTING PRODUCT STOCK IN REAL TIME
      const oldStock = typeof localProd.stock === 'number' ? localProd.stock : 0;
      const prevState = lastSupplierProductState[p.id];

      if (prevState !== undefined && newStock !== oldStock) {
        if (newStock > oldStock) {
          const addedQty = newStock - oldStock;
          console.log(`📈 Stock Restocked for [${localProd.name}]: +${addedQty} (New Total: ${newStock})`);
          if (!isFirstSupplierPoll) {
            setImmediate(() => {
              broadcastSupplierRestockAlert(localProd.name, addedQty, newStock, localProd.price);
            });
          }
        } else if (newStock < oldStock) {
          console.log(`📉 Stock Decreased for [${localProd.name}]: ${oldStock} -> ${newStock}`);
        }
      }

      localProd.stock = newStock;
      localProd.inStock = newStock > 0;
      lastSupplierProductState[p.id] = newStock;
    }

    // Set delisted products to out of stock
    allLocalProds.forEach(lp => {
      if (lp.prodsellerProductId && !activeSupplierIds.has(lp.prodsellerProductId) && lp.stock > 0) {
        lp.stock = 0;
        lp.inStock = false;
      }
    });

    db.save();
    isFirstSupplierPoll = false;
  } catch (e) {
    console.error('Error polling supplier stock:', e.message);
  }
}

// Start polling supplier stock every 60 seconds (Rate-Limit Safe Live Sync)
setInterval(pollSupplierStockChanges, 60000);

async function broadcastNewProductAlert(productName, stockQty, retailPrice) {
  const allUsers = Object.keys(db.data.users || {});
  const stockBadge = stockQty > 0 ? `🟢 ${stockQty} in stock` : `🔴 Out of stock`;

  const msg = `✨ <b>NEW SUPPLIER PRODUCT AUTO-ADDED TO STORE!</b> 🚀\n\n` +
    `📦 <b>New Product:</b> <b>${productName}</b>\n` +
    `📊 <b>Available Stock:</b> ${stockBadge}\n` +
    `💵 <b>Unit Price:</b> <b>$${retailPrice.toFixed(2)} USD</b>\n\n` +
    `✨ <i>New item automatically added from supplier! Open store catalog now to check it out! 🚀</i>`;

  const keyboard = {
    inline_keyboard: [[{ text: '🛍️ Open Store Catalog', callback_data: 'nav_categories' }]]
  };

  let sentCount = 0;
  for (const uid of allUsers) {
    try {
      await bot.sendMessage(uid, msg, { reply_markup: keyboard });
      sentCount++;
    } catch (e) {}
  }
  console.log(`New product discovery broadcast sent to ${sentCount} users.`);
}

async function broadcastSupplierRestockAlert(productName, addedQty, currentTotalStock, retailPrice) {
  const allUsers = Object.keys(db.data.users || {});
  const msg = `<b>New Stock Add</b>\n\n` +
    `☁️ <b>${productName}</b>\n` +
    `➕ <b>Added: ${addedQty}</b>\n` +
    `📦 <b>Current stock: ${currentTotalStock}</b>\n` +
    `💵 <b>Unit price: $${retailPrice.toFixed(2)}</b>\n\n` +
    `✨ <i>Fresh stock just added from supplier! Open store catalog now to grab yours before stock runs out! 🚀</i>`;

  const keyboard = {
    inline_keyboard: [[{ text: '🛍️ Open Store Catalog', callback_data: 'nav_categories' }]]
  };

  let sentCount = 0;
  for (const uid of allUsers) {
    try {
      await bot.sendMessage(uid, msg, { reply_markup: keyboard });
      sentCount++;
    } catch (e) {}
  }
  console.log(`Automated restock broadcast (+${addedQty}) sent to ${sentCount} users.`);

  if (db.isFeatureEnabled('channelRestockEnabled')) {
    const publicChannel = db.getPublicRestockChannel();
    if (publicChannel) {
      try {
        const botUsername = (await bot.getMe())?.username || 'RednoxSellerbot';
        await bot.sendMessage(publicChannel, msg, {
          reply_markup: {
            inline_keyboard: [[{ text: '🛍️ Buy in Store Bot', url: `https://t.me/${botUsername}?start=nav_cat` }]]
          }
        });
        console.log(`Posted restock alert to public channel: ${publicChannel}`);
      } catch (e) {
        console.error(`Failed to post restock to public channel ${publicChannel}:`, e.message);
      }
    }
  }
}

bot.getMe().then(me => {
  console.log('===================================================');
  console.log(`🚀 STORE BOT ONLINE (100% AUTOMATED BINANCE API VERIFICATION ACTIVE): @${me.username} (${me.first_name})`);
  console.log(`👑 Store Owner: ${OWNER_HANDLE}`);
  console.log(`🟡 Real-Time Binance API Key & Secret Verification Active`);
  console.log('===================================================');

  bot.setMyCommands([
    { command: 'start', description: '🏠 Open Main Store Menu' }
  ]).then(() => {
    console.log('✅ Telegram Left-Side Menu Commands registered successfully!');
  }).catch(e => console.error('Failed to set bot commands:', e));

  bot.startPolling(1500);
}).catch(err => {
  console.error('Failed to start bot:', err);
});
