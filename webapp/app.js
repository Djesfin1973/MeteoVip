// После деплоя на Render замените на реальный URL, например:
// const API = "https://meteovip.onrender.com";
function getApiBase() {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get('api');
  if (fromQuery) {
    localStorage.setItem('apiBase', fromQuery);
    return fromQuery;
  }
  return localStorage.getItem('apiBase') || 'http://localhost:3000';
}

const API = getApiBase();

const tg = window.Telegram?.WebApp;
tg?.ready();

function getTelegramId() {
  const id = tg?.initDataUnsafe?.user?.id;
  return id ? String(id) : null;
}

const cityEl = document.getElementById('city');
const profileEl = document.getElementById('profile');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save');

async function loadSettings() {
  const telegramId = getTelegramId();
  if (!telegramId) return;

  const res = await fetch(`${API}/api/settings/${telegramId}`);
  const data = await res.json();
  if (data.city) cityEl.value = data.city;
  if (data.profile) profileEl.value = data.profile;
}

async function saveSettings() {
  statusEl.textContent = 'Сохраняю...';

  const telegramId = getTelegramId();
  if (!telegramId) {
    statusEl.textContent = 'Нет Telegram ID (откройте из бота).';
    return;
  }

  const payload = {
    telegramId,
    city: cityEl.value,
    profile: profileEl.value
  };

  const res = await fetch(`${API}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const out = await res.json();
  statusEl.textContent = out.ok ? 'Сохранено' : `Ошибка: ${out.error || 'unknown'}`;

  // tg?.close();
}

saveBtn.addEventListener('click', saveSettings);

loadSettings().catch((e) => {
  statusEl.textContent = 'Ошибка загрузки';
  console.error(e);
});
