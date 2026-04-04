import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { connectDatabase } from "./config/db.js";
import { registerGameSocket } from "./socket/gameSocket.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, "../../client/dist");
const isProduction = process.env.NODE_ENV === "production";

const app = express();
const httpServer = http.createServer(app);

const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? clientUrl)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.has(origin) || localOriginPattern.test(origin)) {
    return true;
  }

  // In production, the frontend is served by the same Express app,
  // so we also allow the configured public client URL.
  return isProduction && origin === clientUrl;
}

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Socket origin not allowed: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
  },
});

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`HTTP origin not allowed: ${origin}`));
    },
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "virtual-cosmos-server" });
});

if (isProduction) {
  app.use(express.static(clientDistPath));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/socket.io")) {
      next();
      return;
    }

    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

registerGameSocket(io);

const port = Number(process.env.PORT ?? 4000);
const mongoUri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/virtual-cosmos";

connectDatabase(mongoUri).then((isDatabaseConnected) => {
  httpServer.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
    console.log(
      `Persistence ${isDatabaseConnected ? "enabled" : "disabled"}`
    );
  });
});
