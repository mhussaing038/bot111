# 🚂 Railway.app Hosting Guide - RedNox Store Bot

Follow these simple steps to host your bot on **Railway.app** 24/7 without any issues!

---

### 📌 STEP 1: Upload Project to GitHub or Railway
1. Extract `RedNox_Store_Bot_Railway_Ready.zip` on your computer.
2. Go to [https://railway.app](https://railway.app) and sign in.
3. Click **"New Project"** -> Select **"Deploy from GitHub repo"** (or upload the folder via Railway CLI / Direct Upload).

---

### 📌 STEP 2: Configure Environment Variables in Railway
Inside your Railway Project Dashboard, go to **"Variables"** tab and add these key-value pairs:

| Variable Key | Value |
|---|---|
| `BOT_TOKEN` | `8865356602:AAHeznrx601gqVkDc-wWK3rPq4mxKSKpJdo` |
| `ADMIN_IDS` | `6506288872` |
| `OWNER_USERNAME` | `@Hussain_xd` |
| `BINANCE_PAY_ID` | `1245075177` |
| `BINANCE_ACCOUNT_NAME` | `M Hussain_XD` |
| `PRODSELLER_API_KEY` | `psk_be696fc735765f624c51887d06f0b7b607f8a85769a15e6a` |

---

### 📌 STEP 3: Deploy & Start 24/7
- Railway will automatically run `npm install` and `node bot.js` using `railway.json` and `Procfile`.
- Your bot will be **100% ONLINE 24/7** with automated Binance verification, ProdSeller API key delivery, and real-time stock sync!
