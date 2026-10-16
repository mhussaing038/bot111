const crypto = require('crypto');

class BinancePayVerifier {
  constructor(apiKey = '', apiSecret = '') {
    this.apiKey = (apiKey || process.env.BINANCE_API_KEY || '').trim();
    this.apiSecret = (apiSecret || process.env.BINANCE_API_SECRET || '').trim();
  }

  isConfigured() {
    return this.apiKey.length > 10 && this.apiSecret.length > 10;
  }

  generateHmacSignature(queryString) {
    return crypto.createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  generatePaySignature(payload, timestamp, nonce) {
    const message = `${timestamp}\n${nonce}\n${payload}\n`;
    return crypto.createHmac('sha512', this.apiSecret)
      .update(message)
      .digest('hex')
      .toUpperCase();
  }

  // ----------------------------------------------------
  // REAL-TIME BSC BLOCKCHAIN TXHASH VERIFICATION
  // ----------------------------------------------------
  async verifyBscTxHash(txHash, expectedAmountUsd) {
    const cleanHash = String(txHash || '').trim().toLowerCase();

    // BSC TxHash Must start with 0x and be 66 characters long
    if (!cleanHash.startsWith('0x') || cleanHash.length !== 66 || !/^0x[0-9a-f]{64}$/.test(cleanHash)) {
      return {
        success: false,
        reason: `❌ <b>Invalid USDT BEP20 TxHash Format!</b>\n\nA valid BSC TxHash must start with <code>0x</code> and be exactly 66 characters long.\n\n<i>Example: <code>0x4a3b8c9d...</code></i>`
      };
    }

    // 1. Check Binance Official High-Speed RPC Node directly
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const rpcRes = await fetch('https://bsc-dataseed1.binance.org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getTransactionReceipt',
          params: [cleanHash]
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const rpcData = await rpcRes.json();

      if (rpcData && rpcData.result) {
        const receipt = rpcData.result;
        if (receipt.status === '0x1') {
          return {
            success: true,
            paidAmount: expectedAmountUsd,
            transactionId: cleanHash
          };
        } else if (receipt.status === '0x0') {
          return {
            success: false,
            reason: `❌ <b>BSC Blockchain Transaction Failed!</b>\n\nThis TxHash (<code>${cleanHash}</code>) reverted or failed on BNB Smart Chain.`
          };
        }
      }
    } catch (err) {
      console.error('Binance BSC RPC Error:', err.message);
    }

    // 2. Check BscScan API as secondary verification
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(`https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${cleanHash}`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const data = await res.json();

      if (data && data.result) {
        const receipt = data.result;

        if (receipt.status === '0x1') {
          return {
            success: true,
            paidAmount: expectedAmountUsd,
            transactionId: cleanHash
          };
        } else if (receipt.status === '0x0') {
          return {
            success: false,
            reason: `❌ <b>BSC Blockchain Transaction Failed!</b>\n\nThis TxHash (<code>${cleanHash}</code>) failed or reverted on the BSC network.`
          };
        }
      }
    } catch (err) {
      console.error('BSC Blockchain API Error:', err.message);
    }

    // 3. Check Binance SAPI Deposit History
    if (this.isConfigured()) {
      try {
        let timestamp = Date.now();
        try {
          const timeRes = await fetch('https://api.binance.com/api/v3/time');
          const timeData = await timeRes.json();
          if (timeData && timeData.serverTime) timestamp = timeData.serverTime;
        } catch (e) {}

        const query = `coin=USDT&recvWindow=60000&timestamp=${timestamp}`;
        const signature = this.generateHmacSignature(query);

        const depRes = await fetch(`https://api.binance.com/sapi/v1/capital/deposit/hisrec?${query}&signature=${signature}`, {
          headers: { 'X-MBX-APIKEY': this.apiKey }
        });
        const depData = await depRes.json();

        if (Array.isArray(depData)) {
          const match = depData.find(d => {
            const tx = String(d.txId || '').toLowerCase();
            return tx === cleanHash || tx.includes(cleanHash);
          });

          if (match) {
            const depAmount = parseFloat(match.amount || 0);
            if (match.status === 1) { // 1 = success
              if (depAmount >= expectedAmountUsd) {
                return {
                  success: true,
                  paidAmount: depAmount,
                  transactionId: cleanHash
                };
              } else {
                return {
                  success: false,
                  reason: `❌ <b>Incomplete USDT BEP20 Payment!</b>\n\nRequired: <b>$${expectedAmountUsd.toFixed(2)} USDT</b>\nReceived: <b>$${depAmount.toFixed(2)} USDT</b>`
                };
              }
            }
          }
        }
      } catch (err) {
        console.error('Binance Deposit History API Error:', err.message);
      }
    }

    return {
      success: false,
      reason: `❌ <b>USDT BEP20 TxHash Not Found Yet!</b>\n\nThe transaction <code>${cleanHash}</code> is still pending or not yet mined on the BNB Smart Chain.`
    };
  }

  // ----------------------------------------------------
  // REAL-TIME BINANCE API PAYMENT VERIFICATION
  // ----------------------------------------------------
  async verifyTransaction(transactionId, expectedAmountUsd) {
    const cleanTrxId = String(transactionId || '').trim();

    if (cleanTrxId.startsWith('0x')) {
      return await this.verifyBscTxHash(cleanTrxId, expectedAmountUsd);
    }

    if (!cleanTrxId || cleanTrxId.length < 6 || cleanTrxId.length > 64 || /\s/.test(cleanTrxId)) {
      return {
        success: false,
        reason: '❌ <b>Invalid Transaction ID Format!</b>\nPlease enter a valid Binance Pay Transaction ID.'
      };
    }

    // Direct Binance SAPI Pay Query using API Key & Secret
    if (this.isConfigured()) {
      try {
        let timestamp = Date.now();
        try {
          const timeRes = await fetch('https://api.binance.com/api/v3/time');
          const timeData = await timeRes.json();
          if (timeData && timeData.serverTime) {
            timestamp = timeData.serverTime;
          }
        } catch (e) {}

        const queryStr = `recvWindow=60000&timestamp=${timestamp}`;
        const signature = this.generateHmacSignature(queryStr);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(`https://api.binance.com/sapi/v1/pay/transactions?${queryStr}&signature=${signature}`, {
          method: 'GET',
          headers: {
            'X-MBX-APIKEY': this.apiKey
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await res.json();

        if (data && (data.code === '000000' || data.success) && Array.isArray(data.data)) {
          const txList = data.data;
          const matchedTx = txList.find(tx => {
            const orderIdStr = String(tx.orderId || '');
            const tranIdStr = String(tx.transactionId || '');
            const transactionIdStr = String(tx.tranId || '');
            return orderIdStr === cleanTrxId || tranIdStr === cleanTrxId || transactionIdStr === cleanTrxId || orderIdStr.includes(cleanTrxId) || tranIdStr.includes(cleanTrxId);
          });

          if (matchedTx) {
            const paidAmount = Math.abs(parseFloat(matchedTx.amount || 0));
            if (paidAmount >= expectedAmountUsd) {
              return {
                success: true,
                paidAmount: paidAmount,
                transactionId: cleanTrxId
              };
            } else {
              return {
                success: false,
                reason: `❌ <b>Incomplete Payment Amount!</b>\n\nRequired: <b>$${expectedAmountUsd.toFixed(2)} USD</b>\nReceived: <b>$${paidAmount.toFixed(2)} USD</b>\n\nPlease transfer the remaining amount.`
              };
            }
          }
        }
      } catch (err) {
        console.error('Binance Pay API Verification Error:', err.message);
      }

      // Secondary Query: Binance Pay Merchant OpenAPI
      try {
        const timestamp = Date.now().toString();
        const nonce = crypto.randomBytes(16).toString('hex');
        const payloadObj = { merchantTradeNo: cleanTrxId };
        const payloadStr = JSON.stringify(payloadObj);
        const signature = this.generatePaySignature(payloadStr, timestamp, nonce);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const res = await fetch('https://bpay.binanceapi.com/binancepay/openapi/v2/order/query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'BinancePay-Timestamp': timestamp,
            'BinancePay-Nonce': nonce,
            'BinancePay-Certificate-SN': this.apiKey,
            'BinancePay-Signature': signature
          },
          body: payloadStr,
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await res.json();

        if (data && data.status === 'SUCCESS' && data.data) {
          const orderData = data.data;
          const paidStatus = (orderData.status || '').toUpperCase();
          const paidAmount = parseFloat(orderData.totalFee || orderData.amount || 0);

          if (paidStatus === 'PAID' || paidStatus === 'SUCCESS') {
            if (paidAmount >= expectedAmountUsd) {
              return { success: true, paidAmount, transactionId: cleanTrxId };
            }
          }
        }
      } catch (err) {
        console.error('Binance Merchant Pay API Error:', err.message);
      }
    }

    return {
      success: false,
      reason: `❌ <b>Transaction ID Not Found on Binance!</b>\n\nThe Transaction ID <code>${cleanTrxId}</code> could not be verified on your Binance account.\n\nPlease check your Binance Pay transaction history and enter the exact Transaction ID.`
    };
  }

  // ----------------------------------------------------
  // JUST-IN-TIME (JIT) BINANCE USDT PAYOUT / TRANSFER
  // ----------------------------------------------------
  async withdrawUsdt(amount, address, network = 'BSC') {
    if (!this.isConfigured()) return { success: false, error: 'Binance API not configured.' };
    try {
      let timestamp = Date.now();
      try {
        const timeRes = await fetch('https://api.binance.com/api/v3/time');
        const timeData = await timeRes.json();
        if (timeData && timeData.serverTime) timestamp = timeData.serverTime;
      } catch (e) {}

      const queryStr = `coin=USDT&network=${network}&address=${encodeURIComponent(address)}&amount=${parseFloat(amount).toFixed(2)}&recvWindow=60000&timestamp=${timestamp}`;
      const signature = this.generateHmacSignature(queryStr);

      const res = await fetch(`https://api.binance.com/sapi/v1/capital/withdraw/apply?${queryStr}&signature=${signature}`, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': this.apiKey
        }
      });
      const data = await res.json();
      if (res.ok && data.id) {
        return { success: true, txId: data.id };
      }
      return { success: false, error: data.msg || JSON.stringify(data) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = BinancePayVerifier;
