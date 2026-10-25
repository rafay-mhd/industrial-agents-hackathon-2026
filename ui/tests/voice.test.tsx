// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useVoice } from "../src/hooks/useVoice";

let hook: ReturnType<typeof useVoice>;
let micLevel = 0;
let track: {
  stop: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
};
let transcript: ReturnType<typeof vi.fn>;
let error: ReturnType<typeof vi.fn>;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let audioSource: FakeSource | undefined;
class FakeNode {
  fftSize = 2048;
  connect = vi.fn();
  disconnect = vi.fn();
  getFloatTimeDomainData(samples: Float32Array) {
    samples.fill(micLevel);
  }
}
class FakeSource extends FakeNode {
  buffer: unknown;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onended?.());
}
class FakeAudioContext {
  state = "running";
  destination = new FakeNode();
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createMediaStreamSource = vi.fn(() => new FakeNode());
  createAnalyser = vi.fn(() => new FakeNode());
  decodeAudioData = vi.fn(async () => ({}));
  createBufferSource() {
    audioSource = new FakeSource();
    return audioSource;
  }
}
class FakeRecorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["audio-test-data"], { type: this.mimeType }),
    });
    queueMicrotask(() => this.onstop?.());
  }
}
function Harness({ id = "unknown-building" }: { id?: string }) {
  const value = useVoice(id, transcript, error);
  useEffect(() => {
    hook = value;
  });
  return null;
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  micLevel = 0;
  audioSource = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  track = { stop: vi.fn(), addEventListener: vi.fn() };
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
        getAudioTracks: () => [track],
      })),
    },
  });
  transcript = vi.fn(async () => "The kitchen is on the ground floor.");
  error = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/transcribe")
        ? { ok: true, json: async () => ({ text: "Where is the kitchen?" }) }
        : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) },
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("does not request microphone access until the user starts voice", () => {
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(hook.active).toBe(false);
  expect(hook.phase).toBe("idle");
});
test("silence does not send requests; a spoken turn automatically transcribes, calls the same agent and speaks", async () => {
  await act(async () => {
    await hook.start();
  });
  expect(hook.phase).toBe("listening");
  await advance(2000);
  expect(fetch).not.toHaveBeenCalled();
  micLevel = 0.05;
  await advance(400);
  expect(hook.phase).toBe("hearing");
  micLevel = 0;
  await advance(1100);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
    "/api/buildings/unknown-building/transcribe",
  );
  expect(transcript).toHaveBeenCalledExactlyOnceWith("Where is the kitchen?");
  expect(hook.phase).toBe("speaking");
  expect(audioSource?.start).toHaveBeenCalledOnce();
  await act(async () => {
    audioSource?.onended?.();
  });
  expect(hook.phase).toBe("listening");
  expect(hook.active).toBe(true);
  expect(error).not.toHaveBeenCalled();
});
test("interrupt stops playback and resumes listening without ending the conversation", async () => {
  await act(async () => {
    await hook.start();
  });
  micLevel = 0.05;
  await advance(400);
  micLevel = 0;
  await advance(1100);
  expect(hook.phase).toBe("speaking");
  const current = audioSource;
  await act(async () => hook.interrupt());
  expect(current?.stop).toHaveBeenCalledOnce();
  expect(hook.phase).toBe("listening");
  expect(hook.active).toBe(true);
});
test("ending voice releases microphone tracks and ignores pending transcription results", async () => {
  let resolveTranscription: ((value: unknown) => void) | undefined;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveTranscription = resolve;
      }) as Promise<Response>,
  );
  await act(async () => {
    await hook.start();
  });
  micLevel = 0.05;
  await advance(400);
  micLevel = 0;
  await advance(1100);
  expect(hook.phase).toBe("transcribing");
  await act(async () => hook.stop());
  expect(track.stop).toHaveBeenCalledOnce();
  expect(hook.active).toBe(false);
  await act(async () =>
    resolveTranscription?.({
      ok: true,
      json: async () => ({ text: "Close this room" }),
    }),
  );
  expect(transcript).not.toHaveBeenCalled();
  expect(hook.phase).toBe("idle");
});
test("a building switch ends the old microphone session", async () => {
  await act(async () => {
    await hook.start();
  });
  await act(async () => root.render(<Harness id="another-building" />));
  expect(track.stop).toHaveBeenCalledOnce();
  expect(hook.active).toBe(false);
  expect(hook.phase).toBe("idle");
});
test("permission failure is reported without starting a recorder or sending a request", async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
    new Error("Microphone permission denied"),
  );
  await act(async () => {
    await hook.start();
  });
  expect(hook.active).toBe(false);
  expect(hook.phase).toBe("error");
  expect(error).toHaveBeenCalledWith("Microphone permission denied");
  expect(fetch).not.toHaveBeenCalled();
});
