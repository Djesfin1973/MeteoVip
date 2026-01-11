import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
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

// JSON для webhook Telegraf и API
app.use(express.json());

// CORS
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

// -------- Telegram initData middleware (исправленный) --------
function requireTelegramUser(req, res, next) {
  const headerValue = req.headers['x-telegram-init-data'];

  // 1) заголовок вообще не передан
  if (typeof headerValue === 'undefined') {
    return res.status(401).json({ error: 'X-Telegram-Init-Data header is required' });
  }

  // 2) передан, но пустая строка
  if (typeof headerValue === 'string' && headerValue.trim().length === 0) {
    return res.status(401).json({ error: 'initData is empty (open WebApp via bot button)' });
  }

  try {
    const result = validateInitData(headerValue, process.env.BOT_TOKEN);
    if (!result.user?.id) {
      return res.status(401).json({ error: 'No user in initData' });
    }

    req.tg = { user: result.user, initData: result.data };
    next();
  } catch (e) {
    return res.status(401).json({ error: String(e.message || e) });
  }
}

// -------- Память без БД --------
// telegramId -> { settings: { telegramId, city, profile }, location: {...} }
const userState = new Map();

// -------- Простые API --------
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.json({ ok: true, service: 'MeteoVip API' }));

// Настройки (город/профиль)
app.get('/api/settings', requireTelegramUser, async (req, res) => {
  const telegramId = String(req.tg.user.id);
  const st = userState.get(telegramId);
  const base = {
    telegramId,
    city: null,
    profile: 'office',
  };
  res.json(st?.settings || base);
});

app.post('/api/settings', requireTelegramUser, async (req, res) => {
  const telegramId = String(req.tg.user.id);
  const { city, profile } = req.body || {};

  const st = userState.get(telegramId) || {};
  const settings = {
    telegramId,
    city: city ? String(city).trim() : null,
    profile: profile ? String(profile) : 'office',
  };

  userState.set(telegramId, {
    ...st,
    settings,
  });

  res.json({ ok: true, data: settings });
});

// Debug: кто я
app.get('/api/whoami', requireTelegramUser, (req, res) => {
  res.json({ ok: true, user: req.tg.user });
});

// -------- Open-Meteo утилиты --------
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
    name: item.name,
    admin1: item.admin1,
    country: item.country,
    latitude: item.latitude,
    longitude: item.longitude,
    timezone: item.timezone,
  };
}

async function forecastByCoords(lat, lon, timezone = 'auto
