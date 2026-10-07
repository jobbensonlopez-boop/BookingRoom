import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';

const config = loadConfig();
const db = createPool(config.databaseUrl);
const app = createApp({ config, db });

app.listen(config.port, () => {
  console.log(`Room booking API listening on :${config.port} (auth: ${config.auth.mode}, tz: ${config.timeZone})`);
});
