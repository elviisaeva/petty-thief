import { applyD1Migrations, env } from "cloudflare:test";
import { ensureSchema, resetSchemaMemo } from "../src/schema";

// Migrations stop at 0001; later columns come from ensureSchema, exactly as on a live database.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await ensureSchema(env.DB);
resetSchemaMemo();
