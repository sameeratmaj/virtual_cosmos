import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import { socket } from "../lib/socket";
import { getDistance } from "../utils/distance";

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 640;
const PLAYER_SPEED = 3;
const PROXIMITY_RADIUS = 150;

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
  setActiveChatPartner,
  setConnectionState,
}) {
  const sceneRef = useRef(null);
  const appRef = useRef(null);
  const worldRef = useRef(null);
  const localAvatarRef = useRef(null);
  const remoteAvatarMapRef = useRef(new Map());
  const pressedKeysRef = useRef({});
  const localPlayerRef = useRef(localPlayer);
  const remotePlayersRef = useRef(remotePlayers);
  const activePartnerRef = useRef(null);

  useEffect(() => {
    localPlayerRef.current = localPlayer;
  }, [localPlayer]);

  useEffect(() => {
    remotePlayersRef.current = remotePlayers;
  }, [remotePlayers]);

  const syncRemoteAvatars = () => {
    const world = worldRef.current;

    if (!world) {
      return;
    }

    const activeMap = remoteAvatarMapRef.current;

    Object.values(remotePlayersRef.current).forEach((player) => {
      if (!activeMap.has(player.socketId)) {
        const avatar = createPlayerGraphic(0xf97316);
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
        world.addChild(avatar);
        activeMap.set(player.socketId, avatar);
      }

      const avatar = activeMap.get(player.socketId);
      avatar.position.set(player.x, player.y);
    });

    activeMap.forEach((avatar, socketId) => {
      if (!remotePlayersRef.current[socketId]) {
        world.removeChild(avatar);
        avatar.destroy({ children: true });
        activeMap.delete(socketId);
      }
    });
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

    const bootPixi = async () => {
      const app = new Application();
      await app.init({
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        background: "#0f172a",
        antialias: true,
      });

      if (!mounted || !sceneRef.current) {
        await app.destroy(true, { children: true });
        return;
      }

      appRef.current = app;
      sceneRef.current.appendChild(app.canvas);

      const world = new Container();
      app.stage.addChild(world);
      worldRef.current = world;

      const background = new Graphics();
      background.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill(0x0f172a);
      background.rect(24, 24, WORLD_WIDTH - 48, WORLD_HEIGHT - 48).stroke({
        width: 2,
        color: 0x38bdf8,
        alpha: 0.18,
      });
      world.addChild(background);

      const localAvatar = createPlayerGraphic(0x22c55e);
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

        nextX = clamp(nextX, 24, WORLD_WIDTH - 24);
        nextY = clamp(nextY, 24, WORLD_HEIGHT - 24);

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

        const nearbyPartner =
          Object.values(remotePlayersRef.current).find(
            (player) =>
              getDistance(localPlayerRef.current, player) < PROXIMITY_RADIUS
          ) ?? null;

        if (nearbyPartner?.socketId !== activePartnerRef.current?.socketId) {
          activePartnerRef.current = nearbyPartner;
          setActiveChatPartner(nearbyPartner);

          const eventName = nearbyPartner
            ? "PROXIMITY_CONNECTED"
            : "PROXIMITY_DISCONNECTED";

          window.dispatchEvent(
            new CustomEvent(eventName, {
              detail: nearbyPartner,
            })
          );
        }
      });
    };

    bootPixi();

    return () => {
      mounted = false;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      worldRef.current = null;
    };
  }, [setActiveChatPartner, setLocalPlayer]);

  useEffect(() => {
    syncRemoteAvatars();
  }, [remotePlayers]);

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
    <div className="overflow-hidden rounded-3xl border border-sky-400/20 bg-slate-900/70 shadow-2xl shadow-sky-950/40">
      <div ref={sceneRef} className="h-[640px] w-full" />
    </div>
  );
}
