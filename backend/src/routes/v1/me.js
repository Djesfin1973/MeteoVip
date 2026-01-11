import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);

  const user = await prisma.user.findUnique({
    where: { telegramId },
    include: { state: true, subscription: true },
  });

  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    languageCode: user.languageCode,
    presenceMode: user.presenceMode,
    summaryEnabled: user.summaryEnabled,
    hazardsEnabled: user.hazardsEnabled,
    workStart: user.workStart,
    workEnd: user.workEnd,
    subscription: user.subscription,
    activeLocationId: user.state?.activeLocationId ?? null,
  });
});

router.patch('/', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);

  const patch = {};
  const allowed = ['presenceMode', 'summaryEnabled', 'hazardsEnabled', 'workStart', 'workEnd', 'languageCode'];
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

  const user = await prisma.user.update({
    where: { telegramId },
    data: patch,
  });

  res.json({ ok: true, user });
});

export default router;
