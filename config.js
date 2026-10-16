module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || '8865356602:AAHeznrx601gqVkDc-wWK3rPq4mxKSKpJdo',
  ADMIN_IDS: (process.env.ADMIN_IDS || '6506288872').split(','),
  OWNER_USERNAME: '@Hussain_xd',
  BINANCE_PAY_ID: '1245075177',
  BINANCE_ACCOUNT_NAME: 'M Hussain_XD',
  USDT_BEP20_ADDRESS: '0x1245075177BEP20AddressHolder',
  SELLER_DEPOSIT_PAY_ID: process.env.SELLER_DEPOSIT_PAY_ID || '825959351',
  DEFAULT_CURRENCY: 'USD',

  // Currency Exchange Rates against 1 USD
  EXCHANGE_RATES: {
    USD: 1.0,
    PKR: 278.5,
    INR: 83.9,
    EUR: 0.92,
    GBP: 0.78,
    AED: 3.67,
    SAR: 3.75,
    BDT: 117.5,
    RUB: 88.0,
    LKR: 302.0
  }
};
