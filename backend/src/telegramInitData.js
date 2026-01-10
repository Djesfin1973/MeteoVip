// backend/src/telegramInitData.js
import crypto from 'crypto';

/**
 * Парсит initData (querystring) в объект
 */
export function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const data = {};
  for (const [k, v] of params.entries()) data[k] = v;
  return data;
}

/**
 * Проверяет подпись initData по алгоритму Telegram WebApp.
 * Возвращает объект user (из initData.user) и raw поля.
 *
 * Док: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
export function validateInitData(initData, botToken, maxAgeSeconds = 24 * 60 * 60) {
  if (!initData) throw new Error('initData is required');

  const data = parseInitData(initData);
  const receivedHash = data.hash;
  if (!receivedHash) throw new Error('initData.hash is missing');

  // (опционально) проверка свежести
  if (data.auth_date) {
    const age = Math.floor(Date.now() / 1000) - Number(data.auth_date);
    if (Number.isFinite(age) && age > maxAgeSeconds) {
      throw new Error('initData is too old');
    }
  }

  // Строим data_check_string: сортируем пары key=value, кроме hash
  const pairs = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === 'hash') continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  // secret_key = HMAC_SHA256("WebAppData", botToken)
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // expected_hash = HMAC_SHA256(data_check_string, secret_key) in hex
  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  // безопасное сравнение
  const a = Buffer.from(expectedHash, 'hex');
  const b = Buffer.from(receivedHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('initData signature is invalid');
  }

  const user = data.user ? JSON.parse(data.user) : null; // {id, username, ...}
  return { ok: true, data, user };
}
