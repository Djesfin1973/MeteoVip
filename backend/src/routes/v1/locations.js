import { Router } from 'express';
import { resolveTimezone } from '../../services/timezone.js';

const router = Router();

router.get('/', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);

  const user = await prisma.user.findUnique({ where: { telegramId } });
  const locations = await prisma.userLocation.findMany({
    where: { userId: user.id, isPending: false },
    orderBy: { updatedAt: 'desc' },
  });

  res.json({ locations });
});

router.post('/', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  const { name, lat, lon, type } = req.body;
  if (!name || typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ error: 'name, lat, lon required' });
  }

  const timezone = await resolveTimezone(lat, lon);

  const loc = await prisma.userLocation.create({
    data: { userId: user.id, name, lat, lon, type: type || 'point', timezone, isPending: false },
  });

  res.json({ ok: true, location: loc });
});

router.post('/:id/set-active', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  const id = Number(req.params.id);
  const loc = await prisma.userLocation.findFirst({ where: { id, userId: user.id, isPending: false } });
  if (!loc) return res.status(404).json({ error: 'Location not found' });

  await prisma.userState.upsert({
    where: { userId: user.id },
    create: { userId: user.id, activeLocationId: loc.id, activeLat: loc.lat, activeLon: loc.lon, activeName: loc.name },
    update: { activeLocationId: loc.id, activeLat: loc.lat, activeLon: loc.lon, activeName: loc.name },
  });

  res.json({ ok: true, activeLocationId: loc.id });
});

router.post('/current/update', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  const { lat, lon, name } = req.body;
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ error: 'lat, lon required' });
  }

  const timezone = await resolveTimezone(lat, lon);
  const locName = name || 'Текущее место';

  await prisma.userLocation.deleteMany({ where: { userId: user.id, isPending: true, type: 'current' } });

  const pending = await prisma.userLocation.create({
    data: {
      userId: user.id,
      type: 'current',
      name: locName,
      lat,
      lon,
      timezone,
      isPending: true,
    },
  });

  res.json({ ok: true, pendingLocation: pending });
});

router.post('/current/confirm', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  const pending = await prisma.userLocation.findFirst({
    where: { userId: user.id, isPending: true, type: 'current' },
    orderBy: { createdAt: 'desc' },
  });
  if (!pending) return res.status(404).json({ error: 'No pending current location' });

  const applied = await prisma.userLocation.update({
    where: { id: pending.id },
    data: { isPending: false },
  });

  await prisma.userState.upsert({
    where: { userId: user.id },
    create: { userId: user.id, activeLocationId: applied.id, activeLat: applied.lat, activeLon: applied.lon, activeName: applied.name },
    update: { activeLocationId: applied.id, activeLat: applied.lat, activeLon: applied.lon, activeName: applied.name },
  });

  res.json({ ok: true, activeLocationId: applied.id, location: applied });
});

export default router;
