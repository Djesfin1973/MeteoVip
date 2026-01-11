const BASE = 'https://api.open-meteo.com/v1/forecast';

export async function getForecastHourly(lat, lon) {
  const url = new URL(BASE);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set(
    'hourly',
    [
      'temperature_2m',
      'apparent_temperature',
      'precipitation_probability',
      'precipitation',
      'windspeed_10m',
      'windgusts_10m',
      'weathercode',
      'visibility',
    ].join(',')
  );
  url.searchParams.set('forecast_days', '2');
  url.searchParams.set('timezone', 'UTC');

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo error: ${r.status} ${await r.text()}`);
  const j = await r.json();

  const t = j.hourly?.time || [];
  const temp = j.hourly?.temperature_2m || [];
  const app = j.hourly?.apparent_temperature || [];
  const pop = j.hourly?.precipitation_probability || [];
  const pr = j.hourly?.precipitation || [];
  const ws = j.hourly?.windspeed_10m || [];
  const wg = j.hourly?.windgusts_10m || [];
  const wc = j.hourly?.weathercode || [];
  const vis = j.hourly?.visibility || [];

  const points = [];
  for (let i = 0; i < t.length; i++) {
    const windMs = typeof ws[i] === 'number' ? ws[i] / 3.6 : null;
    const gustMs = typeof wg[i] === 'number' ? wg[i] / 3.6 : null;
    const code = wc[i];

    points.push({
      time: new Date(t[i] + 'Z').toISOString(),
      temperatureC: temp[i] ?? null,
      apparentC: app[i] ?? null,
      precipMm: pr[i] ?? null,
      precipProb: pop[i] ?? null,
      windMs,
      gustMs,
      weathercode: code ?? null,
      thunderstorm: code === 95 || code === 96 || code === 99,
      visibilityKm: typeof vis[i] === 'number' ? vis[i] / 1000 : null,
    });
  }
  return points;
}
