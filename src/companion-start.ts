import { randomBytes } from 'node:crypto';
import { createCompanionApp } from './companion.ts';

const port = 4319;
const pairingCode = randomBytes(5).toString('hex').toUpperCase();
const app = createCompanionApp({ pairingCode });
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Cloak local AI companion listening at http://127.0.0.1:${port}`);
  console.log(`One-time extension pairing code: ${pairingCode}`);
  console.log('Models: Qwen3-1.7B + Xenova/all-MiniLM-L6-v2 (downloaded and run locally)');
  console.log('Enter this code in the Cloak extension popup. It is valid for one extension pairing.');
});
const close = () => server.close(() => process.exit(0));
process.once('SIGINT', close);
process.once('SIGTERM', close);
