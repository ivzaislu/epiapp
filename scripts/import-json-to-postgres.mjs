import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PostgresStore } from '../src/postgres-store.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const sourceArg = args.find((arg) => !arg.startsWith('--'));
const source = resolve(sourceArg || process.env.DATA_FILE || './data/epiapp.json');
const databaseUrl = String(process.env.DATABASE_URL || process.env.POSTGRES_URI || '').trim();

if (!databaseUrl) {
  console.error('Set DATABASE_URL or POSTGRES_URI before importing.');
  process.exit(2);
}

let parsed;
try {
  parsed = JSON.parse(await readFile(source, 'utf8'));
} catch (error) {
  console.error(`Cannot read EpiApp JSON state from ${source}: ${error.message}`);
  process.exit(2);
}

const store = new PostgresStore(databaseUrl);
try {
  const imported = await store.importState(parsed, { overwrite: force });
  console.log(`Imported EpiApp state version ${imported.version} from ${source} into PostgreSQL.`);
  console.log(`Doses: ${imported.doses.length}; users: ${imported.access.users.length}; devices: ${imported.access.devices.length}.`);
} finally {
  await store.close();
}
