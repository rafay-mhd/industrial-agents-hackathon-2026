/* PCM16 at 16 kHz, in 100 ms chunks. Microphone audio is never connected audibly. */
class InsideVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Int16Array(1600);
    this.index = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.energy = 0;
    this.samples = 0;
  }
  process(inputs) {
    const data = inputs[0]?.[0];
    if (!data) return true;
    for (const value of data) {
      this.sum += value;
      this.count++;
      this.energy += value * value;
      this.samples++;
      this.phase += 16000 / sampleRate;
      if (this.phase >= 1) {
        this.phase -= 1;
        const sample = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0;
        this.count = 0;
        this.chunk[this.index++] = sample < 0 ? sample * 32768 : sample * 32767;
        if (this.index === 1600) {
          this.port.postMessage(
            {
              pcm: this.chunk.buffer,
              level: Math.sqrt(this.energy / this.samples),
            },
            [this.chunk.buffer],
          );
          this.chunk = new Int16Array(1600);
          this.index = 0;
          this.energy = 0;
          this.samples = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("inside-voice-capture", InsideVoiceCapture);
