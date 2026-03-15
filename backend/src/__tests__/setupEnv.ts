const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres:password@localhost:5432/automapper_vitest';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DEFAULT_TEST_DATABASE_URL;
}
