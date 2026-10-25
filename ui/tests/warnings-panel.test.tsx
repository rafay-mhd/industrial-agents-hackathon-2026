// @vitest-environment jsdom
import { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { LiveWarnings } from "../src/components/LiveWarnings";
import type { BuildingData, LiveWarning } from "../src/types";
import { warningPins } from "../src/lib/liveWarnings";
const warning = {
  id: "report-1",
  element_id: "coffee",
  label: "Coffee machine",
  kind: "equipment_outage",
  message: "Coffee machine is out of service",
  reporter: "Other visitor",
  status: "active",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  blocks_route: false,
  asset_unavailable: true,
} as LiveWarning;
const data = {
  building: { id: "house", name: "Shared house", live_warnings: [warning] },
  floors: [{ id: "g", level: 0, name: "Ground" }],
  spaces: [
    {
      id: "hall",
      name: "Hall",
      type: "hall",
      floor_id: "g",
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    },
  ],
  assets: [
    {
      id: "coffee",
      name: "Coffee machine",
      type: "coffee_machine",
      floor_id: "g",
      space_id: "hall",
      position: [2, 2],
    },
  ],
} as BuildingData;
let root: Root,
  host: HTMLDivElement,
  props: Omit<ComponentProps<typeof LiveWarnings>, "open" | "setOpen">;
function Harness() {
  const [open, setOpen] = useState(false);
  return <LiveWarnings {...props} open={open} setOpen={setOpen} />;
}
const render = async () => {
  await act(async () => root.render(<Harness />));
};
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  )!;
const click = async (text: string) => {
  await act(async () => button(text).click());
};
async function field(selector: string, value: string) {
  await act(async () => {
    const node = host.querySelector(selector)!;
    const type =
      node.tagName === "TEXTAREA"
        ? HTMLTextAreaElement
        : node.tagName === "SELECT"
          ? HTMLSelectElement
          : HTMLInputElement;
    Object.getOwnPropertyDescriptor(type.prototype, "value")!.set!.call(
      node,
      value,
    );
    node.dispatchEvent(
      new Event(node.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    data,
    busy: false,
    connected: true,
    status: "live",
    selected: "",
    onReconnect: vi.fn(),
    onPost: vi.fn(async () => true),
    onResolve: vi.fn(async () => true),
    onLocate: vi.fn(),
  };
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
test("other visitors' reports remain readable while busy or disconnected", async () => {
  props = { ...props, busy: true, connected: false };
  await render();
  expect(button("Warnings").disabled).toBe(false);
  await click("Warnings");
  expect(host.textContent).toContain("Other visitor");
  expect(host.textContent).toContain("Coffee machine is out of service");
  expect(button("Show on map").disabled).toBe(false);
  await click("Show on map");
  expect(props.onLocate).toHaveBeenCalledWith("coffee");
  expect(button("Mark resolved").disabled).toBe(true);
  await click("Reconnect");
  expect(props.onReconnect).toHaveBeenCalled();
});
test("post stays clickable and explains the missing location without guessing it", async () => {
  await click("Warnings");
  await click("Report anything");
  await field("textarea", "Coffee machine broken");
  expect(button("Post live warning").disabled).toBe(false);
  expect(host.querySelector(".warning-form-help")?.textContent).toContain(
    "Where exactly?",
  );
  await click("Post live warning");
  expect(props.onPost).not.toHaveBeenCalled();
  expect(
    (host.querySelector("select[required]") as HTMLSelectElement).validity
      .valueMissing,
  ).toBe(true);
  await field("select[required]", "coffee");
  await field("select:not([required])", "equipment_outage");
  await click("Post live warning");
  expect(props.onPost).toHaveBeenCalledWith(
    expect.objectContaining({
      element_id: "coffee",
      kind: "equipment_outage",
      message: "Coffee machine broken",
      blocks_route: false,
    }),
  );
});
test("incoming shared reports render above an open form without losing its draft", async () => {
  await click("Warnings");
  await click("Report anything");
  await field("textarea", "A different issue");
  props = {
    ...props,
    data: {
      ...data,
      building: {
        ...data.building,
        revision: 2,
        live_warnings: [
          warning,
          {
            ...warning,
            id: "report-2",
            message: "Wet stairs upstairs",
            reporter: "Another visitor",
          },
        ],
      },
    },
  };
  await render();
  expect(host.textContent).toContain("Wet stairs upstairs");
  expect(host.textContent).toContain("Another visitor");
  expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
    "A different issue",
  );
  expect(
    host
      .querySelector(".warning-list")!
      .compareDocumentPosition(host.querySelector("form")!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
test("a failed post keeps its fields and can be retried", async () => {
  props = { ...props, onPost: vi.fn(async () => false) };
  await render();
  await click("Warnings");
  await click("Report anything");
  await field("textarea", "Wet floor");
  await field("select[required]", "hall");
  await click("Post live warning");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "not saved",
  );
  expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
    "Wet floor",
  );
  expect(button("Post live warning").disabled).toBe(false);
});
test("resolution shows progress, prevents duplicate clicks and keeps failures actionable", async () => {
  let complete!: (ok: boolean) => void;
  props = {
    ...props,
    onResolve: vi.fn(
      () =>
        new Promise<boolean>((r) => {
          complete = r;
        }),
    ),
  };
  await render();
  await click("Warnings");
  await click("Mark resolved");
  expect(button("Resolving").disabled).toBe(true);
  await click("Resolving");
  expect(props.onResolve).toHaveBeenCalledTimes(1);
  expect(props.onResolve).toHaveBeenCalledWith("report-1");
  await act(async () => complete(false));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "still active",
  );
  expect(button("Mark resolved").disabled).toBe(false);
  props = {
    ...props,
    onResolve: vi.fn(async () => {
      throw new Error("offline");
    }),
  };
  await render();
  await click("Mark resolved");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "try again",
  );
  expect(button("Mark resolved").disabled).toBe(false);
});
test("resolved reports move to history and stop appearing as active map warnings", async () => {
  await click("Warnings");
  await click("Mark resolved");
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "marked resolved",
  );
  props = {
    ...props,
    data: {
      ...data,
      building: {
        ...data.building,
        revision: 2,
        live_warnings: [
          {
            ...warning,
            status: "resolved",
            updated_at: new Date().toISOString(),
          },
        ],
      },
    },
  };
  await render();
  expect(button("Warnings").textContent).toContain("No reports");
  expect(
    host.querySelector('[aria-label="Reports from other visitors"]')
      ?.textContent,
  ).toContain("No active reports");
  expect(host.querySelector("summary")?.textContent).toContain(
    "Resolved issues · 1",
  );
  expect(
    host.querySelector('[aria-label="Resolved reports"]')?.textContent,
  ).toContain("Coffee machine is out of service");
  expect(
    host.querySelector('[aria-label="Resolved reports"]')?.textContent,
  ).toContain("Resolved just now");
  expect(
    host.querySelector('[aria-label="Resolved reports"] button'),
  ).toBeNull();
  expect(host.textContent).not.toContain("Unavailable");
  expect(warningPins(props.data, "g")).toEqual([]);
});
