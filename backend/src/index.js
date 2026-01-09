import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Telegraf, Markup } from 'telegraf';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');

const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://example.netlify.app';

// Для старта без БД: храним настройки в памяти (обнулится при перезапуске)
const userSettings = new Map();

const app = express();
app.use(cors());
app.use(express.json());

// --- API ---
app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/settings/:telegramId', (req, res) => {
  const telegramId = String(req.params.telegramId);
  res.json(userSettings.get(telegramId) || { telegramId, city: null, profile: 'office' });
});

app.post('/api/settings', (req, res) => {
  const { telegramId, city, profile } = req.body || {};
  if (!telegramId) return res.status(400).json({ error: 'telegramId is required' });

  const data = {
    telegramId: String(telegramId),
    city: city ? String(city).trim() : null,
    profile: profile ? String(profile) : 'office'
  };

  userSettings.set(String(telegramId), data);
  res.json({ ok: true, data });
});

// --- Telegram bot ---
const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  const text =
    `MeteoVip\n\n` +
    `Откройте Mini App и выберите город/профиль оповещений.`;

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      Markup.button.webApp('Открыть MeteoVip', WEBAPP_URL)
    ])
  );
});

bot.command('id', (ctx) => ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`));

// Webhook vs long polling
const USE_WEBHOOK = (process.env.USE_WEBHOOK || 'true').toLowerCase() === 'true';

if (USE_WEBHOOK) {
  const publicUrl = process.env.RENDER_EXTERNAL_URL;
  if (!publicUrl) {
    console.warn('RENDER_EXTERNAL_URL not found. Webhook may not be set automatically.');
  }

  const webhookMiddleware = await bot.createWebhook({
    domain: publicUrl || undefined,
    path: '/telegram'
  });

  app.use(webhookMiddleware);
  app.post('/telegram', (req, res) => res.sendStatus(200));

  app.listen(PORT, () => {
    console.log(`API listening on ${PORT}`);
    console.log(`Webhook path: /telegram`);
  });
} else {
  bot.launch();
  app.listen(PORT, () => console.log(`API listening on ${PORT}`));

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
