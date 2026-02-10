import process from 'node:process';

const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

const check = async (path) => {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) {
    throw new Error(`Smoke failed for ${path}: ${res.status}`);
  }
  const body = await res.json().catch(() => ({}));
  return { path, status: res.status, body };
};

try {
  const health = await check('/api/health');
  console.log('Smoke OK:', health);
  process.exit(0);
} catch (error) {
  console.error('Smoke failed:', error);
  process.exit(1);
}

