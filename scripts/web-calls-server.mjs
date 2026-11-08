// Web Calls serves the app and its authenticated Gemini Live socket on one origin.
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import next from 'next';
import { GoogleAuth } from 'google-auth-library';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import WebSocket, { WebSocketServer } from 'ws';
import { geminiVoices } from '../src/features/call/lib/gemini-voices.mjs';

const hostedOrigin = process.env.VOX_GEMINI_LIVE_ORIGIN;
const dev = !hostedOrigin && process.env.NODE_ENV !== 'production';
const host = hostedOrigin ? '0.0.0.0' : '127.0.0.1';
const port = Number(process.env.PORT ?? 3138);
const origin = hostedOrigin ?? `http://127.0.0.1:${port}`;
const allowedEmails = new Set(
  (process.env.VOX_GEMINI_LIVE_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean),
);
const geminiEnabled = process.env.NEXT_PUBLIC_VOX_GEMINI_LIVE === '1' && allowedEmails.size > 0;
if (process.env.VOX_WEB_CALLS_ONLY !== '1' || process.env.NEXT_PUBLIC_VOX_WEB_CALLS_ONLY !== '1') {
  throw new Error('The Web Calls server requires standalone Web Calls configuration.');
}
const firebaseProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!firebaseProject) throw new Error('Firebase project configuration is required.');
const firebase = getApps()[0] ?? initializeApp({ projectId: firebaseProject });
const google = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const upstreamUrl = 'wss://aiplatform.eu.rep.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent';
const model = `projects/${process.env.VOX_GEMINI_LIVE_PROJECT ?? firebaseProject}/locations/eu/publishers/google/models/gemini-3.8-live`;
const server = createServer();
// Next registers its HMR upgrade listener automatically. Dispatch to it only
// for Next paths so its router cannot close a socket owned by the relay.
const nextUpgrades = new EventEmitter();
if (!dev) {
  // Use the same serialized config as Next's generated standalone entry point.
  // App Hosting prunes dev dependencies after building the image.
  const { config } = JSON.parse(readFileSync('.next/required-server-files.json', 'utf8'));
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
}
const app = next({ dev, hostname: host, port, httpServer: nextUpgrades });
await app.prepare();
const handle = app.getRequestHandler();
async function canUseGemini(token) {
  if (!geminiEnabled || typeof token !== 'string' || token.length > 8192) return false;
  try {
    const user = await getAuth(firebase).verifyIdToken(token);
    return user.email_verified === true &&
      (allowedEmails.has(user.email?.toLowerCase()) || user.voxGeminiLive === true);
  } catch {
    return false;
  }
}

server.on('request', async (req, res) => {
  if (req.url !== '/api/gemini-live/availability' || req.method !== 'GET') {
    return handle(req, res);
  }
  const bearer = req.headers.authorization;
  const enabled = bearer?.startsWith('Bearer ') && await canUseGemini(bearer.slice(7));
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ enabled: enabled === true }));
});
const relay = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 });
let active = false;
let attempts = [];
server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/api/gemini-live/socket') {
    if (!nextUpgrades.emit('upgrade', request, socket, head)) socket.destroy();
    return;
  }
  if (!geminiEnabled || request.headers.origin !== origin || relay.clients.size >= 4) {
    socket.destroy();
    return;
  }
  relay.handleUpgrade(request, socket, head, (client) => relay.emit('connection', client));
});

relay.on('connection', (client) => {
  let upstream;
  let reserved = false;
  let ready = false;
  const setupDeadline = setTimeout(() => client.close(1013, 'Call setup timed out'), 15000);
  const callDeadline = setTimeout(() => client.close(1000, 'Time limit reached'), 290000);
  const close = () => {
    clearTimeout(setupDeadline);
    clearTimeout(callDeadline);
    upstream?.terminate();
    if (reserved) active = false;
  };
  client.once('close', close);
  client.on('error', () => client.terminate());

  client.once('message', async (raw, binary) => {
    try {
      if (binary) return client.close(1008, 'Invalid setup');
      const { token, voice, name, prompt } = JSON.parse(raw.toString());
      if (typeof token !== 'string' || token.length > 8192 || !geminiVoices.some(option => option.id === voice) ||
          typeof name !== 'string' || !name.trim() || name.length > 120 ||
          typeof prompt !== 'string' || prompt.length > 12000) {
        return client.close(1008, 'Invalid setup');
      }
      if (!await canUseGemini(token)) return client.close(1008, 'Gemini Live is unavailable for this account');
      if (client.readyState !== WebSocket.OPEN) return;
      attempts = attempts.filter(time => Date.now() - time < 60000);
      if (active || attempts.length >= 6) return client.close(1013, 'Wait before starting another call');
      active = reserved = true;
      attempts.push(Date.now());

      const access = (!hostedOrigin && process.env.VOX_GEMINI_LOCAL_ACCESS_TOKEN) || await google.getAccessToken();
      if (!access) throw new Error('Missing Google credential');
      if (client.readyState !== WebSocket.OPEN) return;
      upstream = new WebSocket(upstreamUrl, {
        headers: { Authorization: `Bearer ${access}` },
        handshakeTimeout: 10000,
        maxPayload: 1024 * 1024,
      });
      const send = (message) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(message));
      };
      upstream.on('open', () => send({
        setup: {
          model,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
          systemInstruction: { parts: [{ text: `You are ${name}. Keep spoken turns concise and natural.\n${prompt}` }] },
        },
      }));
      upstream.on('error', () => client.close(1011, 'Google Live connection failed'));
      upstream.on('close', (code) => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (code !== 1000) console.warn('Gemini Live upstream closed', { code, ready });
        client.close(code === 1000 && ready ? 1000 : 1011, 'Google Live session ended');
      });
      upstream.on('message', (data) => {
        if (client.readyState !== WebSocket.OPEN) return;
        try {
          const message = JSON.parse(data.toString());
          if (message.setupComplete) {
            ready = true;
            clearTimeout(setupDeadline);
            client.send(JSON.stringify({ ready: true }));
            send({ realtimeInput: { text: 'Greet the caller in one short sentence.' } });
          }
          if (client.bufferedAmount > 256 * 1024) return client.close(1013, 'Connection too slow');
          const content = message.serverContent;
          if (content?.interrupted) {
            client.send(JSON.stringify({ interrupted: true }));
            return;
          }
          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.mimeType?.startsWith('audio/pcm') && part.inlineData.data) {
              client.send(Buffer.from(part.inlineData.data, 'base64'));
            }
          }
        } catch {
          client.close(1011, 'Invalid response from Google Live');
        }
      });
      client.on('message', (data, isBinary) => {
        if (!ready) return;
        if (!isBinary) {
          if (data.toString() === 'mute') send({ realtimeInput: { audioStreamEnd: true } });
          return;
        }
        if (data.length > 6400 || data.length % 2 !== 0 || upstream.bufferedAmount > 128 * 1024) {
          return client.close(1013, 'Invalid audio or slow connection');
        }
        send({ realtimeInput: { audio: { data: data.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } });
      });
    } catch {
      client.close(reserved ? 1011 : 1008, reserved ? 'Google Live setup failed' : 'Sign in again to use the pilot');
    }
  });
});

server.listen(port, host, () => console.log(`Vox Web Calls listening at ${origin}/app`));
