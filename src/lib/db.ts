// Neon PostgreSQL access layer.
//
// Uses the Neon serverless HTTP driver, which works on Vercel (Node and Edge)
// without a persistent TCP connection pool.
//
// Required environment variable:
//   DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | undefined;

/** Lazily-created Neon SQL tag. Call inside request handlers only. */
export function db(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env["DATABASE_URL"];
    if (!url) {
      const message =
        "Missing DATABASE_URL. Set it to your Neon PostgreSQL connection string.";
      console.error(`[db] ${message}`);
      throw new Error(message);
    }
    _sql = neon(url);
  }
  return _sql;
}

let authSchemaReady: Promise<void> | undefined;

/**
 * Makes sure the two tables OTP login needs exist.
 *
 * db/schema.sql is still the source of truth, but on a fresh production
 * database that has never had the schema applied, every send-code request
 * failed with "relation auth_codes does not exist". This runs once per warm
 * serverless instance and is a no-op when the tables are already there.
 */
export async function ensureAuthSchema(): Promise<void> {
  if (!authSchemaReady) {
    const sql = db();
    authSchemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS auth_codes (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          email text NOT NULL,
          code text NOT NULL,
          expires_at timestamptz NOT NULL,
          attempts integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS auth_codes_email_idx ON auth_codes (email)`;
      await sql`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token text PRIMARY KEY,
          email text NOT NULL,
          admin boolean NOT NULL DEFAULT false,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS auth_sessions_email_idx ON auth_sessions (email)`;
    })().catch((error) => {
      authSchemaReady = undefined; // retry on the next request
      throw error;
    });
  }
  return authSchemaReady;
}

export type Row = Record<string, unknown>;
