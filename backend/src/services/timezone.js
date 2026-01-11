export async function resolveTimezone(lat, lon) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m');
  url.searchParams.set('timezone', 'auto');

  const r = await fetch(url);
  if (!r.ok) return 'UTC';
  const j = await r.json();
  return j.timezone || 'UTC';
}
