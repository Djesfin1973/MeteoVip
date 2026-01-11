import { Router } from 'express';
import { getForecastHourly } from '../../services/openMeteoClient.js';
import { hazardsFromHourly, evaluatePlan } from '../../services/evaluate.js';

const router = Router();

router.get('/', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);

  const user = await prisma.user.findUnique({
    where: { telegramId },
    include: { state: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const activeLocationId = user.state?.activeLocationId;
  if (!activeLocationId) return res.status(400).json({ error: 'No active location' });

  const loc = await prisma.userLocation.findFirst({ where: { id: activeLocationId, userId: user.id } });
  if (!loc) return res.status(404).json({ error: 'Active location not found' });

  const hourly = await getForecastHourly(loc.lat, loc.lon);
  const hazards = hazardsFromHourly(hourly);

  const plans = await prisma.userPlan.findMany({ where: { userId: user.id, enabled: true } });
  const evaluations = plans.map(p => evaluatePlan(p, hourly));

  res.json({
    location: { id: loc.id, name: loc.name, lat: loc.lat, lon: loc.lon, timezone: loc.timezone },
    hazards,
    plans: evaluations,
  });
});

export default router;
