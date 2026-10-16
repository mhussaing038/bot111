require('dotenv').config();
const express = require('express');
const { setupBot } = require('./bot');
const { getDB } = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;
const botToken = process.env.BOT_TOKEN || '8894279507:AAFNpYS81D70xZo_VFHd5lAiAZiDOFXwQvc';

// Healthcheck Route for Render / Railway Cloud Deploy
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #fff; height: 100vh;">
            <h1 style="color: #6366f1;">🤖 Telegram AI Subscriptions Selling Bot is LIVE!</h1>
            <p style="font-size: 1.2rem; color: #94a3b8;">Bot is actively running on Cloud Server and listening for Telegram user messages.</p>
            <div style="margin-top: 30px; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 10px; display: inline-block;">
                <p>🟢 <strong>Status:</strong> Online & Active 24/7</p>
            </div>
        </div>
    `);
});

async function startServerAndBot() {
    // 1. Initialize SQLite DB & Seed Products
    await getDB();

    // 2. Start HTTP Web Health Server (Required by Render)
    app.listen(PORT, () => {
        console.log(`==================================================`);
        console.log(`🚀 Web Service Health Listener active on Port ${PORT}`);
        console.log(`==================================================`);
    });

    // 3. Launch Telegraf Telegram Bot with Auto-Reconnect
    let currentBot = null;
    let isShuttingDown = false;

    async function launchPolling() {
        if (isShuttingDown) return;
        try {
            currentBot = setupBot(botToken);
            console.log(`🎉 SUCCESS: Telegram Bot (@Rednox_Selling_Bot) is LIVE and listening 24/7!`);
            await currentBot.launch({
                dropPendingUpdates: false,
                polling: { timeout: 10 }
            });
        } catch (err) {
            console.error('⚠️ Telegram Polling Notice:', err.message);
        }
        if (!isShuttingDown) {
            console.log('🔄 Reconnecting bot polling in 3 seconds...');
            setTimeout(launchPolling, 3000);
        }
    }

    launchPolling();

    process.once('SIGINT', () => {
        isShuttingDown = true;
        if (currentBot) currentBot.stop('SIGINT');
        process.exit(0);
    });
    process.once('SIGTERM', () => {
        isShuttingDown = true;
        if (currentBot) currentBot.stop('SIGTERM');
        process.exit(0);
    });
}

startServerAndBot();
