import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Telegraf, Markup } from 'telegraf';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');

const PORT = Number(process.env.PORT || 3000);
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://example.netlify.app';

// CORS_ORIGINS="https://a.netlify.app,https://b.netlify.app"
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const app = express();

// ВАЖНО: для webhook Telegraf нужен JSON body
app.use(express.json());

// CORS
app.use(
  cors({
    origin: (origin, cb) => {
      // Запросы без Origin (curl, сервер-сервер) — разрешаем
      if (!origin) return cb(null, true);

      // Если список не задан — разрешаем всё (лучше задавать в проде!)
      if (CORS_ORIGINS.length === 0) return cb(null, true);

      // Разрешаем только перечисленные домены
      if (CORS_ORIGINS.includes(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

// --- Для старта без БД: храним настройки в памяти (обнулится при перезапуске)
const userSettings = new Map();

// --- API ---
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.json({ ok: true, service: 'MeteoVip API' }));

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
    profile: profile ? String(profile) : 'office',
  };

  userSettings.set(String(telegramId), data);
  res.json({ ok: true, data });
});

// --- Telegram bot ---
const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  const text = 'Привет! Это MeteoVip. Нажми кнопку ниже, чтобы открыть настройки.';

  // apiBase прокидываем в WebApp как параметр ?api=
  const apiBase =
    process.env.API_PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    '';

  const webappUrl = new URL(WEBAPP_URL);
  if (apiBase) webappUrl.searchParams.set('api', apiBase);

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      Markup.button.webApp('Открыть MeteoVip', webappUrl.toString()),
    ])
  );
});

bot.command('id', (ctx) => ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`));

// --- Webhook vs long polling ---
const USE_WEBHOOK = (process.env.USE_WEBHOOK || 'true').toLowerCase() === 'true';

async function start() {
  if (USE_WEBHOOK) {
    const publicUrl = process.env.RENDER_EXTERNAL_URL;
    const path = '/telegram';

    if (!publicUrl) {
      console.warn('USE_WEBHOOK=true but RENDER_EXTERNAL_URL not set. Falling back to polling.');
      await bot.launch();
    } else {
      // webhook endpoint
      app.post(path, (req, res) => bot.handleUpdate(req.body, res));

      // set webhook
      await bot.telegram.setWebhook(`${publicUrl}${path}`);
      console.log('Webhook set to', `${publicUrl}${path}`);
    }

    app.listen(PORT, () => console.log(`API listening on ${PORT}`));
  } else {
    // локально
    await bot.launch();
    app.listen(PORT, () => console.log(`API listening on ${PORT}`));
  }
}

start().catch((e) => {
  console.error('Fatal start error:', e);
  process.exit(1);
});

// корректное завершение (полезно локально)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
