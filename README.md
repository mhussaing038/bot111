# 🤖 Telegram Selling Store Bot (RedNox E-Commerce Bot)

Full-featured, automated Telegram E-Commerce Store Bot built with Node.js. It features a complete customer shopping catalog, interactive inline keyboards, shopping cart, checkout wizard, order status notifications, and a powerful Admin Dashboard.

---

## 🚀 Quick Start Guide

### 1. Install Dependencies
Open terminal in this project directory:
```bash
npm install
```

### 2. Configure `.env`
Ensure your `.env` file contains your Bot Token:
```env
BOT_TOKEN=8648287870:AAGCjF-U0UEtnyIxxijyJOUZcMd7Co6_6Uw
ADMIN_ID=
PAYMENT_UPI=yourupi@upi
STORE_NAME=RedNox Online Shop
SECRET_ADMIN_PASS=admin123
```

### 3. Start the Bot
```bash
npm start
```

---

## 🔑 How to Claim Admin Rights
1. Open your Telegram App and search for your bot.
2. Send command: `/start`
3. To gain Admin Control Panel access, send:
   ```text
   /makeadmin admin123
   ```
4. Now type `/admin` to open the **Admin Control Panel**!

---

## 🛒 Features Included

### Customer Features:
- 📱 **Product Catalog**: Browse products organized by categories with photos, prices & descriptions.
- 🛍️ **Shopping Cart**: Real-time quantity adjustments, price totals & clear cart options.
- 🚀 **Checkout Flow**: Interactive steps for capturing customer phone number & delivery address.
- 💳 **Payment Modes**: Supports UPI / QR Code and Cash on Delivery (COD).
- 📋 **Order Tracking**: Customers can check status (`Pending`, `Paid`, `Processing`, `Shipped`, `Completed`).

### Admin Features (`/admin`):
- 📁 **Category Management**: Create & remove product categories.
- ➕ **Add Products**: Multi-step wizard to upload photos, title, price, description & stock count.
- 📋 **Order Management**: Receive instant notification for new orders with 1-click status updates (`Mark Paid`, `Mark Shipped`, `Mark Completed`).
- 📊 **Store Analytics**: Track total sales revenue (₹), total orders, and customer count.
- 📢 **Broadcast System**: Send global announcement messages/photos to all store users.

---

## 🛠️ File Structure

- `bot.js` - Main entry file.
- `src/index.js` - Bot initialization, event listeners & command routing.
- `src/database.js` - Database module managing products, categories, cart & orders.
- `src/store.js` - Store logic, product detail display, cart & checkout wizard.
- `src/admin.js` - Admin panel handlers, adding products, order status updates & analytics.
- `src/keyboards.js` - Dynamic inline keyboards & buttons markup.

---

## 🌐 Network Note (If ETIMEDOUT happens)
If your internet provider (ISP) blocks `api.telegram.org` on your local network:
1. Turn on a VPN (such as Cloudflare WARP 1.1.1.1).
2. Or host the bot on any server (Replit, Render, Railway, AWS, DigitalOcean, VPS) where Telegram API connects standardly.
