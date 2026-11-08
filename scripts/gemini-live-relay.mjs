import { createServer } from 'node:http';
import { GoogleAuth } from 'google-auth-library';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import WebSocket, { WebSocketServer } from 'ws';
import { geminiVoices } from '../src/features/call/lib/gemini-voices.mjs';
import { canUseGeminiLive } from '../src/features/call/lib/gemini-access.mjs';

const origin = process.env.VOX_GEMINI_LIVE_ORIGIN;
const port = Number(process.env.PORT ?? 3138);
if (!origin) throw new Error('The Gemini Live relay requires an approved browser origin.');
const firebaseProject = process.env.VOX_GEMINI_LIVE_PROJECT;
if (!firebaseProject) throw new Error('Firebase project configuration is required.');
const firebase = initializeApp({ projectId: firebaseProject });
const google = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const upstreamUrl = 'wss://aiplatform.eu.rep.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent';
const model = `projects/${firebaseProject}/locations/eu/publishers/google/models/gemini-3.8-live`;

const server = createServer((request, response) => {
  const healthy = request.method === 'GET' && request.url === '/health';
  response.writeHead(healthy ? 200 : 404, { 'Cache-Control': 'no-store' }).end();
});

async function canUseGemini(token) {
  try {
    return canUseGeminiLive(await getAuth(firebase).verifyIdToken(token));
  } catch {
    return false;
  }
}

const relay = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 });
let active = false;
let attempts = [];
server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/api/gemini-live/socket') {
    socket.destroy();
    return;
  }
  if (request.headers.origin !== origin || relay.clients.size >= 4) {
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

      const access = await google.getAccessToken();
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

server.listen(port, '0.0.0.0', () => console.log('Gemini Live relay listening'));
