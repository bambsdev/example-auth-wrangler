import { ExecutionContext } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";

import {
  customLogger,
  authRoutes,
  settingRoutes,
  cleanupExpiredTokens,
  cleanupExpiredPasswordResets,
  cleanupExpiredEmailVerifications,
  authMiddleware,
  type AuthBindings,
  type AuthVariables,
} from "@bambsdev/auth";

import {
  NotificationService,
  FCMService,
  notifyRoutes,
  deviceTokenRoutes,
  cleanupExpiredNotifications,
} from "@bambsdev/notify";

import { dbMiddleware, type BukukitaVariables } from "./middleware/db";

const app = new OpenAPIHono<{
  Bindings: AuthBindings & {
    ALLOWED_ORIGINS?: string;
    FCM_PROJECT_ID: string;
    FCM_SERVICE_ACCOUNT_KEY: string;
  };
  Variables: BukukitaVariables;
}>();

// Logger
app.use("*", customLogger());

// CORS — Secure configuration with explicit allowed origins
// Set ALLOWED_ORIGINS env var as comma-separated list:
//   e.g. "https://demo-notify.pages.dev,https://myapp.example.com"
// Mobile clients (native apps) don't send Origin header, so they pass through.
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      // No origin = non-browser client (mobile, curl, etc.) — allow
      if (!origin) return origin;

      const allowedRaw = (c.env as any).ALLOWED_ORIGINS ?? "";
      const allowedOrigins = allowedRaw
        .split(",")
        .map((o: string) => o.trim())
        .filter(Boolean);

      // Also always allow localhost for development
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return origin;
      }

      if (allowedOrigins.includes(origin)) {
        return origin;
      }

      // Origin not allowed — return null (browser will block the request)
      return null as unknown as string;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    exposeHeaders: ["Content-Length", "X-Request-Id"],
    maxAge: 86400, // 24h preflight cache
    credentials: true,
  }),
);

// DB Middleware — Pakai middleware lokal supaya mengenali tabel bukukita
app.use("/auth/*", dbMiddleware);
app.use("/api/*", dbMiddleware);

// Email Config Middleware — Contoh kustomisasi email untuk consumer

// Mount auth routes
app.route("/auth", authRoutes);
app.route("/api/settings", settingRoutes);

// Protect notify routes with authMiddleware
app.use("/api/users", authMiddleware);
app.use("/api/devices/*", authMiddleware);
app.use("/api/notifications/*", authMiddleware);

app.get("/api/users", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");

  const allUsers = await db.query.users.findMany({
    where: (users: any, { ne }: any) => ne(users.id, userId),
    columns: {
      id: true,
      email: true,
      username: true,
      fullName: true,
    },
    limit: 50, // limit for demo purpose
  });

  return c.json({
    success: true,
    data: allUsers,
  });
});

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

// ╔══════════════════════════════════════════════════════════════╗
// ║  POST /api/notifications/send               🔒 Protected     ║
// ╚══════════════════════════════════════════════════════════════╝
app.post("/api/notifications/send", async (c) => {
  const db = c.get("db");
  const senderId = c.get("userId");
  const { toUserId, message } = await c.req.json();

  if (!toUserId || !message) {
    return c.json(
      {
        success: false as const,
        error: "INVALID_INPUT",
        message: "toUserId and message are required",
      },
      400,
    );
  }

  try {
    // 1. Ambil info pengirim untuk judul notifikasi
    const sender = await db.query.users.findFirst({
      where: (users: any, { eq }: any) => eq(users.id, senderId),
      columns: { fullName: true, username: true, email: true },
    });

    const senderName =
      sender?.fullName || sender?.username || sender?.email || "Seseorang";
    const title = `Pesan dari ${senderName}`;

    // 2. Inisialisasi Service Notifikasi
    const fcm = new FCMService(
      c.env.KV,
      c.env.FCM_PROJECT_ID,
      c.env.FCM_SERVICE_ACCOUNT_KEY,
    );
    const notifService = new NotificationService(db as any, fcm, c.env.ANALYTICS as any);

    // 3. Buat Notifikasi (ini otomatis kirim push via FCM jika withPush: true)
    await notifService.create({
      userId: toUserId,
      title: title,
      body: message,
      withPush: true,
    });

    return c.json({ success: true as const }, 200);
  } catch (err: any) {
    console.error("Error sending notification:", err);
    return c.json(
      {
        success: false as const,
        error: "SEND_FAILED",
        message: err.message || "Gagal mengirim notifikasi",
      },
      500,
    );
  }
});

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
