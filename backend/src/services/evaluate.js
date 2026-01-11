function groupIntervals(points, predicate) {
  const intervals = [];
  let start = null;

  for (let i = 0; i < points.length; i++) {
    const ok = predicate(points[i]);
    if (ok && start === null) start = i;
    if (!ok && start !== null) {
      intervals.push([start, i - 1]);
      start = null;
    }
  }
  if (start !== null) intervals.push([start, points.length - 1]);
  return intervals;
}

export function hazardsFromHourly(points) {
  const hazards = [];

  const add = (type, severity, from, to, values) => {
    hazards.push({ type, severity, from, to, values });
  };

  // gust
  for (const [s, e] of groupIntervals(points, p => (p.gustMs ?? 0) >= 17)) {
    const max = Math.max(...points.slice(s, e + 1).map(p => p.gustMs ?? 0));
    add('WIND_GUST', max >= 22 ? 'critical' : 'warning', points[s].time, points[e].time, { maxGustMs: max });
  }

  // precip
  for (const [s, e] of groupIntervals(points, p => (p.precipMm ?? 0) >= 5)) {
    const max = Math.max(...points.slice(s, e + 1).map(p => p.precipMm ?? 0));
    add('HEAVY_RAIN', max >= 10 ? 'critical' : 'warning', points[s].time, points[e].time, { maxMmPerH: max });
  }

  // thunderstorm
  for (const [s, e] of groupIntervals(points, p => p.thunderstorm === true)) {
    add('THUNDERSTORM', 'warning', points[s].time, points[e].time, {});
  }

  // extreme temp
  for (const [s, e] of groupIntervals(points, p => (p.temperatureC ?? 0) <= -20 || (p.temperatureC ?? 0) >= 35)) {
    const min = Math.min(...points.slice(s, e + 1).map(p => p.temperatureC ?? 0));
    const max = Math.max(...points.slice(s, e + 1).map(p => p.temperatureC ?? 0));
    add('EXTREME_TEMP', 'warning', points[s].time, points[e].time, { minC: min, maxC: max });
  }

  return hazards;
}

function passesModules(configJson, point) {
  const modules = configJson?.modules || [];

  for (const m of modules) {
    if (m.type === 'wind_max_ms') {
      const v = point.windMs ?? 0;
      if (typeof m.max !== 'number' || v > m.max) return { ok: false, reason: `wind ${v.toFixed(1)}>${m.max}` };
    }
    if (m.type === 'gust_max_ms') {
      const v = point.gustMs ?? 0;
      if (typeof m.max !== 'number' || v > m.max) return { ok: false, reason: `gust ${v.toFixed(1)}>${m.max}` };
    }
    if (m.type === 'precip_max_mmh') {
      const v = point.precipMm ?? 0;
      if (typeof m.max !== 'number' || v > m.max) return { ok: false, reason: `precip ${v.toFixed(1)}>${m.max}` };
    }
    if (m.type === 'temp_range_c') {
      const v = point.temperatureC ?? 0;
      if (typeof m.min === 'number' && v < m.min) return { ok: false, reason: `temp ${v.toFixed(1)}<${m.min}` };
      if (typeof m.max === 'number' && v > m.max) return { ok: false, reason: `temp ${v.toFixed(1)}>${m.max}` };
    }
    if (m.type === 'no_thunderstorm') {
      if (point.thunderstorm) return { ok: false, reason: 'thunderstorm' };
    }
  }

  return { ok: true };
}

export function evaluatePlan(plan, points) {
  const minWindow = plan.minWindowMinutes ?? 60;

  const intervals = groupIntervals(points, p => passesModules(plan.configJson, p).ok);

  const windows = intervals
    .map(([s, e]) => {
      const from = new Date(points[s].time);
      const to = new Date(points[e].time);
      const durationMin = Math.round((to - from) / 60000) + 60;
      return { from: from.toISOString(), to: to.toISOString(), durationMin };
    })
    .filter(w => w.durationMin >= minWindow);

  const now = new Date();
  const nearest = points.reduce((best, p) => {
    const d = Math.abs(new Date(p.time) - now);
    return !best || d < best.d ? { d, p } : best;
  }, null)?.p;

  const nowCheck = nearest ? passesModules(plan.configJson, nearest) : { ok: false, reason: 'no data' };

  return {
    planId: plan.id,
    name: plan.name,
    statusNow: nowCheck.ok ? 'good' : 'bad',
    reasonsNow: nowCheck.ok ? [] : [nowCheck.reason],
    minWindowMinutes: minWindow,
    windows,
  };
}
