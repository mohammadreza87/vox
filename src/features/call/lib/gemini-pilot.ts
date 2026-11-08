type PilotOptions = {
  getToken: () => Promise<string>;
  voice: string;
  name: string;
  prompt: string;
  signal: AbortSignal;
  onReady: () => void;
  onMode: (mode: 'speaking' | 'listening') => void;
  onClose: (error?: string) => void;
};

export function startGeminiPilot(options: PilotOptions) {
  const context = new AudioContext({ sampleRate: 16000 });
  const players = new Set<AudioBufferSourceNode>();
  let playAt = 0;
  let stream: MediaStream | undefined;
  let capture: AudioWorkletNode | undefined;
  let socket: WebSocket | undefined;
  let closed = false;
  let ready = false;
  let muted = false;
  let sendAudio = false;
  let muteSequence = 0;

  function stopPlayback() {
    for (const player of players) player.stop();
    players.clear();
    playAt = 0;
  }

  function stop() {
    if (closed) return;
    closed = true;
    options.signal.removeEventListener('abort', stop);
    socket?.close();
    capture?.disconnect();
    stream?.getTracks().forEach(track => track.stop());
    stopPlayback();
    void context.close();
  }

  function setMuted(value: boolean) {
    muted = value;
    sendAudio = false;
    capture?.port.postMessage({ muted: value, sequence: ++muteSequence });
    stream?.getAudioTracks().forEach(track => { track.enabled = !value; });
    if (value && ready && socket?.readyState === WebSocket.OPEN) socket.send('mute');
  }

  options.signal.addEventListener('abort', stop, { once: true });
  if (options.signal.aborted) {
    stop();
    return { stop, setMuted };
  }

  async function connect() {
    try {
      if (context.sampleRate !== 16000) throw new Error('This browser cannot capture audio at 16 kHz');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires a secure browser page');
      // Resume during the user gesture, before awaiting permission or Firebase.
      const audioReady = context.resume();
      const microphone = navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      }).then(input => {
        if (closed) input.getTracks().forEach(track => track.stop());
        else stream = input;
        return input;
      });
      const [token, input] = await Promise.all([options.getToken(), microphone, audioReady]);
      if (closed) return;
      await context.audioWorklet.addModule('/audio/gemini-pilot-capture.js');
      if (closed) return;
      capture = new AudioWorkletNode(context, 'gemini-pilot-capture', { channelCount: 1 });
      context.createMediaStreamSource(input).connect(capture).connect(context.destination);
      capture.port.onmessage = ({ data }) => {
        if (typeof data === 'number') {
          if (data === muteSequence) sendAudio = !muted;
          return;
        }
        if (!ready || !sendAudio || socket?.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 128 * 1024) {
          stop();
          options.onClose('The call connection is too slow');
          return;
        }
        socket.send(data);
      };
      setMuted(muted);

      const url = new URL('/api/gemini-live/socket', window.location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => socket?.send(JSON.stringify({
        token, voice: options.voice, name: options.name, prompt: options.prompt,
      }));
      socket.onclose = (event) => {
        if (closed) return;
        stop();
        options.onClose(event.code === 1000 ? undefined : event.reason || 'Gemini pilot connection closed');
      };
      socket.onmessage = ({ data }) => {
        if (closed) return;
        if (typeof data === 'string') {
          const control = JSON.parse(data);
          if (control.ready) {
            ready = true;
            options.onReady();
          } else if (control.interrupted) {
            stopPlayback();
            options.onMode('listening');
          }
          return;
        }
        if (!ready || !(data instanceof ArrayBuffer) || data.byteLength % 2) return;
        const samples = new Int16Array(data);
        if (!samples.length) return;
        const buffer = context.createBuffer(1, samples.length, 24000);
        const channel = buffer.getChannelData(0);
        for (let index = 0; index < samples.length; index++) channel[index] = samples[index] / 32768;
        const player = context.createBufferSource();
        player.buffer = buffer;
        player.connect(context.destination);
        player.onended = () => {
          player.disconnect();
          if (players.delete(player) && !players.size && !closed) options.onMode('listening');
        };
        players.add(player);
        playAt = Math.max(playAt, context.currentTime + 0.015);
        player.start(playAt);
        playAt += buffer.duration;
        options.onMode('speaking');
      };
    } catch (error) {
      if (closed) return;
      stop();
      const message = error instanceof DOMException && error.name === 'NotFoundError'
        ? 'No microphone found. Connect a microphone and try again.'
        : error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Allow microphone access in your browser and try again.'
          : error instanceof Error ? error.message : 'Could not start the Gemini pilot';
      options.onClose(message);
    }
  }

  void connect();
  return { stop, setMuted };
}
