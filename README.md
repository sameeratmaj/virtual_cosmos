# Virtual Cosmos

A 2D proximity-based virtual environment built with:

- React + Vite
- PixiJS
- Tailwind CSS
- Node.js + Express
- Socket.io
- MongoDB

## Project Structure

```text
Virtual_Cosmos/
  client/   # React + PixiJS frontend
  server/   # Express + Socket.io backend
```

## 1. Install Dependencies

```bash
npm install
npm --workspace server install
npm --workspace client install
```

## 2. Configure Environment

Create `server/.env`:

```env
PORT=4000
CLIENT_URL=http://localhost:5173
MONGODB_URI=mongodb://127.0.0.1:27017/virtual-cosmos
```

## 3. Run the App

In one terminal:

```bash
npm run dev:server
```

In another terminal:

```bash
npm run dev:client
```

## Production Build

Build the client and run the Node server:

```bash
npm run build
npm run start
```

In production, Express serves `client/dist` and Socket.io runs on the same deployed origin.

## Step-by-Step Modules

1. `server/src/socket/gameSocket.js`
   Handles player join, movement sync, disconnect cleanup, chat messaging, and MongoDB-backed session persistence.
2. `client/src/components/VirtualCosmos.jsx`
   Creates the PixiJS stage, moves the local player with WASD/arrow keys, and renders remote players.
3. `client/src/App.jsx`
   Hosts the floating proximity chat panel and listens for proximity events.

## Proximity Rule

```text
Distance = sqrt((x2 - x1)^2 + (y2 - y1)^2)
If Distance < 150, open the chat panel.
If Distance >= 150, close the chat panel.
```

## MongoDB Persistence

Each `PlayerSession` document stores:

- `userId`
- `x`
- `y`
- `socketId`
- `isActive`
- `lastSeenAt`

This means the backend now persists both the player's last position and their most recent connection state in MongoDB.

## Deploy Live

Recommended setup: deploy as a single Node service on Render, Railway, or Fly.io with MongoDB Atlas.

Required environment variables:

```env
NODE_ENV=production
PORT=4000
CLIENT_URL=https://your-app-domain.com
ALLOWED_ORIGINS=https://your-app-domain.com
MONGODB_URI=your-mongodb-atlas-connection-string
```

This repo includes [render.yaml](C:/Users/SAMEER/Desktop/Projects/tutedude/Virtual_Cosmos/render.yaml) for an easy Render deployment.
