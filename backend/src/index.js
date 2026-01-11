// backend/src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Telegraf, Markup } from 'telegraf';
import { validateInitData } from './telegramInitData.js';

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
app.use(express.json());

// CORS
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/postman
      if (CORS_ORIGINS.length === 0) return cb(null, true);
      if (CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

// -------- Telegram initData middleware --------
function requireTelegramUser(req, res, next) {
  const headerValue = req.headers['x-telegram-init-data'];

  if (typeof headerValue === 'undefined') {
    return res.status(401).json({ error: 'X-Telegram-Init-Data header is required' });
  }

  if (typeof headerValue === 'string' && headerValue.trim().length === 0) {
    return res.status(401).json({ error: 'initData is empty (open WebApp via bot button)' });
  }

  try {
    const result = validateInitData(String(headerValue), BOT_TOKEN);
    if (!result.user?.id) return res.status(401).json({ error: 'No user in initData' });

    req.tg = { user: result.user, initData: result.data };
    next();
  } catch (e) {
    return res.status(401).json({ error: String(e?.message || e) });
  }
}

// -------- Память без БД --------
// telegramId -> { settings: { telegramId, city, profile }, location: { latitude, longitude, timezone, label } }
const userState = new Map();

// -------- Простые API --------
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.json({ ok: true, service: 'MeteoVip API' }));

// Настройки (город/профиль)
app.get('/api/settings', requireTelegramUser, (req, res) => {
  const telegramId = String(req.tg.user.id);
  const st = userState.get(telegramId);
  const base = { telegramId, city: null, profile: 'office' };
  res.json(st?.settings || base);
});

app.post('/api/settings', requireTelegramUser, (req, res) => {
  const telegramId = String(req.tg.user.id);
  const { city, profile } = req.body || {};

  const st = userState.get(telegramId) || {};
  const settings = {
    telegramId,
    city: city ? String(city).trim() : null,
    profile: profile ? String(profile) : 'office',
  };

  userState.set(telegramId, { ...st, settings });
  res.json({ ok: true, data: settings });
});

// Debug: кто я
app.get('/api/whoami', requireTelegramUser, (req, res) => {
  res.json({ ok: true, user: req.tg.user });
});

// -------- Open-Meteo утилиты --------
async function fetchJson(url) {
  // Node 18+ имеет глобальный fetch
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Upstream error ${r.status}`);
  return r.json();
}

async function geocodeCity(name) {
  const q = encodeURIComponent(name);
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=ru&format=json`;
  const data = await fetchJson(url);
  const item = data?.results?.[0];
  if (!item) return null;
  return {
    label: [item.name, item.admin1, item.country].filter(Boolean).join(', '),
    latitude: item.latitude,
    longitude: item.longitude,
    timezone: item.timezone || 'auto',
  };
}

async function forecastByCoords(lat, lon, timezone = 'auto') {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&timezone=${encodeURIComponent(timezone)}` +
    `&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code` +
    `&forecast_days=3`;

  return fetchJson(url);
}

// Погода по городу из настроек
app.get('/api/weather', requireTelegramUser, async (req, res) => {
  const telegramId = String(req.tg.user.id);
  const st = userState.get(telegramId) || {};
  const city = st?.settings?.city;

  if (!city) {
    return res.status(400).json({ error: 'City is not set. Save it via POST /api/settings {city, profile}.' });
  }

  const geo = await geocodeCity(city);
  if (!geo) return res.status(404).json({ error: `City not found: ${city}` });

  const forecast = await forecastByCoords(geo.latitude, geo.longitude, geo.timezone);
  res.json({ ok: true, city: geo.label, geo, forecast });
});

// (опционально) сохранить координаты с фронта
app.post('/api/location', requireTelegramUser, (req, res) => {
  const telegramId = String(req.tg.user.id);
  const { latitude, longitude, timezone, label } = req.body || {};

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'latitude and longitude must be numbers' });
  }

  const st = userState.get(telegramId) || {};
  const location = {
    latitude,
    longitude,
    timezone: timezone || 'auto',
    label: label ? String(label) : null,
  };

  userState.set(telegramId, { ...st, location });
  res.json({ ok: true, data: location });
});

// Погода по сохранённой локации
app.get('/api/weather/by-location', requireTelegramUser, async (req, res) => {
  const telegramId = String(req.tg.user.id);
  const st = userState.get(telegramId);
  const loc = st?.location;

  if (!loc) return res.status(400).json({ error: 'No saved location. POST /api/location first.' });

  const forecast = await forecastByCoords(loc.latitude, loc.longitude, loc.timezone || 'auto');
  res.json({ ok: true, location: loc, forecast });
});

// -------- Telegram bot --------
const bot = new Telegraf(BOT_TOKEN);

bot.start(async ctx => {
  const url = WEBAPP_URL; // фронт сам возьмёт initData через Telegram.WebApp.initData
  await ctx.reply(
    'Открой MeteoVip:',
    Markup.inlineKeyboard([Markup.button.webApp('Открыть приложение', url)])
  );
});

bot.command('app', async ctx => {
  await ctx.reply(
    'Приложение:',
    Markup.inlineKeyboard([Markup.button.webApp('Открыть', WEBAPP_URL)])
  );
});

// Важно: на Render лучше webhook. Локально проще polling.
async function startBotAndServer() {
  const useWebhook =
    String(process.env.USE_WEBHOOK || '').toLowerCase() === 'true' ||
    Boolean(process.env.RENDER_EXTERNAL_URL);

  if (useWebhook) {
    const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;
    if (!baseUrl) throw new Error('For webhook set RENDER_EXTERNAL_URL or WEBHOOK_URL');

    const secretPath = process.env.WEBHOOK_SECRET_PATH || '/telegraf';
    const webhookPath = `${secretPath}/${BOT_TOKEN}`;

    try {
      app.use(await bot.createWebhook({ domain: baseUrl, path: webhookPath }));
    await bot.telegram.setWebhook(`${baseUrl}${webhookPath}`);

    console.log('Telegraf webhook set to:', `${baseUrl}${webhookPath}`);
          } catch (err) {
        console.error('Failed to set webhook, will use polling:', err.message);
            // Continue without webhook - bot will still work
          }
  } else {
    await bot.launch();
    console.log('Telegraf launched with polling');
  }

  app.listen(PORT, () => console.log(`API listening on :${PORT}`));

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

startBotAndServer().catch(err => {
  console.error(err);
  process.exit(1);
});
