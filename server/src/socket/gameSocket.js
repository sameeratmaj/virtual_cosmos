import { PlayerSession } from "../models/PlayerSession.js";
import mongoose from "mongoose";

const WORLD_WIDTH = 5000;
const WORLD_HEIGHT = 5000;
const PLAYER_PADDING = 24;
const DEFAULT_POSITION = {
  x: WORLD_WIDTH / 2,
  y: WORLD_HEIGHT / 2,
};
const PROXIMITY_RADIUS = 150;
const SPAWN_PADDING = 48;
const CHAT_STATUS = {
  IDLE: "IDLE",
  PENDING_SENT: "PENDING_SENT",
  PENDING_RECEIVED: "PENDING_RECEIVED",
  CONNECTED: "CONNECTED",
};

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
    x: clamp(
      Number.isFinite(position.x) ? position.x : DEFAULT_POSITION.x,
      PLAYER_PADDING,
      WORLD_WIDTH - PLAYER_PADDING
    ),
    y: clamp(
      Number.isFinite(position.y) ? position.y : DEFAULT_POSITION.y,
      PLAYER_PADDING,
      WORLD_HEIGHT - PLAYER_PADDING
    ),
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

function getParticipantSnapshot(user) {
  if (!user) {
    return null;
  }

  return {
    socketId: user.socketId,
    userId: user.userId,
    x: user.x,
    y: user.y,
  };
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
          PLAYER_PADDING,
          WORLD_WIDTH - PLAYER_PADDING
        ),
        y: clamp(
          requestedPosition.y + Math.sin(angle) * radius,
          PLAYER_PADDING,
          WORLD_HEIGHT - PLAYER_PADDING
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
  const pendingRequests = new Map();
  const socketToPendingRequest = new Map();
  const activeConnections = new Map();
  const socketToRoom = new Map();

  const getUserByUserId = (userId) =>
    Object.values(users).find((user) => user.userId === userId);

  const isSocketBusy = (socketId) =>
    socketToPendingRequest.has(socketId) || socketToRoom.has(socketId);

  const clearPendingRequest = (requestKey) => {
    const request = pendingRequests.get(requestKey);

    if (!request) {
      return null;
    }

    pendingRequests.delete(requestKey);
    socketToPendingRequest.delete(request.senderSocketId);
    socketToPendingRequest.delete(request.receiverSocketId);
    return request;
  };

  const clearConnection = (roomId) => {
    const connection = activeConnections.get(roomId);

    if (!connection) {
      return null;
    }

    activeConnections.delete(roomId);

    connection.participants.forEach((socketId) => {
      socketToRoom.delete(socketId);
      const participantSocket = io.sockets.sockets.get(socketId);
      participantSocket?.leave(roomId);
    });

    return connection;
  };

  const emitBreakConnection = (socketIds, reason) => {
    const uniqueSocketIds = [...new Set(socketIds)];

    uniqueSocketIds.forEach((socketId) => {
      const participant = users[socketId];
      const partner = uniqueSocketIds
        .filter((candidateId) => candidateId !== socketId)
        .map((candidateId) => getParticipantSnapshot(users[candidateId]))
        .find(Boolean);

      io.to(socketId).emit("break_connection", {
        reason,
        partner,
        chatStatus: CHAT_STATUS.IDLE,
        user: getParticipantSnapshot(participant),
      });
    });
  };

  const breakChatStateForSocket = (socketId, reason) => {
    const pendingRequestKey = socketToPendingRequest.get(socketId);

    if (pendingRequestKey) {
      const request = clearPendingRequest(pendingRequestKey);

      if (request) {
        emitBreakConnection(
          [request.senderSocketId, request.receiverSocketId],
          reason
        );
      }

      return;
    }

    const roomId = socketToRoom.get(socketId);

    if (roomId) {
      const connection = clearConnection(roomId);

      if (connection) {
        emitBreakConnection(connection.participants, reason);
      }
    }
  };

  const validateDistanceForSocket = (socketId, reason) => {
    const pendingRequestKey = socketToPendingRequest.get(socketId);

    if (pendingRequestKey) {
      const request = pendingRequests.get(pendingRequestKey);

      if (!request) {
        socketToPendingRequest.delete(socketId);
        return;
      }

      const sender = users[request.senderSocketId];
      const receiver = users[request.receiverSocketId];

      if (!sender || !receiver) {
        clearPendingRequest(pendingRequestKey);
        emitBreakConnection(
          [request.senderSocketId, request.receiverSocketId],
          reason
        );
        return;
      }

      if (getDistance(sender, receiver) >= PROXIMITY_RADIUS) {
        clearPendingRequest(pendingRequestKey);
        emitBreakConnection(
          [request.senderSocketId, request.receiverSocketId],
          reason
        );
      }

      return;
    }

    const roomId = socketToRoom.get(socketId);

    if (!roomId) {
      return;
    }

    const connection = activeConnections.get(roomId);

    if (!connection) {
      socketToRoom.delete(socketId);
      return;
    }

    const [firstSocketId, secondSocketId] = connection.participants;
    const firstUser = users[firstSocketId];
    const secondUser = users[secondSocketId];

    if (!firstUser || !secondUser) {
      clearConnection(roomId);
      emitBreakConnection(connection.participants, reason);
      return;
    }

    if (getDistance(firstUser, secondUser) >= PROXIMITY_RADIUS) {
      clearConnection(roomId);
      emitBreakConnection(connection.participants, reason);
    }
  };

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
      validateDistanceForSocket(
        socket.id,
        "Chat ended because one of you moved out of range."
      );
    });

    socket.on("chat_request_sent", ({ toUserId }) => {
      const sender = users[socket.id];
      const receiver = getUserByUserId(toUserId);

      if (!sender || !receiver || sender.socketId === receiver.socketId) {
        socket.emit("chat_error", {
          message: "That player is unavailable for chat right now.",
        });
        return;
      }

      if (getDistance(sender, receiver) >= PROXIMITY_RADIUS) {
        socket.emit("chat_error", {
          message: "Move within 150px before sending a chat request.",
        });
        return;
      }

      if (isSocketBusy(sender.socketId) || isSocketBusy(receiver.socketId)) {
        socket.emit("chat_error", {
          message: "One of the players is already in another chat flow.",
        });
        return;
      }

      const requestKey = `${sender.socketId}__${receiver.socketId}`;
      const request = {
        requestKey,
        senderSocketId: sender.socketId,
        senderUserId: sender.userId,
        receiverSocketId: receiver.socketId,
        receiverUserId: receiver.userId,
      };

      pendingRequests.set(requestKey, request);
      socketToPendingRequest.set(sender.socketId, requestKey);
      socketToPendingRequest.set(receiver.socketId, requestKey);

      io.to(sender.socketId).emit("chat_request_pending", {
        partner: getParticipantSnapshot(receiver),
        chatStatus: CHAT_STATUS.PENDING_SENT,
      });

      io.to(receiver.socketId).emit("chat_request_received", {
        partner: getParticipantSnapshot(sender),
        chatStatus: CHAT_STATUS.PENDING_RECEIVED,
      });
    });

    socket.on("chat_request_accepted", ({ fromUserId }) => {
      const receiver = users[socket.id];
      const requestKey = socketToPendingRequest.get(socket.id);
      const request = requestKey ? pendingRequests.get(requestKey) : null;

      if (!receiver || !request || request.senderUserId !== fromUserId) {
        socket.emit("chat_error", {
          message: "That chat request is no longer available.",
        });
        return;
      }

      const sender = users[request.senderSocketId];

      if (!sender) {
        clearPendingRequest(requestKey);
        socket.emit("chat_error", {
          message: "The requesting player is no longer connected.",
        });
        return;
      }

      if (getDistance(sender, receiver) >= PROXIMITY_RADIUS) {
        clearPendingRequest(requestKey);
        emitBreakConnection(
          [request.senderSocketId, request.receiverSocketId],
          "Chat request expired because one of you moved out of range."
        );
        return;
      }

      clearPendingRequest(requestKey);

      const roomId = `chat_${Date.now()}_${sender.socketId}_${receiver.socketId}`;
      const senderSocket = io.sockets.sockets.get(sender.socketId);
      const receiverSocket = io.sockets.sockets.get(receiver.socketId);

      senderSocket?.join(roomId);
      receiverSocket?.join(roomId);

      const connection = {
        roomId,
        participants: [sender.socketId, receiver.socketId],
      };

      activeConnections.set(roomId, connection);
      socketToRoom.set(sender.socketId, roomId);
      socketToRoom.set(receiver.socketId, roomId);

      io.to(sender.socketId).emit("chat_connected", {
        roomId,
        partner: getParticipantSnapshot(receiver),
        chatStatus: CHAT_STATUS.CONNECTED,
      });

      io.to(receiver.socketId).emit("chat_connected", {
        roomId,
        partner: getParticipantSnapshot(sender),
        chatStatus: CHAT_STATUS.CONNECTED,
      });
    });

    socket.on("chat_request_declined", ({ fromUserId }) => {
      const receiver = users[socket.id];
      const requestKey = socketToPendingRequest.get(socket.id);
      const request = requestKey ? pendingRequests.get(requestKey) : null;

      if (!receiver || !request || request.senderUserId !== fromUserId) {
        return;
      }

      clearPendingRequest(requestKey);

      io.to(request.senderSocketId).emit("break_connection", {
        reason: `${receiver.userId} declined your chat request.`,
        partner: getParticipantSnapshot(receiver),
        chatStatus: CHAT_STATUS.IDLE,
      });

      io.to(request.receiverSocketId).emit("break_connection", {
        reason: "Chat request declined.",
        partner: getParticipantSnapshot(users[request.senderSocketId]),
        chatStatus: CHAT_STATUS.IDLE,
      });
    });

    socket.on("send_chat_message", ({ roomId, message }) => {
      const sender = users[socket.id];
      const connection = activeConnections.get(roomId);
      const trimmedMessage = typeof message === "string" ? message.trim() : "";

      if (
        !sender ||
        !connection ||
        !connection.participants.includes(socket.id) ||
        !trimmedMessage
      ) {
        return;
      }

      const receiverSocketId = connection.participants.find(
        (socketId) => socketId !== socket.id
      );
      const receiver = users[receiverSocketId];

      if (!receiver || getDistance(sender, receiver) >= PROXIMITY_RADIUS) {
        clearConnection(roomId);
        emitBreakConnection(
          connection.participants,
          "Chat ended because one of you moved out of range."
        );
        return;
      }

      const payload = {
        id: `${Date.now()}-${socket.id}`,
        roomId,
        conversationId: buildConversationId(sender.userId, receiver.userId),
        fromSocketId: sender.socketId,
        fromUserId: sender.userId,
        toSocketId: receiver.socketId,
        toUserId: receiver.userId,
        message: trimmedMessage,
        createdAt: new Date().toISOString(),
      };

      io.to(roomId).emit("chat_message", payload);
    });

    socket.on("disconnect", async () => {
      const currentUser = users[socket.id];

      if (!currentUser) {
        console.log("Socket disconnected before join:", socket.id);
        return;
      }

      breakChatStateForSocket(
        socket.id,
        `${currentUser.userId} disconnected, so the chat was closed.`
      );

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
