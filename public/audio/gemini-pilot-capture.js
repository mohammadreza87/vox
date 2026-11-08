class GeminiPilotCapture extends AudioWorkletProcessor {
  frame = new Int16Array(640);
  index = 0;

  muted = true;

  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      this.index = 0;
      this.muted = data.muted;
      if (!this.muted) this.port.postMessage(data.sequence);
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || this.muted) return true;
    for (const sample of channel) {
      const clamped = Math.max(-1, Math.min(1, sample));
      this.frame[this.index++] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      if (this.index === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(640);
        this.index = 0;
      }
    }
    return true;
  }
}

registerProcessor('gemini-pilot-capture', GeminiPilotCapture);
