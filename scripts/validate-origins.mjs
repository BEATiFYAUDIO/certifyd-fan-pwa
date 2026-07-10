import fs from 'node:fs';

const registryPath = new URL('../public/origins.json', import.meta.url);
const payload = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const origins = Array.isArray(payload.origins) ? payload.origins : [];
const temporaryOrigins = origins.filter((origin) => {
  try {
    return new URL(String(origin)).hostname.toLowerCase().endsWith('.trycloudflare.com');
  } catch {
    return false;
  }
});

if (temporaryOrigins.length > 0) {
  console.error('Temporary TryCloudflare origins are not allowed in public/origins.json:');
  for (const origin of temporaryOrigins) console.error(`- ${origin}`);
  process.exit(1);
}
