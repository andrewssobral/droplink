import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Simple in-memory channels. Swap for Redis or a database in production.
const channels = new Map(); // key: channelId, value: { last: payload, clients: Set(ws) }

function getOrCreateChannel(id) {
  if (!channels.has(id)) {
    channels.set(id, { last: null, clients: new Set() });
  }
  return channels.get(id);
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/latest', (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).json({ error: 'channel required' });
  const ch = channels.get(channel);
  return res.json(ch?.last || null);
});

app.post('/share', (req, res) => {
  const { channel, url, title, from } = req.body || {};
  if (!channel || !url) return res.status(400).json({ error: 'channel and url required' });
  const payload = {
    id: uuidv4(),
    type: 'link',
    url,
    title: title || url,
    from: from || 'anon',
    ts: Date.now()
  };
  const ch = getOrCreateChannel(channel);
  ch.last = payload;
  // Broadcast to any connected WebSocket clients on the same channel.
  ch.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event: 'new-link', data: payload }));
    }
  });
  res.json({ ok: true, id: payload.id });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, 'http://localhost');
  const channel = url.searchParams.get('channel');
  if (!channel) {
    socket.close(1008, 'channel required');
    return;
  }
  console.log(`WebSocket client connected on channel "${channel}"`);
  const ch = getOrCreateChannel(channel);
  ch.clients.add(socket);

  socket.send(JSON.stringify({ event: 'hello', data: { channel } }));

  socket.on('close', () => {
    ch.clients.delete(socket);
    console.log(`WebSocket client disconnected from channel "${channel}"`);
  });

  socket.on('error', (err) => {
    console.error(`WebSocket error on channel "${channel}":`, err.message);
  });
});

server.listen(PORT, () => {
  console.log(`DropLink server ready on http://localhost:${PORT}`);
});
