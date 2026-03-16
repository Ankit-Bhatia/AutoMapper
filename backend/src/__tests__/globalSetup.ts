import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres:password@localhost:5432/automapper_vitest';

function recreateDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, '');
  const cliArgs: string[] = [];

  if (parsed.hostname) cliArgs.push('-h', parsed.hostname);
  if (parsed.port) cliArgs.push('-p', parsed.port);
  if (parsed.username) cliArgs.push('-U', decodeURIComponent(parsed.username));

  const env = {
    ...process.env,
    ...(parsed.password ? { PGPASSWORD: decodeURIComponent(parsed.password) } : {}),
  };

  execFileSync('dropdb', ['--if-exists', ...cliArgs, databaseName], {
    env,
    stdio: 'ignore',
  });
  execFileSync('createdb', [...cliArgs, databaseName], {
    env,
    stdio: 'ignore',
  });
}

export default async function globalSetup() {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL;

  process.env.DATABASE_URL = databaseUrl;

  try {
    recreateDatabase(databaseUrl);
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
      cwd: backendRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      stdio: 'ignore',
    });
  } catch {
    console.warn(
      '[globalSetup] PostgreSQL not reachable — skipping DB provisioning. ' +
      'DB-dependent tests (audit, canonical, orgRoutes) may fail individually.',
    );
  }
}
