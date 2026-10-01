import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken } from '../middleware/auth.js';
import { getRedis, isRedisAvailable } from '../redis.js';

/**
 * WebSocket module.
 *
 * Two jobs:
 *   1. Push live events to connected clients (marketplace activity, trade
 *      updates, anti-cheat flags, leaderboard changes).
 *   2. Keep a presence map so the UI can show who is online.
 *
 * Authentication happens on the upgrade request via a `?token=` query param.
 * An unauthenticated socket may still connect, but it only receives public
 * channels — never anything player-scoped.
 */

interface Client {
  socket: WebSocket;
  playerId: string | null;
  channels: Set<string>;
  alive: boolean;
}

const clients = new Set<Client>();

/** Channels anyone may subscribe to. */
const PUBLIC_CHANNELS = new Set(['marketplace', 'leaderboard', 'season']);

/** Channels that require authentication. */
const PRIVATE_CHANNELS = new Set(['trade', 'anticheat', 'player']);

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket, req) => {
    const url = new URL(req.url ?? '/ws', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');
    const claims = token ? verifyToken(token) : null;

    const client: Client = {
      socket,
      playerId: claims?.playerId ?? null,
      channels: new Set(['marketplace']),
      alive: true,
    };
    clients.add(client);

    send(client, {
      type: 'welcome',
      authenticated: Boolean(claims),
      channels: Array.from(client.channels),
      online: clients.size,
    });

    socket.on('message', (raw) => {
      let msg: { type?: string; channel?: string };
      try {
        msg = JSON.parse(raw.toString()) as { type?: string; channel?: string };
      } catch {
        send(client, { type: 'error', error: 'Malformed JSON' });
        return;
      }

      if (msg.type === 'subscribe' && msg.channel) {
        const channel = msg.channel;

        if (PRIVATE_CHANNELS.has(channel) && !client.playerId) {
          send(client, { type: 'error', error: `Channel '${channel}' requires authentication` });
          return;
        }
        if (!PUBLIC_CHANNELS.has(channel) && !PRIVATE_CHANNELS.has(channel)) {
          send(client, { type: 'error', error: `Unknown channel '${channel}'` });
          return;
        }

        client.channels.add(channel);
        send(client, { type: 'subscribed', channel });
        return;
      }

      if (msg.type === 'unsubscribe' && msg.channel) {
        client.channels.delete(msg.channel);
        send(client, { type: 'unsubscribed', channel: msg.channel });
        return;
      }

      if (msg.type === 'ping') {
        send(client, { type: 'pong', at: Date.now() });
      }
    });

    socket.on('pong', () => {
      client.alive = true;
    });

    socket.on('close', () => {
      clients.delete(client);
    });

    socket.on('error', () => {
      clients.delete(client);
    });
  });

  // Heartbeat — drop sockets that stopped responding.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      try {
        client.socket.ping();
      } catch {
        clients.delete(client);
      }
    }
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));

  // Bridge Redis pub/sub into the socket fan-out, so events published by any
  // API process reach every connected client.
  if (isRedisAvailable()) {
    const subscriber = getRedis().duplicate();
    subscriber
      .subscribe('marketplace', 'trade', 'anticheat', 'run:verified', 'leaderboard')
      .catch(() => undefined);

    subscriber.on('message', (channel, payload) => {
      let parsed: unknown = payload;
      try {
        parsed = JSON.parse(payload);
      } catch {
        // keep the raw string
      }
      broadcast(channel, { type: 'event', channel, payload: parsed });
    });
  }

  return wss;
}

function send(client: Client, message: unknown): void {
  if (client.socket.readyState !== WebSocket.OPEN) return;
  try {
    client.socket.send(JSON.stringify(message));
  } catch {
    clients.delete(client);
  }
}

/**
 * Broadcasts to every subscriber of a channel.
 *
 * Player-scoped channels are additionally filtered so a client only ever sees
 * its own events.
 */
export function broadcast(channel: string, message: unknown): void {
  const payload = message as { payload?: { playerId?: string } };
  const targetPlayer = payload?.payload?.playerId;

  for (const client of clients) {
    if (!client.channels.has(channel)) continue;
    if (PRIVATE_CHANNELS.has(channel) && targetPlayer && client.playerId !== targetPlayer) continue;
    send(client, message);
  }
}

export function onlineCount(): number {
  return clients.size;
}
