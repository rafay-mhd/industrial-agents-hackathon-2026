import { request } from "./api";

/** Schedule PCM as it arrives. Never wait for a complete spoken answer to start playback. */
export async function playPCM(
  response: Response,
  ctx: AudioContext,
  signal: AbortSignal,
  onStart: () => void,
  onLevel: (level: number) => void,
) {
  if (!response.body)
    throw Error("Streaming audio is unavailable in this browser.");
  const reader = response.body.getReader(),
    nodes = new Set<AudioBufferSourceNode>(),
    analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.connect(ctx.destination);
  let carry = new Uint8Array(0),
    next = ctx.currentTime + 0.04,
    started = false,
    readDone = false,
    finish = () => {},
    raf = 0;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const samples = new Float32Array(analyser.fftSize);
  const meter = () => {
    analyser.getFloatTimeDomainData(samples);
    onLevel(
      Math.min(
        1,
        Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length) * 5,
      ),
    );
    raf = requestAnimationFrame(meter);
  };
  const stop = () => {
    for (const node of nodes) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        /* Already ended. */
      }
      node.disconnect();
    }
    nodes.clear();
    void reader.cancel().catch(() => {});
    finish();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    if (signal.aborted) return;
    for (;;) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) break;
      const bytes = new Uint8Array(carry.length + value.length);
      bytes.set(carry);
      bytes.set(value, carry.length);
      const size = bytes.length - (bytes.length % 2);
      carry = bytes.slice(size);
      if (!size) continue;
      const view = new DataView(bytes.buffer, 0, size),
        buffer = ctx.createBuffer(1, size / 2, 24000),
        channel = buffer.getChannelData(0);
      for (let i = 0; i < channel.length; i++)
        channel[i] = view.getInt16(i * 2, true) / 32768;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(analyser);
      nodes.add(node);
      node.onended = () => {
        node.disconnect();
        nodes.delete(node);
        if (readDone && !nodes.size) finish();
      };
      next = Math.max(next, ctx.currentTime + 0.025);
      node.start(next);
      next += buffer.duration;
      if (!started) {
        started = true;
        onStart();
        meter();
      }
    }
    readDone = true;
    if (!started && !signal.aborted)
      throw Error("No speech audio was received.");
    if (!nodes.size) finish();
    await completed;
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
    cancelAnimationFrame(raf);
    analyser.disconnect();
    onLevel(0);
  }
}

export async function realtimeMicrophone(
  ctx: AudioContext,
  media: MediaStream,
  buildingId: string,
  signal: AbortSignal,
  callbacks: {
    partial: (text: string) => void;
    committed: (text: string) => void;
    level: (level: number) => void;
    error: (message: string) => void;
  },
) {
  const result = await request<{ token: string; keyterms: string[] }>(
    `/buildings/${encodeURIComponent(buildingId)}/voice-token`,
    { method: "POST", signal },
  );
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  await ctx.audioWorklet.addModule("/voice-capture.js");
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const query = new URLSearchParams({
    model_id: "scribe_v2_realtime",
    token: result.token,
    audio_format: "pcm_16000",
    commit_strategy: "vad",
    vad_silence_threshold_secs: "0.8",
    min_speech_duration_ms: "160",
    filter_background_audio: "true",
  });
  for (const word of result.keyterms
    .filter((term) => [...term].length <= 20)
    .slice(0, 50))
    query.append("keyterms", word);
  const socket = new WebSocket(
    "wss://api.elevenlabs.io/v1/speech-to-text/realtime?" + query,
  );
  let source: MediaStreamAudioSourceNode | null = null,
    worklet: AudioWorkletNode | null = null,
    sink: GainNode | null = null,
    closed = false,
    connected = false;
  let rejectReady: (e: Error) => void = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    source?.disconnect();
    worklet?.disconnect();
    if (worklet) worklet.port.onmessage = null;
    sink?.disconnect();
    socket.close();
    signal.removeEventListener("abort", abort);
  };
  const abort = () => {
    rejectReady(new DOMException("Cancelled", "AbortError"));
    close();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      rejectReady = reject;
      timeout = setTimeout(() => {
        close();
        reject(Error("Live transcription took too long to connect."));
      }, 12000);
      const fail = (message: string) => {
        clearTimeout(timeout);
        reject(Error(message));
      };
      socket.onerror = () => {
        if (!closed) {
          fail("Live transcription could not connect.");
          if (connected)
            callbacks.error(
              "Live transcription disconnected. Start voice again.",
            );
          close();
        }
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (!closed) {
          fail("Live transcription closed.");
          if (connected)
            callbacks.error(
              "Live transcription disconnected. Start voice again.",
            );
          close();
        }
      };
      socket.onmessage = (e) => {
        if (closed) return;
        let event;
        try {
          event = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (!event || typeof event !== "object") return;
        if (event.message_type === "session_started") {
          clearTimeout(timeout);
          source = ctx.createMediaStreamSource(media);
          worklet = new AudioWorkletNode(ctx, "inside-voice-capture");
          sink = ctx.createGain();
          sink.gain.value = 0;
          source.connect(worklet);
          worklet.connect(sink);
          sink.connect(ctx.destination);
          worklet.port.onmessage = ({ data }) => {
            if (socket.readyState !== WebSocket.OPEN || closed) return;
            if (socket.bufferedAmount > 160000) {
              callbacks.error(
                "The voice connection is too slow. Please restart voice.",
              );
              close();
              return;
            }
            callbacks.level(Math.min(1, data.level * 8));
            const encoded = btoa(
              String.fromCharCode(...new Uint8Array(data.pcm)),
            );
            socket.send(
              JSON.stringify({
                message_type: "input_audio_chunk",
                audio_base_64: encoded,
                sample_rate: 16000,
                commit: false,
              }),
            );
          };
          connected = true;
          resolve();
        } else if (
          event.message_type === "partial_transcript" &&
          typeof event.text === "string"
        )
          callbacks.partial(event.text);
        else if (
          event.message_type === "committed_transcript" &&
          typeof event.text === "string"
        )
          callbacks.committed(event.text);
        else if (
          event.message_type?.includes("error") ||
          [
            "quota_exceeded",
            "rate_limited",
            "auth_error",
            "invalid_request",
          ].includes(event.message_type)
        ) {
          fail(
            event.message_type === "quota_exceeded"
              ? "ElevenLabs speech credits are exhausted. Text chat still works."
              : "The speech service could not process this session.",
          );
          if (connected)
            callbacks.error(
              event.message_type === "quota_exceeded"
                ? "ElevenLabs speech credits are exhausted. Text chat still works."
                : "Live transcription failed. Check speech access and credits.",
            );
          close();
        }
      };
    });
    return close;
  } catch (e) {
    close();
    throw e;
  }
}
