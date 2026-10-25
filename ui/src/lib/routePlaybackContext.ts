import { createContext, useContext, useSyncExternalStore } from "react";
import type { PlaybackStore } from "./routePlayback";
export type Controls = {
  store: PlaybackStore;
  toggle: () => void;
  restart: () => void;
  follow: () => void;
  explore: () => void;
  clear: () => void;
  walkView: () => void;
};
export const Context = createContext<Controls | null>(null);
export function useRoutePlayback() {
  const value = useContext(Context);
  if (!value) throw new Error("Route playback provider is missing.");
  return value;
}
export function useRouteFrame() {
  const { store } = useRoutePlayback();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
