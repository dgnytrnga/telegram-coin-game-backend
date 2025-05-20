require("dotenv").config();
const { Telegraf } = require("telegraf");
const { Pool } = require("pg");
const { v4: uuidv4 } = require("uuid");

const botToken = process.env.BOT_TOKEN;
const gameUrl = process.env.GAME_URL || "https://yourgameurl.com";
const channelUrl = process.env.CHANNEL_URL || "https://t.me/yourchannel";

if (!botToken) {
  console.error("Error! Bot Token not found! Please check your .env file.");
  process.exit(1);
}

const bot = new Telegraf(botToken);

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.connect()
  .then(() => console.log("Successfully connected to the database!"))
  .catch((err) => {
    console.error("Error! Could not connect to the database:", err);
    process.exit(1);
  });

// Create users table if it doesn't exist
pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username TEXT,
    coin_balance REAL DEFAULT 0,
    last_mining_start TIMESTAMP
  );
`);

pool.query(`
  CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY,
    referred_id BIGINT NOT NULL,
    referrer_id BIGINT NOT NULL
  );
`);

// Referral bonus system
async function addReferralBonus(referredId, referrerId) {
  try {
    const result = await pool.query("SELECT * FROM referrals WHERE referred_id = $1", [referredId]);
    if (result.rows.length > 0) {
      console.log(`User ${referredId} was already referred by ${referrerId}.`);
      return;
    }

    await pool.query("INSERT INTO referrals (id, referred_id, referrer_id) VALUES ($1, $2, $3)", [
      uuidv4(), referredId, referrerId,
    ]);

    await pool.query("UPDATE users SET coin_balance = coin_balance + 1 WHERE telegram_id = $1", [referrerId]);
    await pool.query("UPDATE users SET coin_balance = coin_balance + 1 WHERE telegram_id = $1", [referredId]);

    console.log(`Referral bonus applied: ${referredId} referred by ${referrerId}`);
  } catch (err) {
    console.error("Error in referral bonus:", err);
  }
}

// Start command
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || null;
  const referrerId = ctx.message.text.split(" ")[1];

  try {
    const userCheck = await pool.query("SELECT * FROM users WHERE telegram_id = $1", [telegramId]);
    if (userCheck.rows.length === 0) {
      await pool.query("INSERT INTO users (id, telegram_id, username) VALUES ($1, $2, $3)", [
        uuidv4(), telegramId, username,
      ]);

      if (referrerId && referrerId !== telegramId.toString()) {
        await addReferralBonus(telegramId, parseInt(referrerId));
      }
    }

    const shareLink = `https://t.me/${ctx.me}?start=${telegramId}`;
    const shareMessage = `Hey friends, check out this new crypto clicker game! 🚀\n\nSign up using this link and earn 1 bonus coin: ${shareLink}`;

    const welcomeMessage = `
🚀 *Welcome to the Game!*

💰 *Earn by Clicking:* Tap to collect coins  
⛏ *Mining:* Upgrade your cards to earn passive income  
👥 *Friends:* Invite others and earn referral bonuses  
🪙 *Token Distribution:* You’ll be notified when airdrops begin!

Need help? Just type /help
`;

    await ctx.replyWithMarkdown(welcomeMessage, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎮 Play Now", url: gameUrl }],
          [{ text: "📢 Join the Channel", url: channelUrl }],
          [{ text: "👥 Share Invite Link", url: shareLink }],
          [{ text: "⛏ Start Mining", callback_data: "start_mining" }],
        ],
      },
    });
    await ctx.reply(shareMessage);
  } catch (err) {
    console.error("Error in /start command:", err);
    ctx.reply("An error occurred. Please try again later.");
  }
});

// Help command
bot.command("help", (ctx) => {
  ctx.reply("Available Commands:\n/start - Start the bot\n/help - Show help\n/earncoin - Earn Coins\n/coin - View Coin Balance");
});

// Earn Coin
bot.command("earncoin", async (ctx) => {
  ctx.reply("Click the button below to earn coins!", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Earn Coin!", callback_data: "earn_coin" }],
      ],
    },
  });
});

// Coin balance
bot.command("coin", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    const result = await pool.query("SELECT coin_balance FROM users WHERE telegram_id = $1", [telegramId]);
    if (result.rows.length > 0) {
      const balance = result.rows[0].coin_balance;
      ctx.reply(`You currently have ${balance} coins.`);
    } else {
      ctx.reply("Account not found. Please register using /start.");
    }
  } catch (err) {
    console.error("Error in /coin command:", err);
    ctx.reply("An error occurred while fetching your coin balance.");
  }
});

// Callback actions
bot.on("callback_query", async (ctx) => {
  const telegramId = ctx.from.id;
  const action = ctx.callbackQuery.data;

  if (action === "earn_coin") {
    try {
      await pool.query("UPDATE users SET coin_balance = coin_balance + 1 WHERE telegram_id = $1", [telegramId]);
      ctx.reply("You earned 1 coin! 🎉");
    } catch (err) {
      console.error("Error earning coin:", err);
      ctx.reply("An error occurred, please try again.");
    }
  }

  if (action === "start_mining") {
    try {
      const userResult = await pool.query("SELECT * FROM users WHERE telegram_id = $1", [telegramId]);
      if (userResult.rows.length === 0) {
        ctx.reply("Account not found. Please register using /start.");
        return;
      }

      const user = userResult.rows[0];
      const now = new Date();
      const lastMiningStart = user.last_mining_start ? new Date(user.last_mining_start) : null;

      if (lastMiningStart && now - lastMiningStart < 24 * 60 * 60 * 1000) {
        ctx.reply("Mining already in progress. Please wait 24 hours.");
        return;
      }

      await pool.query("UPDATE users SET last_mining_start = $1 WHERE telegram_id = $2", [now, telegramId]);
      ctx.reply("Mining started! You will earn coins passively for 24 hours.");
    } catch (err) {
      console.error("Error starting mining:", err);
      ctx.reply("An error occurred while starting mining.");
    }
  }

  ctx.answerCbQuery();
});

// Passive mining loop
setInterval(async () => {
  try {
    const now = new Date();
    const result = await pool.query("SELECT * FROM users WHERE last_mining_start IS NOT NULL");

    for (const user of result.rows) {
      const lastStart = new Date(user.last_mining_start);
      const elapsed = now - lastStart;

      if (elapsed < 24 * 60 * 60 * 1000) {
        const increment = 0.24 / 720; // update every 5 seconds
        const newBalance = user.coin_balance + increment;

        await pool.query("UPDATE users SET coin_balance = $1 WHERE telegram_id = $2", [newBalance, user.telegram_id]);
        console.log(`Updated balance for user ${user.telegram_id}: ${newBalance}`);
      }
    }
  } catch (err) {
    console.error("Error updating mining balances:", err);
  }
}, 5000); // every 5 seconds

// Launch bot
bot.launch();
console.log("✅ Bot is running.");
