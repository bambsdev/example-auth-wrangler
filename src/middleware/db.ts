import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { createMiddleware } from "hono/factory";
import * as schemaExports from "../db/schema";
import type { AuthBindings, AuthVariables } from "@bambsdev/auth";

// Ambil object schema yang berisi gabungan tabel
const schema = schemaExports.schema;

export type DB = ReturnType<typeof drizzle<typeof schema>>;

export type BukukitaVariables = AuthVariables & {
  db: DB;
};

export const dbMiddleware = createMiddleware<{
  Bindings: AuthBindings;
  Variables: BukukitaVariables;
}>(async (c, next) => {
  const client = new Client({
    connectionString:
      c.env.LOCAL_DATABASE_URL || (c.env as any).HYPERDRIVE?.connectionString,
  });

  await client.connect();

  // Inisialisasi Drizzle dengan schema gabungan
  const db = drizzle(client, { schema, logger: false });

  // Inject ke context
  c.set("db" as any, db);

  try {
    await next();
  } finally {
    client.end().catch(() => {});
  }
});
