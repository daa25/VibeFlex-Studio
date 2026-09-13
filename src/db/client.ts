import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazily initialised so that importing this module (e.g. during `next build`)
// does not require DATABASE_URL to be present. The connection is only created
// the first time a query actually runs.
let _db: PostgresJsDatabase<typeof schema> | null = null;

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in."
      );
    }
    const client = postgres(process.env.DATABASE_URL, { max: 1 });
    _db = drizzle(client, { schema });
  }
  return _db;
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
});

/**
 * Non-throwing accessor for optional-database code paths.
 *
 * Returns null when DATABASE_URL is absent so callers can report a clear
 * "not configured" state instead of crashing. Use this in anything that must
 * keep working without a database (the studio pipeline itself); use `db` where
 * a database is genuinely required.
 */
export function tryGetDb(): PostgresJsDatabase<typeof schema> | null {
  if (!process.env.DATABASE_URL) return null;
  return getDb();
}
