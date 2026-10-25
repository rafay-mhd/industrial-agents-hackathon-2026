import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { API, request } from "../lib/api";
import type { ChatAction } from "../types";
import type { TripSelection } from "../components/DirectionsPanel";
export type PlannedTrip = TripSelection & { step_free: boolean };
export type FeedEvent = {
  revision: number;
  closed: string[];
  unavailable_assets?: string[];
};
type Options = {
  buildingId: string;
  enabled: boolean;
  revision: number;
  appliedRevision?: RefObject<number>;
  session: RefObject<string>;
  busy: RefObject<boolean>;
  setBusy: (value: boolean) => void;
  trip: RefObject<PlannedTrip | null>;
  onActions: (actions: ChatAction[]) => void;
  onEvent: (event: FeedEvent) => void;
  onError: (text: string) => void;
};
export function useBuildingFeed(options: Options) {
  const latest = useRef(options),
    [status, setStatus] = useState<"connecting" | "live" | "retrying">(
      "connecting",
    );
  useEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    if (!options.enabled) return;
    let stopped = false,
      inFlight = false,
      pending: number | null = null;
    const session = options.session.current;
    const controller = new AbortController();
    const base = `/buildings/${encodeURIComponent(options.buildingId)}`;
    const revisionNow = () =>
      latest.current.appliedRevision?.current ?? latest.current.revision;
    const flush = async () => {
      const current = latest.current;
      if (
        stopped ||
        inFlight ||
        document.hidden ||
        current.busy.current ||
        pending === null ||
        pending <= revisionNow()
      )
        return;
      inFlight = true;
      current.busy.current = true;
      current.setBusy(true);
      try {
        const response = await request<{ actions: ChatAction[] }>(
          base + "/sync",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: session,
              revision: revisionNow(),
              planned_trip: current.trip.current
                ? { session_id: session, ...current.trip.current }
                : null,
            }),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(20000),
            ]),
          },
        );
        if (!stopped && session === latest.current.session.current) {
          const state = response.actions.find(
            (a) => a.type === "building_state",
          );
          if (
            state?.type === "building_state" &&
            (pending === null ||
              Number(state.building.building.revision) >= pending)
          )
            pending = null;
          // A report response can acknowledge the same revision while this fetch is in flight.
          // Do not overwrite its route-change notification with a duplicate advisory.
          if (
            state?.type !== "building_state" ||
            Number(state.building.building.revision) > revisionNow()
          )
            current.onActions(response.actions);
        }
      } catch {
        if (!stopped) {
          setStatus("retrying");
          current.onError(
            "Live updates are reconnecting. An affected route stays paused until it can be checked.",
          );
        }
      } finally {
        inFlight = false;
        if (session === latest.current.session.current) {
          current.busy.current = false;
          current.setBusy(false);
        }
      }
    };
    const changed = (event: FeedEvent) => {
      if (stopped || event.revision <= revisionNow()) return;
      pending = Math.max(pending ?? 0, event.revision);
      latest.current.onEvent(event);
      void flush();
    };
    const stream = new EventSource(
      `${API}${base}/events?since=${options.revision}`,
    );
    stream.onopen = () => {
      if (!stopped) setStatus("live");
    };
    stream.onerror = () => {
      if (!stopped) setStatus("retrying");
    };
    stream.addEventListener("building-update", (event) => {
      try {
        changed(JSON.parse((event as MessageEvent).data));
      } catch {
        /* A malformed event is recovered by the next poll. */
      }
    });
    const fallback = async () => {
      if (stopped || document.hidden) return;
      try {
        changed(
          await request<FeedEvent>(base + "/changes", {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(20000),
            ]),
          }),
        );
      } catch {
        if (!stopped) setStatus("retrying");
      }
    };
    const retry = window.setInterval(() => void flush(), 500);
    const poll = window.setInterval(() => void fallback(), 5000);
    const visible = () => {
      if (!document.hidden) {
        void fallback();
        void flush();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      stream.close();
      controller.abort();
      window.clearInterval(retry);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", visible);
    };
    // Revisions are read through latest: reconnecting on every revision would lose queued events.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [options.buildingId, options.enabled]);
  return status;
}
