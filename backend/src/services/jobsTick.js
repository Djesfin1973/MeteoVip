import { getForecastHourly } from './openMeteoClient.js';
import { hazardsFromHourly } from './evaluate.js';

function dedupeKeyForHazard(userId, locId, hazard) {
  return `hazard:${userId}:${locId}:${hazard.type}:${hazard.from}:${hazard.to}:${hazard.severity}`;
}

export async function runJobsTick({ prisma, bot }) {
  const users = await prisma.user.findMany({
    include: { state: true },
  });

  let hazardsSent = 0;

  for (const user of users) {
    if (!user.hazardsEnabled) continue;
    const locId = user.state?.activeLocationId;
    if (!locId) continue;

    const loc = await prisma.userLocation.findFirst({ where: { id: locId, userId: user.id, isPending: false } });
    if (!loc) continue;

    try {
      const hourly = await getForecastHourly(loc.lat, loc.lon);
      const hazards = hazardsFromHourly(hourly);

      for (const h of hazards) {
        const key = dedupeKeyForHazard(user.id, loc.id, h);

        const exists = await prisma.alertEvent.findUnique({ where: { dedupeKey: key } });
        if (exists) continue;

        await prisma.alertEvent.create({
          data: {
            userId: user.id,
            locationId: loc.id,
            kind: 'hazard',
            subtype: h.type,
            severity: h.severity,
            dedupeKey: key,
            payload: h,
          },
        });

        const chatId = Number(user.telegramId);
        const text =
          `[!] Опасность: ${h.type}\n` +
          `Уровень: ${h.severity}\n` +
          `Период: ${h.from} — ${h.to}\n` +
          `Локация: ${loc.name}`;

        try {
          await bot.telegram.sendMessage(chatId, text);
          hazardsSent++;
        } catch (e) {
          console.error('Failed to send hazard notification:', e.message);
        }
      }
    } catch (e) {
      console.error(`Error processing user ${user.id}:`, e.message);
    }
  }

  return { usersProcessed: users.length, hazardsSent };
}
