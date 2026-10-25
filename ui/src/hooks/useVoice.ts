import { useCallback, useEffect, useRef, useState } from "react";
import { API, request } from "../lib/api";
import type { VoicePhase } from "../components/VoiceOrb";

type Transcription = {
  text: string;
  language_code?: string;
  language_probability?: number;
};
export function useVoice(
  buildingId: string,
  onTranscript: (text: string) => Promise<string | null>,
  onError: (message: string) => void,
) {
  const [active, setActive] = useState(false),
    [phase, setPhase] = useState<VoicePhase>("idle");
  const phaseRef = useRef<VoicePhase>("idle"),
    activeRef = useRef(false),
    generation = useRef(0);
  const input = useRef(0),
    output = useRef(0),
    stream = useRef<MediaStream | null>(null),
    context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const micNode = useRef<MediaStreamAudioSourceNode | null>(null),
    micMeter = useRef<AnalyserNode | null>(null);
  const pending = useRef<AbortController | null>(null),
    callbacks = useRef({ onTranscript, onError }),
    playDone = useRef<(() => void) | null>(null);
  useEffect(() => {
    callbacks.current = { onTranscript, onError };
  }, [onTranscript, onError]);
  const transition = useCallback((value: VoicePhase) => {
    phaseRef.current = value;
    setPhase(value);
  }, []);
  const audioContext = useCallback(async () => {
    context.current ??= new AudioContext();
    if (context.current.state === "suspended") await context.current.resume();
    return context.current;
  }, []);

  const stopAudio = useCallback(() => {
    source.current?.stop();
    source.current = null;
    playDone.current?.();
    playDone.current = null;
    output.current = 0;
  }, []);
  const stop = useCallback(() => {
    generation.current++;
    activeRef.current = false;
    setActive(false);
    pending.current?.abort();
    pending.current = null;
    if (interval.current) clearInterval(interval.current);
    interval.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    input.current = 0;
    micNode.current?.disconnect();
    micMeter.current?.disconnect();
    micNode.current = null;
    micMeter.current = null;
    stopAudio();
    transition("idle");
  }, [stopAudio, transition]);

  const speak = useCallback(
    async (text: string) => {
      const currentGeneration = generation.current;
      stopAudio();
      transition("thinking");
      const controller = new AbortController();
      pending.current = controller;
      try {
        const ctx = await audioContext();
        const response = await fetch(`${API}/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.slice(0, 10000) }),
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            "Voice playback is unavailable. The full answer is in the conversation.",
          );
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (
          generation.current !== currentGeneration ||
          controller.signal.aborted
        )
          return;
        const player = ctx.createBufferSource(),
          analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        player.buffer = buffer;
        player.connect(analyser);
        analyser.connect(ctx.destination);
        source.current = player;
        const samples = new Float32Array(analyser.fftSize);
        transition("speaking");
        await new Promise<void>((resolve) => {
          let frame = 0,
            finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            cancelAnimationFrame(frame);
            output.current = 0;
            player.disconnect();
            analyser.disconnect();
            if (source.current === player) source.current = null;
            playDone.current = null;
            resolve();
          };
          player.onended = finish;
          playDone.current = finish;
          const tick = () => {
            analyser.getFloatTimeDomainData(samples);
            output.current = Math.min(
              1,
              Math.sqrt(
                samples.reduce((sum, n) => sum + n * n, 0) / samples.length,
              ) * 5,
            );
            frame = requestAnimationFrame(tick);
          };
          player.start();
          tick();
        });
      } finally {
        if (generation.current === currentGeneration)
          transition(activeRef.current ? "listening" : "idle");
        if (pending.current === controller) pending.current = null;
      }
    },
    [audioContext, stopAudio, transition],
  );

  const start = useCallback(async () => {
    stop();
    const run = generation.current;
    transition("connecting");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "This browser cannot capture microphone audio. Use a recent Chrome, Edge or Safari on localhost or HTTPS.",
        );
      const ctx = await audioContext();
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (generation.current !== run) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      activeRef.current = true;
      setActive(true);
      const mic = ctx.createMediaStreamSource(media),
        analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      mic.connect(analyser);
      micNode.current = mic;
      micMeter.current = analyser;
      const samples = new Float32Array(analyser.fftSize);
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      let chunks: Blob[] = [],
        started = 0,
        lastSpeech = 0,
        voicedMs = 0,
        sending = false;
      const capture = () => {
        if (!activeRef.current || generation.current !== run) return;
        chunks = [];
        started = performance.now();
        lastSpeech = 0;
        voicedMs = 0;
        const rec = new MediaRecorder(media, mimeType ? { mimeType } : {});
        recorder.current = rec;
        rec.onerror = () => {
          if (generation.current === run) {
            stop();
            callbacks.current.onError(
              "Microphone recording failed. Start voice again or type your question.",
            );
          }
        };
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        rec.onstop = async () => {
          if (!activeRef.current || generation.current !== run) return;
          if (!sending) {
            capture();
            return;
          }
          const audio = new Blob(chunks, { type: rec.mimeType });
          chunks = [];
          if (audio.size > 10 * 1024 * 1024) {
            callbacks.current.onError(
              "That turn was too long. Please try a shorter question.",
            );
            sending = false;
            transition("listening");
            capture();
            return;
          }
          try {
            transition("transcribing");
            const form = new FormData();
            form.append(
              "file",
              audio,
              rec.mimeType.includes("mp4") ? "question.m4a" : "question.webm",
            );
            const controller = new AbortController();
            pending.current = controller;
            const result = await request<Transcription>(
              `/buildings/${encodeURIComponent(buildingId)}/transcribe`,
              { method: "POST", body: form, signal: controller.signal },
            );
            if (generation.current !== run) return;
            const text = result.text.trim();
            if (text && !/^\s*[[(].*[)\]]\s*$/.test(text)) {
              transition("thinking");
              const reply = await callbacks.current.onTranscript(text);
              if (reply && generation.current === run && activeRef.current)
                await speak(reply);
            }
          } catch (error) {
            if (
              generation.current === run &&
              !(error instanceof DOMException && error.name === "AbortError")
            )
              callbacks.current.onError(
                error instanceof Error
                  ? error.message
                  : "Voice request failed. Please try again.",
              );
          } finally {
            if (generation.current === run && activeRef.current) {
              sending = false;
              transition("listening");
              capture();
            }
          }
        };
        rec.start(250);
        transition("listening");
      };
      capture();
      interval.current = setInterval(() => {
        if (!activeRef.current || generation.current !== run) return;
        analyser.getFloatTimeDomainData(samples);
        const level = Math.sqrt(
          samples.reduce((sum, n) => sum + n * n, 0) / samples.length,
        );
        input.current = Math.min(1, level * 8);
        if (
          sending ||
          !["listening", "hearing"].includes(phaseRef.current) ||
          recorder.current?.state !== "recording"
        )
          return;
        const now = performance.now();
        if (level > 0.018) {
          lastSpeech = now;
          voicedMs += 40;
          if (voicedMs >= 120) transition("hearing");
        }
        if (
          (voicedMs >= 240 && now - lastSpeech > 950) ||
          now - started > 30000
        ) {
          sending = voicedMs >= 240;
          recorder.current.stop();
        }
      }, 40);
      media.getAudioTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (generation.current === run) {
            stop();
            callbacks.current.onError(
              "Microphone disconnected. Start voice again to reconnect.",
            );
          }
        },
        { once: true },
      );
    } catch (error) {
      if (generation.current !== run) return;
      stop();
      transition("error");
      callbacks.current.onError(
        error instanceof Error ? error.message : "Microphone access failed.",
      );
    }
  }, [audioContext, buildingId, speak, stop, transition]);

  const interrupt = useCallback(() => {
    if (phaseRef.current === "speaking") stopAudio();
  }, [stopAudio]);
  useEffect(
    () => () => {
      stop();
      void context.current?.close();
      context.current = null;
    },
    [buildingId, stop],
  );
  return { active, phase, input, output, start, stop, speak, interrupt };
}
