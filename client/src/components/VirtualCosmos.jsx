import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import { socket } from "../lib/socket";
import { getDistance } from "../utils/distance";

const DEFAULT_VIEWPORT_WIDTH = 960;
const DEFAULT_VIEWPORT_HEIGHT = 640;
const WORLD_WIDTH = 5000;
const WORLD_HEIGHT = 5000;
const PLAYER_SPEED = 3;
const PROXIMITY_RADIUS = 150;
const PLAYER_PADDING = 24;

function drawBackground(background) {
  background.clear();
  background.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill(0x020617);

  for (let x = 0; x <= WORLD_WIDTH; x += 250) {
    background.moveTo(x, 0).lineTo(x, WORLD_HEIGHT).stroke({
      width: x % 1000 === 0 ? 2 : 1,
      color: 0x38bdf8,
      alpha: x % 1000 === 0 ? 0.14 : 0.06,
    });
  }

  for (let y = 0; y <= WORLD_HEIGHT; y += 250) {
    background.moveTo(0, y).lineTo(WORLD_WIDTH, y).stroke({
      width: y % 1000 === 0 ? 2 : 1,
      color: 0x38bdf8,
      alpha: y % 1000 === 0 ? 0.14 : 0.06,
    });
  }

  background.rect(PLAYER_PADDING, PLAYER_PADDING, WORLD_WIDTH - PLAYER_PADDING * 2, WORLD_HEIGHT - PLAYER_PADDING * 2).stroke({
    width: 4,
    color: 0x22d3ee,
    alpha: 0.22,
  });

  for (let index = 0; index < 220; index += 1) {
    const x = ((index * 347) % (WORLD_WIDTH - 80)) + 40;
    const y = ((index * 563) % (WORLD_HEIGHT - 80)) + 40;
    const radius = index % 6 === 0 ? 2.2 : 1.2;
    const alpha = index % 5 === 0 ? 0.85 : 0.45;

    background.circle(x, y, radius).fill({
      color: 0xe2e8f0,
      alpha,
    });
  }
}

function createPlayerGraphic(color) {
  const avatar = new Graphics();
  avatar.circle(0, 0, 18).fill(color);
  avatar.circle(0, 0, 22).stroke({ width: 2, color: 0xffffff, alpha: 0.3 });
  return avatar;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    target.isContentEditable
  );
}

export default function VirtualCosmos({
  localPlayer,
  setLocalPlayer,
  remotePlayers,
  setRemotePlayers,
  setConnectionState,
  chatStatus,
  onAvatarClick,
}) {
  const sceneRef = useRef(null);
  const appRef = useRef(null);
  const worldRef = useRef(null);
  const localAvatarRef = useRef(null);
  const remoteAvatarMapRef = useRef(new Map());
  const pressedKeysRef = useRef({});
  const localPlayerRef = useRef(localPlayer);
  const remotePlayersRef = useRef(remotePlayers);
  const chatStatusRef = useRef(chatStatus);
  const onAvatarClickRef = useRef(onAvatarClick);
  const viewportRef = useRef({
    width: DEFAULT_VIEWPORT_WIDTH,
    height: DEFAULT_VIEWPORT_HEIGHT,
  });

  useEffect(() => {
    localPlayerRef.current = localPlayer;
  }, [localPlayer]);

  useEffect(() => {
    remotePlayersRef.current = remotePlayers;
  }, [remotePlayers]);

  useEffect(() => {
    chatStatusRef.current = chatStatus;
  }, [chatStatus]);

  useEffect(() => {
    onAvatarClickRef.current = onAvatarClick;
  }, [onAvatarClick]);

  const updateRemoteAvatarStates = () => {
    const activeMap = remoteAvatarMapRef.current;
    const currentPlayer = localPlayerRef.current;

    if (!currentPlayer) {
      return;
    }

    Object.values(remotePlayersRef.current).forEach((player) => {
      const avatar = activeMap.get(player.socketId);

      if (!avatar) {
        return;
      }

      avatar.position.set(player.x, player.y);

      const isClickable =
        chatStatusRef.current === "IDLE" &&
        getDistance(currentPlayer, player) < PROXIMITY_RADIUS;

      avatar.eventMode = isClickable ? "static" : "none";
      avatar.cursor = isClickable ? "pointer" : "default";
      avatar.alpha = isClickable ? 1 : 0.55;
    });
  };

  const syncRemoteAvatars = () => {
    const world = worldRef.current;

    if (!world) {
      return;
    }

    const activeMap = remoteAvatarMapRef.current;

    Object.values(remotePlayersRef.current).forEach((player) => {
      if (!activeMap.has(player.socketId)) {
        const avatar = createPlayerGraphic(0xf97316);
        avatar.eventMode = "none";
        avatar.cursor = "default";

        const label = new Text({
          text: player.userId.slice(0, 8),
          style: {
            fill: "#f8fafc",
            fontSize: 12,
          },
        });
        label.anchor.set(0.5, 0);
        label.position.set(0, 26);
        avatar.addChild(label);
        avatar.on("pointertap", () => {
          onAvatarClickRef.current(player.userId);
        });
        world.addChild(avatar);
        activeMap.set(player.socketId, avatar);
      }
    });

    activeMap.forEach((avatar, socketId) => {
      if (!remotePlayersRef.current[socketId]) {
        world.removeChild(avatar);
        avatar.destroy({ children: true });
        activeMap.delete(socketId);
      }
    });

    updateRemoteAvatarStates();
  };

  const updateCamera = () => {
    const world = worldRef.current;
    const currentPlayer = localPlayerRef.current;

    if (!world || !currentPlayer) {
      return;
    }

    const { width, height } = viewportRef.current;
    const maxCameraX = Math.max(0, WORLD_WIDTH - width);
    const maxCameraY = Math.max(0, WORLD_HEIGHT - height);
    const cameraX = clamp(currentPlayer.x - width / 2, 0, maxCameraX);
    const cameraY = clamp(currentPlayer.y - height / 2, 0, maxCameraY);

    world.position.set(-cameraX, -cameraY);
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.code.startsWith("Arrow") || event.code.startsWith("Key")) {
        event.preventDefault();
      }

      pressedKeysRef.current[event.code] = true;
    };

    const handleKeyUp = (event) => {
      pressedKeysRef.current[event.code] = false;
    };

    const handleBlur = () => {
      pressedKeysRef.current = {};
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let resizeObserver = null;

    const bootPixi = async () => {
      const app = new Application();
      const viewportWidth =
        window.innerWidth;
      const viewportHeight =
        window.innerHeight;

      await app.init({
        width: viewportWidth,
        height: viewportHeight,
        background: "#0f172a",
        antialias: true,
        resizeTo: window,
      });

      if (!mounted || !sceneRef.current) {
        await app.destroy(true, { children: true });
        return;
      }

      appRef.current = app;
      viewportRef.current = { width: viewportWidth, height: viewportHeight };
      sceneRef.current.appendChild(app.canvas);

      const world = new Container();
      app.stage.addChild(world);
      worldRef.current = world;

      const background = new Graphics();
      drawBackground(background);
      world.addChild(background);

      const localAvatar = createPlayerGraphic(0x22c55e);
      localAvatar.eventMode = "static";
      localAvatar.cursor = "default";
      localAvatar.position.set(localPlayerRef.current.x, localPlayerRef.current.y);
      world.addChild(localAvatar);
      localAvatarRef.current = localAvatar;

      const localLabel = new Text({
        text: "You",
        style: {
          fill: "#f8fafc",
          fontSize: 12,
        },
      });
      localLabel.anchor.set(0.5, 0);
      localLabel.position.set(0, 26);
      localAvatar.addChild(localLabel);

      syncRemoteAvatars();
      updateCamera();

      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];

        if (!entry || !appRef.current) {
          return;
        }

        const nextWidth = Math.max(320, Math.round(entry.contentRect.width));
        const nextHeight = Math.max(320, Math.round(entry.contentRect.height));

        viewportRef.current = { width: nextWidth, height: nextHeight };
        appRef.current.renderer.resize(nextWidth, nextHeight);
        updateCamera();
      });

      resizeObserver.observe(sceneRef.current);

      app.ticker.add(() => {
        const currentPlayer = localPlayerRef.current;

        if (!currentPlayer) {
          return;
        }

        const pressedKeys = pressedKeysRef.current;
        let nextX = currentPlayer.x;
        let nextY = currentPlayer.y;

        if (pressedKeys.KeyW || pressedKeys.ArrowUp) nextY -= PLAYER_SPEED;
        if (pressedKeys.KeyS || pressedKeys.ArrowDown) nextY += PLAYER_SPEED;
        if (pressedKeys.KeyA || pressedKeys.ArrowLeft) nextX -= PLAYER_SPEED;
        if (pressedKeys.KeyD || pressedKeys.ArrowRight) nextX += PLAYER_SPEED;

        nextX = clamp(nextX, PLAYER_PADDING, WORLD_WIDTH - PLAYER_PADDING);
        nextY = clamp(nextY, PLAYER_PADDING, WORLD_HEIGHT - PLAYER_PADDING);

        const moved = nextX !== currentPlayer.x || nextY !== currentPlayer.y;

        if (moved) {
          const updatedPlayer = { ...currentPlayer, x: nextX, y: nextY };
          localPlayerRef.current = updatedPlayer;
          setLocalPlayer(updatedPlayer);

          if (socket.connected && currentPlayer.socketId) {
            socket.emit("move", { x: nextX, y: nextY });
          }
        }

        if (localAvatarRef.current) {
          localAvatarRef.current.position.set(
            localPlayerRef.current.x,
            localPlayerRef.current.y
          );
        }

        updateRemoteAvatarStates();
        updateCamera();
      });
    };

    bootPixi();

    return () => {
      mounted = false;
      resizeObserver?.disconnect();
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      worldRef.current = null;
    };
  }, [setLocalPlayer]);

  useEffect(() => {
    syncRemoteAvatars();
    updateCamera();
  }, [remotePlayers]);

  useEffect(() => {
    updateRemoteAvatarStates();
  }, [chatStatus]);

  useEffect(() => {
    const userId = localStorage.getItem("virtual-cosmos-user-id") ?? crypto.randomUUID();
    localStorage.setItem("virtual-cosmos-user-id", userId);

    const handleInitState = ({ self, players }) => {
      localPlayerRef.current = self;
      setLocalPlayer(self);

      const remotes = players.reduce((accumulator, player) => {
        if (player.socketId !== self.socketId) {
          accumulator[player.socketId] = player;
        }

        return accumulator;
      }, {});

      setRemotePlayers(remotes);
      setConnectionState({
        connected: true,
        socketId: self.socketId,
        userId: self.userId,
      });
    };

    const handlePlayerJoined = (player) => {
      setRemotePlayers((currentPlayers) => ({
        ...currentPlayers,
        [player.socketId]: player,
      }));
    };

    const handlePlayerMoved = (player) => {
      setRemotePlayers((currentPlayers) => ({
        ...currentPlayers,
        [player.socketId]: player,
      }));
    };

    const handlePlayerDisconnected = ({ socketId }) => {
      setRemotePlayers((currentPlayers) => {
        const updatedPlayers = { ...currentPlayers };
        delete updatedPlayers[socketId];
        return updatedPlayers;
      });
    };

    const handleSocketConnect = () => {
      setConnectionState({
        connected: true,
        socketId: socket.id ?? null,
        userId,
      });
      socket.emit("join", { userId });
    };

    const handleSocketDisconnect = () => {
      setConnectionState((currentState) => ({
        ...currentState,
        connected: false,
        socketId: null,
      }));
    };

    const handleJoinError = ({ message }) => {
      setConnectionState((currentState) => ({
        ...currentState,
        lastError: message,
      }));
    };

    const handleConnectError = (error) => {
      setConnectionState((currentState) => ({
        ...currentState,
        connected: false,
        socketId: null,
        lastError: error.message,
      }));
    };

    socket.on("init_state", handleInitState);
    socket.on("player_joined", handlePlayerJoined);
    socket.on("player_moved", handlePlayerMoved);
    socket.on("player_disconnected", handlePlayerDisconnected);
    socket.on("connect", handleSocketConnect);
    socket.on("disconnect", handleSocketDisconnect);
    socket.on("join_error", handleJoinError);
    socket.on("connect_error", handleConnectError);

    socket.connect();

    return () => {
      socket.off("init_state", handleInitState);
      socket.off("player_joined", handlePlayerJoined);
      socket.off("player_moved", handlePlayerMoved);
      socket.off("player_disconnected", handlePlayerDisconnected);
      socket.off("connect", handleSocketConnect);
      socket.off("disconnect", handleSocketDisconnect);
      socket.off("join_error", handleJoinError);
      socket.off("connect_error", handleConnectError);
      socket.disconnect();
    };
  }, [setConnectionState, setLocalPlayer, setRemotePlayers]);

  return (
    <div ref={sceneRef} className="h-screen w-screen bg-slate-950" />
  );
}
