import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    // Respect DB_PATH env var so Docker migrations write to the mounted volume.
    url: process.env.DB_PATH ?? './data/app.db',
  },
  verbose: true,
  strict: true,
});
