// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { AccessibilityPulse } from "../src/components/AccessibilityPulse";
import type { AccessibilityResult, BuildingData } from "../src/types";
const fetchMock = vi.fn();
vi.mock("../src/lib/api", () => ({
  request: (...args: unknown[]) => fetchMock(...args),
}));
let root: Root, host: HTMLDivElement;
const onResult = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock.mockReset();
  onResult.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function sample(revision: number, reachable = ["start", "upper"]) {
  return { revision, reachable_space_ids: reachable } as AccessibilityResult;
}
async function render(revision: number, enabled = true) {
  const data = {
    building: { id: "test-house", revision },
    spaces: [],
  } as unknown as BuildingData;
  await act(async () =>
    root.render(
      <AccessibilityPulse
        data={data}
        start="start"
        enabled={enabled}
        connected
        onEnabled={() => {}}
        result={null}
        onResult={onResult}
      />,
    ),
  );
}
test("an old response cannot restore green access after a new closure revision", async () => {
  let oldResult!: (v: AccessibilityResult) => void;
  fetchMock.mockReturnValueOnce(
    new Promise<AccessibilityResult>((resolve) => {
      oldResult = resolve;
    }),
  );
  await render(0);
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  fetchMock.mockResolvedValueOnce(sample(1, ["start"]));
  await render(1);
  expect(signal.aborted).toBe(true);
  await act(async () => oldResult(sample(0)));
  expect(
    onResult.mock.calls.filter(([v]) => v !== null).map(([v]) => v.revision),
  ).toEqual([1]);
  await render(1, false);
  expect(onResult).toHaveBeenLastCalledWith(null);
});
test("a server response ahead of the rendered map waits for the matching revision", async () => {
  fetchMock.mockResolvedValueOnce(sample(2));
  await render(1);
  expect(onResult.mock.calls.every(([v]) => v === null)).toBe(true);
  expect(host.textContent).toContain("The building changed");
  fetchMock.mockResolvedValueOnce(sample(2));
  await render(2);
  expect(onResult).toHaveBeenLastCalledWith(sample(2));
  expect(host.textContent).not.toContain("The building changed");
});
