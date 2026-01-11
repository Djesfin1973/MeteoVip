import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Telegraf, Markup } from 'telegraf';
import { validateInitData } from './telegramInitData.js';
import { PrismaClient } from '@prisma/client';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');

const PORT = Number(process.env.PORT || 3000);
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://example.netlify.app';

const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const app = express();
app.use(express.json());

const prisma = new PrismaClient();

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (CORS_ORIGINS.length === 0) return cb(null, true);
      if (CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

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

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.json({ ok: true, service: 'MeteoVip API' }));

app.get('/api/settings', requireTelegramUser, async (req, res) => {
  const telegramId = String(req.tg.user.id);

  const user = await prisma.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      username: req.tg.user.username ?? null,
      firstName: req.tg.user.first_name ?? null,
      languageCode: req.tg.user.language_code ?? 'ru',
      city: null,
      profile: 'office',
    },
    update: {
      username: req.tg.user.username ?? null,
      firstName: req.tg.user.first_name ?? null,
      languageCode: req.tg.user.language_code ?? 'ru',
    },
    select: { telegramId: true, city: true, profile: true },
  });

  res.json({
    telegramId: user.telegramId,
    city: user.city,
    profile: user.profile ?? 'office',
  });
});

app.post('/api/settings', requireTelegramUser, async (req, res) => {
  const telegramId = String(req.tg.user.id);
  const { city, profile } = req.body || {};

  const cleanCity = city ? String(city).trim() : null;
  const cleanProfile = profile ? String(profile).trim() : 'office';

  const user = await prisma.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      username: req.tg.user.username ?? null,
      firstName: req.tg.user.first_name ?? null,
      languageCode: req.tg.user.language_code ?? 'ru',
      city: cleanCity,
      profile: cleanProfile,
    },
    update: {
      city: cleanCity,
      profile: cleanProfile,
      username: req.tg.user.username ?? null,
      firstName: req.tg.user.first_name ?? null,
      languageCode: req.tg.user.language_code ?? 'ru',
    },
    select: { telegramId: true, city: true, profile: true },
  });

  res.json({ ok: true, data: user });
});

app.get('/api/whoami', requireTelegramUser, (req, res) => {
  res.json({ ok: true, user: req.tg.user });
});

async function fetchJson(url) {
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

app.get('/api/weather', requireTelegramUser, async (req, res) => {
  const telegramId = String(req.tg.user.id);

  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { city: true },
  });
  const city = user?.city;

  if (!city) {
    return res.status(400).json({ error: 'City is not set. Save it via POST /api/settings {city, profile}.' });
  }

  const geo = await geocodeCity(city);
  if (!geo) return res.status(404).json({ error: `City not found: ${city}` });

  const forecast = await forecastByCoords(geo.latitude, geo.longitude, geo.timezone);
  res.json({ ok: true, city: geo.label, geo, forecast });
});

app.post('/api/location', requireTelegramUser, (req, res) => {
  const telegramId = String(req.tg.user.id);
  const { latitude, longitude, timezone, label } = req.body || {};
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'latitude and longitude must be numbers' });
  }

  const st = (globalThis.__userState ||= new Map()).get(telegramId) || {};
  const location = {
    latitude,
    longitude,
    timezone: timezone || 'auto',
    label: label ? String(label) : null,
  };
  (globalThis.__userState ||= new Map()).set(telegramId, { ...st, location });
  res.json({ ok: true, data: location });
});

app.get('/api/weather/by-location', requireTelegramUser, async (req, res) => {
  const telegramId = String(req.tg.user.id);
  const st = (globalThis.__userState ||= new Map()).get(telegramId);
  const loc = st?.location;
  if (!loc) return res.status(400).json({ error: 'No saved location. POST /api/location first.' });

  const forecast = await forecastByCoords(loc.latitude, loc.longitude, loc.timezone || 'auto');
  res.json({ ok: true, location: loc, forecast });
});

const bot = new Telegraf(BOT_TOKEN);

bot.start(async ctx => {
  const url = WEBAPP_URL;
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

      const desiredUrl = `${baseUrl}${webhookPath}`;
      try {
        const info = await bot.telegram.getWebhookInfo();
        if (info?.url === desiredUrl) {
          console.log('Telegraf webhook already set to:', desiredUrl);
        } else {
          await bot.telegram.setWebhook(desiredUrl);
          console.log('Telegraf webhook set to:', desiredUrl);
        }
      } catch (e) {
        await bot.telegram.setWebhook(desiredUrl);
        console.log('Telegraf webhook set to:', desiredUrl);
      }
    } catch (err) {
      console.error('Failed to set webhook, will use polling:', err.message);
    }
  } else {
    await bot.launch();
    console.log('Telegraf launched with polling');
  }

  const server = app.listen(PORT, () => console.log(`API listening on :${PORT}`));

  async function shutdown(signal) {
    try { bot.stop(signal); } catch {}
    try { server.close(); } catch {}
    try { await prisma.$disconnect(); } catch {}
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

startBotAndServer().catch(err => {
  console.error(err);
  process.exit(1);
});
