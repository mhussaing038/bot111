const TOKEN = process.env.BOT_TOKEN || '8865356602:AAHeznrx601gqVkDc-wWK3rPq4mxKSKpJdo';
const BASE_URL = `https://tg-api-proxy.vercel.app/bot${TOKEN}`;
const FILE_BASE_URL = `https://tg-api-proxy.vercel.app/file/bot${TOKEN}`;

class TelegramClient {
  constructor(token) {
    this.token = token || TOKEN;
    this.baseUrl = `https://tg-api-proxy.vercel.app/bot${this.token}`;
    this.fileBaseUrl = `https://tg-api-proxy.vercel.app/file/bot${this.token}`;
    this.offset = 0;
    this.isPolling = false;
    this.handlers = [];
  }

  async request(method, params = {}) {
    try {
      const queryParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          queryParams.append(key, typeof value === 'object' ? JSON.stringify(value) : value);
        }
      }
      const url = `${this.baseUrl}/${method}?${queryParams.toString()}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.ok) {
        console.error(`Telegram API Error in ${method}:`, data.description || data);
      }
      return data;
    } catch (err) {
      console.error(`Network Error in ${method}:`, err.message);
      return { ok: false, error: err.message };
    }
  }

  async getMe() {
    return this.request('getMe');
  }

  async setMyCommands(commands) {
    return this.request('setMyCommands', { commands });
  }

  async getChatMember(chatId, userId) {
    return this.request('getChatMember', { chat_id: chatId, user_id: userId });
  }

  async getFile(fileId) {
    return this.request('getFile', { file_id: fileId });
  }

  async downloadFileText(filePath) {
    try {
      const url = `${this.fileBaseUrl}/${filePath}`;
      const res = await fetch(url);
      return await res.text();
    } catch (err) {
      console.error('Error downloading file:', err.message);
      return '';
    }
  }

  async sendMessage(chatId, text, options = {}) {
    return this.request('sendMessage', {
      chat_id: chatId,
      text: text,
      parse_mode: options.parse_mode || 'HTML',
      reply_markup: options.reply_markup,
      disable_web_page_preview: options.disable_web_page_preview || false
    });
  }

  async editMessageText(chatId, messageId, text, options = {}) {
    const res = await this.request('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: options.parse_mode || 'HTML',
      reply_markup: options.reply_markup
    });

    if (!res.ok) {
      const desc = (res.description || '').toLowerCase();
      if (desc.includes('not modified')) {
        return res;
      }
      if (text && text.length <= 1000) {
        const capRes = await this.request('editMessageCaption', {
          chat_id: chatId,
          message_id: messageId,
          caption: text,
          parse_mode: options.parse_mode || 'HTML',
          reply_markup: options.reply_markup
        });
        if (capRes.ok) {
          return capRes;
        }
      }
      try {
        await this.deleteMessage(chatId, messageId);
      } catch (e) {}
      return this.sendMessage(chatId, text, options);
    }
    return res;
  }

  async deleteMessage(chatId, messageId) {
    return this.request('deleteMessage', {
      chat_id: chatId,
      message_id: messageId
    });
  }

  async sendPhoto(chatId, photo, options = {}) {
    try {
      if (typeof photo === 'string' && (photo.startsWith('http://') || photo.startsWith('https://') || photo.length > 80)) {
        return this.request('sendPhoto', {
          chat_id: chatId,
          photo: photo,
          caption: options.caption || '',
          parse_mode: options.parse_mode || 'HTML',
          reply_markup: options.reply_markup
        });
      }
      
      const fs = require('fs');
      const fileBuffer = typeof photo === 'string' ? fs.readFileSync(photo) : photo;
      const formData = new FormData();
      formData.append('chat_id', chatId);
      const blob = new Blob([fileBuffer], { type: 'image/png' });
      formData.append('photo', blob, 'banner.png');
      if (options.caption) formData.append('caption', options.caption);
      formData.append('parse_mode', 'HTML');
      if (options.reply_markup) formData.append('reply_markup', JSON.stringify(options.reply_markup));

      const res = await fetch(`${this.baseUrl}/sendPhoto`, {
        method: 'POST',
        body: formData
      });
      return await res.json();
    } catch (err) {
      console.error('Error sending photo:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async sendDocument(chatId, document, fileName = 'file.txt', options = {}) {
    try {
      if (typeof document === 'string') {
        return this.request('sendDocument', {
          chat_id: chatId,
          document: document,
          caption: options.caption || '',
          parse_mode: options.parse_mode || 'HTML',
          reply_markup: options.reply_markup
        });
      }

      const formData = new FormData();
      formData.append('chat_id', chatId);
      const blob = new Blob([document], { type: 'application/octet-stream' });
      formData.append('document', blob, fileName || 'Delivery_Items.txt');
      if (options.caption) formData.append('caption', options.caption);
      formData.append('parse_mode', 'HTML');
      if (options.reply_markup) formData.append('reply_markup', JSON.stringify(options.reply_markup));

      const res = await fetch(`${this.baseUrl}/sendDocument`, {
        method: 'POST',
        body: formData
      });
      return await res.json();
    } catch (err) {
      console.error('Error sending document:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
    return this.request('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text,
      show_alert: showAlert
    });
  }

  onUpdate(handler) {
    this.handlers.push(handler);
  }

  startPolling(intervalMs = 1500) {
    if (this.isPolling) return;
    this.isPolling = true;
    console.log('🤖 Telegram Bot Polling started for @RednoxSellerbot...');

    const processedCallbackIds = new Set();

    const poll = async () => {
      if (!this.isPolling) return;
      try {
        const res = await this.request('getUpdates', { offset: this.offset, timeout: 5 });
        if (res && res.ok && Array.isArray(res.result)) {
          for (const update of res.result) {
            this.offset = update.update_id + 1;

            if (update.message) {
              console.log(`📩 [Bot Event] User: @${update.message.from?.username || update.message.from?.id} => "${update.message.text}"`);
            } else if (update.callback_query) {
              console.log(`🔘 [Button Click] User: @${update.callback_query.from?.username || update.callback_query.from?.id} => "${update.callback_query.data}"`);
            }

            if (update.callback_query) {
              const cbId = update.callback_query.id;
              if (processedCallbackIds.has(cbId)) {
                continue;
              }
              processedCallbackIds.add(cbId);
              if (processedCallbackIds.size > 2000) {
                const firstKey = processedCallbackIds.values().next().value;
                processedCallbackIds.delete(firstKey);
              }
            }

            for (const handler of this.handlers) {
              // Execute handler asynchronously so a long-running action never blocks the polling loop for other users!
              Promise.resolve(handler(update)).catch(err => {
                console.error('Error handling update:', err);
              });
            }
          }
        }
      } catch (err) {
        console.error('Polling cycle error:', err.message);
      }
      if (this.isPolling) {
        setTimeout(poll, intervalMs);
      }
    };

    poll();
  }

  stopPolling() {
    this.isPolling = false;
    console.log('Bot Polling stopped.');
  }
}

module.exports = TelegramClient;
