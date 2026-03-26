import * as authSchema from "@bambsdev/auth";
import * as notifySchema from "@bambsdev/notify";
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// Tabel lokal khusus api-bukukita
export const books = pgTable("books", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Gabungkan schema auth dengan schema lokal
export const schema = {
  ...authSchema.schema,
  ...notifySchema.schema,
  books,
};

// Re-export semua dari auth & notify (khusus tabel/schema)
export * from "@bambsdev/auth";
export { deviceTokens, notifications } from "@bambsdev/notify";
