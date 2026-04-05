import { useEffect, useRef, useState } from "react";
import VirtualCosmos from "./components/VirtualCosmos";
import { socket } from "./lib/socket";
import { getDistance } from "./utils/distance";

const INITIAL_PLAYER = {
  socketId: null,
  userId: "loading",
  x: 2500,
  y: 2500,
};
const CHAT_STATUS = {
  IDLE: "IDLE",
  PENDING_SENT: "PENDING_SENT",
  PENDING_RECEIVED: "PENDING_RECEIVED",
  CONNECTED: "CONNECTED",
};

export default function App() {
  const [localPlayer, setLocalPlayer] = useState(INITIAL_PLAYER);
  const [remotePlayers, setRemotePlayers] = useState({});
  const [activeChatPartner, setActiveChatPartner] = useState(null);
  const [chatStatus, setChatStatus] = useState(CHAT_STATUS.IDLE);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [chatMessages, setChatMessages] = useState({});
  const [chatError, setChatError] = useState("");
  const [connectionState, setConnectionState] = useState({
    connected: false,
    socketId: null,
    userId: null,
    lastError: "",
  });
  const remotePlayersRef = useRef(remotePlayers);

  useEffect(() => {
    remotePlayersRef.current = remotePlayers;
  }, [remotePlayers]);

  const remoteCount = Object.keys(remotePlayers).length;
  const activeMessages = activeRoomId ? chatMessages[activeRoomId] ?? [] : [];

  useEffect(() => {
    const handleChatMessage = (message) => {
      setChatMessages((currentMessages) => {
        const conversationMessages = currentMessages[message.roomId] ?? [];

        return {
          ...currentMessages,
          [message.roomId]: [...conversationMessages, message],
        };
      });
      setChatError("");
    };

    const handleRequestPending = ({ partner, chatStatus: nextStatus }) => {
      setActiveChatPartner(partner);
      setChatStatus(nextStatus);
      setActiveRoomId(null);
      setDraftMessage("");
      setChatError("");
    };

    const handleRequestReceived = ({ partner, chatStatus: nextStatus }) => {
      setActiveChatPartner(partner);
      setChatStatus(nextStatus);
      setActiveRoomId(null);
      setDraftMessage("");
      setChatError("");
    };

    const handleChatConnected = ({ partner, roomId, chatStatus: nextStatus }) => {
      setActiveChatPartner(partner);
      setActiveRoomId(roomId);
      setChatStatus(nextStatus);
      setChatError("");
    };

    const handleBreakConnection = ({ reason }) => {
      setChatStatus(CHAT_STATUS.IDLE);
      setActiveChatPartner(null);
      setActiveRoomId(null);
      setDraftMessage("");
      setChatError(reason ?? "");
    };

    const handleSocketDisconnect = () => {
      setChatStatus(CHAT_STATUS.IDLE);
      setActiveChatPartner(null);
      setActiveRoomId(null);
      setDraftMessage("");
    };

    const handleChatError = ({ message }) => {
      setChatStatus(CHAT_STATUS.IDLE);
      setActiveChatPartner(null);
      setActiveRoomId(null);
      setChatError(message);
    };

    socket.on("chat_message", handleChatMessage);
    socket.on("chat_request_pending", handleRequestPending);
    socket.on("chat_request_received", handleRequestReceived);
    socket.on("chat_connected", handleChatConnected);
    socket.on("break_connection", handleBreakConnection);
    socket.on("disconnect", handleSocketDisconnect);
    socket.on("chat_error", handleChatError);

    return () => {
      socket.off("chat_message", handleChatMessage);
      socket.off("chat_request_pending", handleRequestPending);
      socket.off("chat_request_received", handleRequestReceived);
      socket.off("chat_connected", handleChatConnected);
      socket.off("break_connection", handleBreakConnection);
      socket.off("disconnect", handleSocketDisconnect);
      socket.off("chat_error", handleChatError);
    };
  }, []);

  useEffect(() => {
    if (chatStatus !== CHAT_STATUS.CONNECTED) {
      setDraftMessage("");
    }
  }, [chatStatus]);

  const handleAvatarClick = (targetUserId) => {
    if (chatStatus !== CHAT_STATUS.IDLE) {
      return;
    }

    const targetPlayer = Object.values(remotePlayersRef.current).find(
      (player) => player.userId === targetUserId
    );

    if (!targetPlayer) {
      setChatError("That player is no longer available.");
      return;
    }

    if (getDistance(localPlayer, targetPlayer) >= 150) {
      setChatError("Move within 150px before sending a chat request.");
      return;
    }

    setActiveChatPartner(targetPlayer);
    setChatStatus(CHAT_STATUS.PENDING_SENT);
    setActiveRoomId(null);
    setChatError("");
    socket.emit("chat_request_sent", { toUserId: targetUserId });
  };

  const handleAcceptChatRequest = () => {
    if (chatStatus !== CHAT_STATUS.PENDING_RECEIVED || !activeChatPartner?.userId) {
      return;
    }

    socket.emit("chat_request_accepted", {
      fromUserId: activeChatPartner.userId,
    });
  };

  const handleDeclineChatRequest = () => {
    if (chatStatus !== CHAT_STATUS.PENDING_RECEIVED || !activeChatPartner?.userId) {
      return;
    }

    socket.emit("chat_request_declined", {
      fromUserId: activeChatPartner.userId,
    });
  };

  const handleSendMessage = () => {
    const message = draftMessage.trim();

    if (chatStatus !== CHAT_STATUS.CONNECTED || !activeRoomId || !message) {
      return;
    }

    socket.emit("send_chat_message", {
      roomId: activeRoomId,
      message,
    });

    setDraftMessage("");
  };

  const handleMessageKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      
        

        <section className="relative h-full w-full">
          <VirtualCosmos
            localPlayer={localPlayer}
            setLocalPlayer={setLocalPlayer}
            remotePlayers={remotePlayers}
            setRemotePlayers={setRemotePlayers}
            setConnectionState={setConnectionState}
            chatStatus={chatStatus}
            onAvatarClick={handleAvatarClick}
          />

          {chatStatus === CHAT_STATUS.CONNECTED && activeChatPartner ? (
            <aside className="absolute right-4 top-4 w-full max-w-sm rounded-2xl border border-emerald-400/30 bg-slate-950/95 p-4 shadow-xl shadow-emerald-950/40 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-emerald-300">
                    CONNECTED
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    Chat with {activeChatPartner.userId}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Messages stay active only while both players remain within 150px.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-3 text-sm text-slate-400">
                This private room was created after both players agreed to chat.
              </div>

              <div className="mt-4 h-52 space-y-3 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/90 p-3">
                {activeMessages.length > 0 ? (
                  activeMessages.map((message) => {
                    const isMine = message.fromUserId === localPlayer.userId;

                    return (
                      <div
                        key={message.id}
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                          isMine
                            ? "ml-auto bg-emerald-500/20 text-emerald-50"
                            : "bg-slate-800 text-slate-100"
                        }`}
                      >
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                          {isMine ? "You" : message.fromUserId}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap">{message.message}</p>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-sm text-slate-500">
                    No messages yet. Start the conversation while the connection is active.
                  </div>
                )}
              </div>

              <label className="mt-4 block text-sm text-slate-300">
                Draft message
              </label>
              <textarea
                value={draftMessage}
                onChange={(event) => setDraftMessage(event.target.value)}
                onKeyDown={handleMessageKeyDown}
                placeholder="Say hello..."
                className="mt-2 h-28 w-full resize-none rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400"
              />
              {chatError ? (
                <p className="mt-2 text-sm text-rose-300">{chatError}</p>
              ) : null}
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleSendMessage}
                  className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                  disabled={chatStatus !== CHAT_STATUS.CONNECTED || !draftMessage.trim()}
                >
                  Send
                </button>
              </div>
            </aside>
          ) : chatStatus === CHAT_STATUS.PENDING_RECEIVED && activeChatPartner ? (
            <aside className="absolute right-4 top-4 w-full max-w-sm rounded-2xl border border-amber-400/30 bg-slate-950/95 p-4 shadow-xl shadow-amber-950/40 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.25em] text-amber-300">
                PENDING_RECEIVED
              </p>
              <h2 className="mt-2 text-lg font-semibold text-white">
                {activeChatPartner.userId} wants to chat
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Accept to create a temporary room. This request will break if either player moves out of the 150px range.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={handleAcceptChatRequest}
                  className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={handleDeclineChatRequest}
                  className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
                >
                  Decline
                </button>
              </div>
              {chatError ? (
                <p className="mt-3 text-sm text-rose-300">{chatError}</p>
              ) : null}
            </aside>
          ) : chatStatus === CHAT_STATUS.PENDING_SENT && activeChatPartner ? (
            <aside className="absolute right-4 top-4 max-w-sm rounded-2xl border border-sky-400/30 bg-slate-950/90 p-4 text-sm text-slate-300 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.25em] text-sky-300">
                PENDING_SENT
              </p>
              <h2 className="mt-2 text-lg font-semibold text-white">
                Waiting for {activeChatPartner.userId}
              </h2>
              <p className="mt-2 text-slate-400">
                Your chat request is pending. Stay within 150px until they accept.
              </p>
              {chatError ? (
                <p className="mt-3 text-sm text-rose-300">{chatError}</p>
              ) : null}
            </aside>
          ) : (
            <aside className="absolute right-4 top-4 max-w-sm rounded-2xl border border-slate-700/60 bg-slate-950/85 p-4 text-sm text-slate-400 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                IDLE
              </p>
              <p className="mt-2">
                Move within 150px of another player, then click their avatar to request permission to chat.
              </p>
              {chatError ? (
                <p className="mt-3 text-sm text-rose-300">{chatError}</p>
              ) : null}
            </aside>
          )}
        </section>
      
    </main>
  );
}
