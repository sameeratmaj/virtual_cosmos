import { useEffect, useMemo, useState } from "react";
import VirtualCosmos from "./components/VirtualCosmos";
import { socket } from "./lib/socket";

const INITIAL_PLAYER = {
  socketId: null,
  userId: "loading",
  x: 320,
  y: 240,
};

export default function App() {
  const [localPlayer, setLocalPlayer] = useState(INITIAL_PLAYER);
  const [remotePlayers, setRemotePlayers] = useState({});
  const [activeChatPartner, setActiveChatPartner] = useState(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [chatMessages, setChatMessages] = useState({});
  const [chatError, setChatError] = useState("");
  const [connectionState, setConnectionState] = useState({
    connected: false,
    socketId: null,
    userId: null,
    lastError: "",
  });

  const remoteCount = useMemo(() => Object.keys(remotePlayers).length, [remotePlayers]);
  const activeConversationId = useMemo(() => {
    if (!activeChatPartner?.userId || !localPlayer.userId || localPlayer.userId === "loading") {
      return null;
    }

    return [localPlayer.userId, activeChatPartner.userId].sort().join("__");
  }, [activeChatPartner, localPlayer.userId]);

  const activeMessages = activeConversationId ? chatMessages[activeConversationId] ?? [] : [];

  useEffect(() => {
    const handleChatMessage = (message) => {
      setChatMessages((currentMessages) => {
        const conversationMessages = currentMessages[message.conversationId] ?? [];

        return {
          ...currentMessages,
          [message.conversationId]: [...conversationMessages, message],
        };
      });
      setChatError("");
    };

    const handleChatError = ({ message }) => {
      setChatError(message);
    };

    socket.on("chat_message", handleChatMessage);
    socket.on("chat_error", handleChatError);

    return () => {
      socket.off("chat_message", handleChatMessage);
      socket.off("chat_error", handleChatError);
    };
  }, []);

  useEffect(() => {
    if (!activeChatPartner) {
      setDraftMessage("");
      setChatError("");
    }
  }, [activeChatPartner]);

  const handleSendMessage = () => {
    const message = draftMessage.trim();

    if (!activeChatPartner?.socketId || !message) {
      return;
    }

    socket.emit("send_chat_message", {
      toSocketId: activeChatPartner.socketId,
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
    <main className="min-h-screen px-4 py-6 text-slate-100 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-sky-400/20 bg-slate-950/60 p-6 backdrop-blur">
          <p className="text-sm uppercase tracking-[0.3em] text-sky-300/80">
            Virtual Cosmos
          </p>
          <h1 className="mt-2 text-4xl font-semibold text-white">
            Proximity-based multiplayer space
          </h1>
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-300">
            <span className="rounded-full border border-slate-700 px-3 py-1">
              You: {localPlayer.userId}
            </span>
            <span className="rounded-full border border-slate-700 px-3 py-1">
              Remote players: {remoteCount}
            </span>
            <span className="rounded-full border border-slate-700 px-3 py-1">
              Controls: WASD / Arrow Keys
            </span>
            <span className="rounded-full border border-slate-700 px-3 py-1">
              Socket: {connectionState.connected ? "connected" : "disconnected"}
            </span>
            <span className="rounded-full border border-slate-700 px-3 py-1">
              Socket ID: {connectionState.socketId ?? "pending"}
            </span>
          </div>
          {connectionState.lastError ? (
            <p className="mt-3 text-sm text-rose-300">
              Socket error: {connectionState.lastError}
            </p>
          ) : null}
        </header>

        <section className="relative">
          <VirtualCosmos
            localPlayer={localPlayer}
            setLocalPlayer={setLocalPlayer}
            remotePlayers={remotePlayers}
            setRemotePlayers={setRemotePlayers}
            setActiveChatPartner={setActiveChatPartner}
            setConnectionState={setConnectionState}
          />

          {activeChatPartner ? (
            <aside className="absolute right-4 top-4 w-full max-w-sm rounded-2xl border border-emerald-400/30 bg-slate-950/95 p-4 shadow-xl shadow-emerald-950/40 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-emerald-300">
                    PROXIMITY_CONNECTED
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    Chat with {activeChatPartner.userId}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    This panel stays visible while the player is within 150px.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-3 text-sm text-slate-400">
                Messages in this room are delivered only while both players stay
                within the 150px proximity radius.
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
                  disabled={!draftMessage.trim()}
                >
                  Send
                </button>
              </div>
            </aside>
          ) : (
            <aside className="absolute right-4 top-4 max-w-sm rounded-2xl border border-slate-700/60 bg-slate-950/85 p-4 text-sm text-slate-400 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                PROXIMITY_DISCONNECTED
              </p>
              <p className="mt-2">
                Move within 150px of another player to auto-open the chat room.
              </p>
            </aside>
          )}
        </section>
      </div>
    </main>
  );
}
