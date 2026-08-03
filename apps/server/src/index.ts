import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db/open.js';
import { purgeExpiredSessions } from './services/auth.js';
import { failStaleJobs } from './services/jobs.js';
import { setupCode } from './services/team.js';

const db = openDatabase();
purgeExpiredSessions(db);
// Jobs run in-process, so anything still "running" died with the last process.
const stale = failStaleJobs(db);
if (stale > 0) console.log(`[voku] marked ${stale} interrupted job(s) as failed`);

const app = createApp(db);

const server = app.listen(config.port, () => {
  console.log(`[voku] listening on ${config.publicBaseUrl} (port ${config.port})`);
  const code = setupCode(db);
  if (code) {
    // Printed every boot until claimed: finding the URL must not be the same as
    // owning the instance.
    console.log('');
    console.log('  ┌─────────────────────────────────────────────┐');
    console.log('  │  voku is not set up yet.                    │');
    console.log(`  │  Open ${config.publicBaseUrl.padEnd(38).slice(0, 38)}│`);
    console.log('  │  and enter this setup code:                 │');
    console.log(`  │                                             │`);
    console.log(`  │      ${code.padEnd(39)}│`);
    console.log('  └─────────────────────────────────────────────┘');
    console.log('');
  }
});

function shutdown(signal: string): void {
  console.log(`[voku] ${signal} — shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Don't let an open keep-alive connection hold the process forever.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
