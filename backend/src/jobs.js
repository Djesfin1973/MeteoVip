import 'dotenv/config';

const JOBS_SECRET = process.env.JOBS_SECRET;
const API_URL = process.env.API_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';

async function tick() {
  const res = await fetch(`${API_URL}/api/v1/jobs/tick`, {
    method: 'POST',
    headers: {
      'X-Jobs-Secret': JOBS_SECRET,
      'Content-Type': 'application/json',
    },
  });
  console.log('Job tick:', res.status, await res.text());
}

tick().catch(err => {
  console.error(err);
  process.exit(1);
});
