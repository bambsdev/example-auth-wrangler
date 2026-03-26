import { ExecutionContext } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";

import {
  customLogger,
  authRoutes,
  settingRoutes,
  cleanupExpiredTokens,
  cleanupExpiredPasswordResets,
  cleanupExpiredEmailVerifications,
  type AuthBindings,
  type AuthVariables,
} from "@bambsdev/auth";

import {
  notifyRoutes,
  deviceTokenRoutes,
  cleanupExpiredNotifications,
} from "@bambsdev/notify";

import { dbMiddleware, type BukukitaVariables } from "./middleware/db";

const app = new OpenAPIHono<{
  Bindings: AuthBindings;
  Variables: BukukitaVariables;
}>();

// Logger
app.use("*", customLogger());

// DB Middleware — Pakai middleware lokal supaya mengenali tabel bukukita
app.use("/auth/*", dbMiddleware);
app.use("/api/*", dbMiddleware);

// Email Config Middleware — Contoh kustomisasi email untuk consumer

// Mount auth routes
app.route("/auth", authRoutes);
app.route("/api/settings", settingRoutes);

// Mount notify routes
app.route("/api/devices", deviceTokenRoutes);
app.route("/api/notifications", notifyRoutes);

// Mount OpenAPI spec and Swagger UI
app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "BukuKita API",
    description: "API Endpoint Documentation",
  },
});

app.get(
  "/doc",
  swaggerUI({
    url: "/openapi.json",
  }),
);

// Test Route — Verifikasi akses tabel Auth dan tabel lokal
app.get("/api/test-db", async (c) => {
  const db = c.get("db");

  // Cobak query tabel Auth (users)
  const usersCount = await db.query.users.findMany({ limit: 1 });

  // Coba query tabel lokal (books)
  const booksCount = await db.query.books.findMany({ limit: 1 });

  return c.json({
    status: "ok",
    message: "Drizzle recognizes both Auth and Local schemas!",
    data: {
      hasUsers: usersCount,
      hasBooks: booksCount,
    },
  });
});

export default {
  // HTTP requests
  fetch: app.fetch,

  // Cron trigger: hapus expired tokens
  async scheduled(
    _event: ScheduledEvent,
    env: AuthBindings,
    _ctx: ExecutionContext,
  ) {
    const connectionString = env.LOCAL_DATABASE_URL || env.HYPERDRIVE.connectionString;
    await cleanupExpiredTokens(connectionString);
    await cleanupExpiredPasswordResets(connectionString);
    await cleanupExpiredEmailVerifications(connectionString);
    await cleanupExpiredNotifications(connectionString);
  },
};
