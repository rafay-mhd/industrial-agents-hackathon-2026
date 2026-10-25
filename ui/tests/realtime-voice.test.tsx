// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { realtimeMicrophone } from "../src/lib/streamingVoice";

let sockets: FakeSocket[], worklets: FakeWorklet[], controller: AbortController;
class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeWorklet extends FakeNode {
  port = { onmessage: null as ((event: { data: unknown }) => void) | null };
  constructor() {
    super();
    worklets.push(this);
  }
}
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });
  constructor(public url: string) {
    sockets.push(this);
  }
  receive(event: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}
function setup() {
  const source = new FakeNode(),
    sink = Object.assign(new FakeNode(), { gain: { value: 1 } });
  const ctx = {
    destination: new FakeNode(),
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createMediaStreamSource: vi.fn(() => source),
    createGain: vi.fn(() => sink),
  };
  const callbacks = {
    partial: vi.fn(),
    committed: vi.fn(),
    level: vi.fn(),
    error: vi.fn(),
  };
  const ready = realtimeMicrophone(
    ctx as unknown as AudioContext,
    {} as MediaStream,
    "new-building",
    controller.signal,
    callbacks,
  );
  return { ctx, source, sink, callbacks, ready };
}
beforeEach(() => {
  sockets = [];
  worklets = [];
  controller = new AbortController();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("AudioWorkletNode", FakeWorklet);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: "single-use-test-token",
            keyterms: [
              "Fire extinguisher H-A1",
              "Office 1.20",
              ...Array.from({ length: 60 }, (_, i) => `Room ${i}`),
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
});
afterEach(() => {
  controller.abort();
  vi.unstubAllGlobals();
});

test("live speech uses valid hints, waits for authentication and distinguishes partial and committed text", async () => {
  const { ctx, source, sink, callbacks, ready } = setup();
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0],
    query = new URL(socket.url).searchParams;
  expect(query.getAll("keyterms")).toHaveLength(50);
  expect(query.getAll("keyterms")).toContain("Office 1.20");
  expect(query.getAll("keyterms")).not.toContain("Fire extinguisher H-A1");
  expect(query.get("commit_strategy")).toBe("vad");
  expect(ctx.createMediaStreamSource).not.toHaveBeenCalled();
  socket.receive({ message_type: "session_started" });
  const close = await ready;
  expect(sink.gain.value).toBe(0);
  worklets[0].port.onmessage?.({
    data: { pcm: new Int16Array([1, -2]).buffer, level: 0.1 },
  });
  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
    message_type: "input_audio_chunk",
    sample_rate: 16000,
    commit: false,
    audio_base_64: "AQD+/w==",
  });
  socket.receive({ message_type: "partial_transcript", text: "Office one" });
  expect(callbacks.partial).toHaveBeenCalledWith("Office one");
  expect(callbacks.committed).not.toHaveBeenCalled();
  socket.receive({ message_type: "committed_transcript", text: "Office 1.20" });
  expect(callbacks.committed).toHaveBeenCalledWith("Office 1.20");
  close();
  expect(source.disconnect).toHaveBeenCalled();
  expect(worklets[0].disconnect).toHaveBeenCalled();
  expect(worklets[0].port.onmessage).toBeNull();
  socket.receive({ message_type: "committed_transcript", text: "Late result" });
  expect(callbacks.committed).toHaveBeenCalledTimes(1);
});

test("invalid realtime settings reject promptly without capturing or sending microphone audio", async () => {
  const { ctx, ready } = setup();
  const rejected = expect(ready).rejects.toThrow("speech service");
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  sockets[0].receive({
    message_type: "invalid_request",
    error: "Invalid hint",
  });
  await rejected;
  expect(sockets[0].close).toHaveBeenCalled();
  expect(ctx.createMediaStreamSource).not.toHaveBeenCalled();
});

test("stopping a live connection releases its audio graph and ignores late transcripts", async () => {
  const { source, sink, callbacks, ready } = setup();
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  sockets[0].receive({ message_type: "session_started" });
  await ready;
  controller.abort();
  expect(sockets[0].close).toHaveBeenCalled();
  expect(source.disconnect).toHaveBeenCalled();
  expect(sink.disconnect).toHaveBeenCalled();
  sockets[0].receive({
    message_type: "committed_transcript",
    text: "Do not send",
  });
  expect(callbacks.committed).not.toHaveBeenCalled();
});
