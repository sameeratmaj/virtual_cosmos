import { PlayerSession } from "../models/PlayerSession.js";
import mongoose from "mongoose";

const DEFAULT_POSITION = { x: 320, y: 240 };
const PROXIMITY_RADIUS = 150;
const SPAWN_PADDING = 48;
const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 640;

async function upsertPlayerSession(userId, updates) {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  await PlayerSession.findOneAndUpdate(
    { userId },
    {
      userId,
      ...updates,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function savePlayerPosition(userId, position) {
  await upsertPlayerSession(userId, {
    x: position.x,
    y: position.y,
    lastSeenAt: new Date(),
  });
}

async function getStoredPlayerSession(userId) {
  if (mongoose.connection.readyState !== 1) {
    return null;
  }

  return PlayerSession.findOne({ userId }).lean();
}

function sanitizePosition(position = {}) {
  return {
    x: Number.isFinite(position.x) ? position.x : DEFAULT_POSITION.x,
    y: Number.isFinite(position.y) ? position.y : DEFAULT_POSITION.y,
  };
}

function getDistance(firstUser, secondUser) {
  return Math.sqrt(
    (secondUser.x - firstUser.x) ** 2 + (secondUser.y - firstUser.y) ** 2
  );
}

function buildConversationId(firstUserId, secondUserId) {
  return [firstUserId, secondUserId].sort().join("__");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveSpawnPosition(users, requestedPosition, currentSocketId) {
  const occupiedUsers = Object.values(users).filter(
    (user) => user.socketId !== currentSocketId
  );

  if (
    occupiedUsers.every(
      (user) => getDistance(user, requestedPosition) >= SPAWN_PADDING
    )
  ) {
    return requestedPosition;
  }

  for (let ring = 1; ring <= 6; ring += 1) {
    const radius = ring * SPAWN_PADDING;

    for (let step = 0; step < 8; step += 1) {
      const angle = (Math.PI * 2 * step) / 8;
      const candidate = {
        x: clamp(
          requestedPosition.x + Math.cos(angle) * radius,
          24,
          WORLD_WIDTH - 24
        ),
        y: clamp(
          requestedPosition.y + Math.sin(angle) * radius,
          24,
          WORLD_HEIGHT - 24
        ),
      };

      const hasCollision = occupiedUsers.some(
        (user) => getDistance(user, candidate) < SPAWN_PADDING
      );

      if (!hasCollision) {
        return candidate;
      }
    }
  }

  return requestedPosition;
}

export function registerGameSocket(io) {
  const users = {};

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("join", async ({ userId }) => {
      if (!userId) {
        socket.emit("join_error", { message: "userId is required" });
        return;
      }

      const existingSession = await getStoredPlayerSession(userId);
      const spawnPosition = resolveSpawnPosition(
        users,
        sanitizePosition(existingSession ?? DEFAULT_POSITION),
        socket.id
      );

      users[socket.id] = {
        socketId: socket.id,
        userId,
        x: spawnPosition.x,
        y: spawnPosition.y,
      };

      await upsertPlayerSession(userId, {
        x: spawnPosition.x,
        y: spawnPosition.y,
        socketId: socket.id,
        isActive: true,
        lastSeenAt: new Date(),
      });

      console.log("Player joined:", {
        socketId: socket.id,
        userId,
        activePlayers: Object.keys(users).length,
      });

      socket.emit("init_state", {
        self: users[socket.id],
        players: Object.values(users),
      });

      socket.broadcast.emit("player_joined", users[socket.id]);
    });

    socket.on("move", async ({ x, y }) => {
      const currentUser = users[socket.id];

      if (!currentUser) {
        return;
      }

      const nextPosition = sanitizePosition({ x, y });

      currentUser.x = nextPosition.x;
      currentUser.y = nextPosition.y;

      socket.broadcast.emit("player_moved", {
        socketId: socket.id,
        userId: currentUser.userId,
        x: currentUser.x,
        y: currentUser.y,
      });

      await savePlayerPosition(currentUser.userId, nextPosition);
    });

    socket.on("send_chat_message", ({ toSocketId, message }) => {
      const sender = users[socket.id];
      const receiver = users[toSocketId];
      const trimmedMessage = typeof message === "string" ? message.trim() : "";

      if (!sender || !receiver || !trimmedMessage) {
        return;
      }

      const distance = getDistance(sender, receiver);

      if (distance >= PROXIMITY_RADIUS) {
        socket.emit("chat_error", {
          message: "Target player is no longer within the proximity chat radius.",
          toSocketId,
        });
        return;
      }

      const payload = {
        id: `${Date.now()}-${socket.id}`,
        conversationId: buildConversationId(sender.userId, receiver.userId),
        fromSocketId: sender.socketId,
        fromUserId: sender.userId,
        toSocketId: receiver.socketId,
        toUserId: receiver.userId,
        message: trimmedMessage,
        createdAt: new Date().toISOString(),
      };

      io.to(sender.socketId).emit("chat_message", payload);
      io.to(receiver.socketId).emit("chat_message", payload);
    });

    socket.on("disconnect", async () => {
      const currentUser = users[socket.id];

      if (!currentUser) {
        console.log("Socket disconnected before join:", socket.id);
        return;
      }

      await upsertPlayerSession(currentUser.userId, {
        x: currentUser.x,
        y: currentUser.y,
        socketId: null,
        isActive: false,
        lastSeenAt: new Date(),
      });
      delete users[socket.id];

      socket.broadcast.emit("player_disconnected", {
        socketId: socket.id,
        userId: currentUser.userId,
      });

      console.log("Player disconnected:", {
        socketId: socket.id,
        userId: currentUser.userId,
        activePlayers: Object.keys(users).length,
      });
    });
  });
}
