import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { ensureInitialAdmin } from './auth/bootstrap.js';
import { openDatabase } from './db/client.js';
import { seedOnFirstRun } from './seed/starter-sources.js';

async function main(): Promise<void> {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(join(config.dataDir, 'rss.db'));
  const { app, scheduler, repos } = await buildApp({ config, db });
  const admin = await ensureInitialAdmin(repos, {
    username: config.auth.adminUsername,
    password: config.auth.adminPassword,
  });
  if (admin === 'created') app.log.info({ username: config.auth.adminUsername }, 'Created the first administrator');
  if (admin === 'not-configured') {
    app.log.warn('No user account exists yet: set ADMIN_USERNAME and ADMIN_PASSWORD in .env, then restart');
  }
  if (config.seedStarterSources) {
    const seeded = seedOnFirstRun(repos);
    if (seeded) app.log.info({ created: seeded.created }, 'Added starter sources on first run');
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down');
    await scheduler.stop();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  if (config.scheduler.enabled) scheduler.start();
  app.log.info(
    { renderer: Boolean(config.rendererUrl), web: Boolean(config.webDistDir), scheduler: config.scheduler.enabled },
    'Smart RSS is running',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal startup error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
