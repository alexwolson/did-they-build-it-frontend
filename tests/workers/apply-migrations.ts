// applyD1Migrations() only applies not-yet-applied migrations, so re-runs are safe.
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
