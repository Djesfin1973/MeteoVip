import { Router } from 'express';
import { defaultTemplates } from '../../services/planTemplates.js';

const router = Router();

router.get('/', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  const plans = await prisma.userPlan.findMany({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' } });
  res.json({ plans, templates: defaultTemplates() });
});

router.post('/from-template', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  const { templateId, name } = req.body;
  const tpl = defaultTemplates().find(t => t.id === templateId);
  if (!tpl) return res.status(400).json({ error: 'Unknown templateId' });

  const plan = await prisma.userPlan.create({
    data: {
      userId: user.id,
      name: name || tpl.name,
      enabled: true,
      minWindowMinutes: tpl.minWindowMinutes ?? 60,
      configJson: tpl.defaultConfigJson,
    },
  });

  res.json({ ok: true, plan });
});

router.patch('/:id', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  const id = Number(req.params.id);
  const plan = await prisma.userPlan.findFirst({ where: { id, userId: user.id } });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const data = {};
  for (const k of ['name', 'enabled', 'minWindowMinutes', 'configJson']) {
    if (k in req.body) data[k] = req.body[k];
  }

  const updated = await prisma.userPlan.update({ where: { id }, data });
  res.json({ ok: true, plan: updated });
});

router.delete('/:id', async (req, res) => {
  const prisma = req.app.get('prisma');
  const telegramId = String(req.tg.user.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  const id = Number(req.params.id);
  const plan = await prisma.userPlan.findFirst({ where: { id, userId: user.id } });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  await prisma.userPlan.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
