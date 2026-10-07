import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrate';

const config = loadConfig();
const db = createPool(config.databaseUrl);
// An idle connection dropped by the database server must not crash the process.
db.on('error', err => console.error('Postgres pool error:', err.message));
// Apply pending database migrations before accepting traffic (used in containers).
if (process.env.RUN_MIGRATIONS === 'true') await migrate(db);
const app = createApp({ config, db });

const server = app.listen(config.port, () => {
  console.log(`Room booking API listening on :${config.port} (auth: ${config.auth.mode}, tz: ${config.timeZone})`);
});

// Hosting platforms (e.g. Azure App Service) send SIGTERM before stopping a container.
const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`);
  server.close(() => db.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
