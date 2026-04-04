import { io } from "socket.io-client";

const serverUrl = import.meta.env.VITE_SERVER_URL;

export const socket = io(serverUrl, {
  autoConnect: false,
  transports: ["websocket"],
  timeout: 5000,
  reconnection: true,
  path: "/socket.io",
});
