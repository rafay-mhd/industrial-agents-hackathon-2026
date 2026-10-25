import type { ChatResponse } from "../types";

export const API = (import.meta.env.VITE_API_BASE_URL || "/api").replace(
  /\/$/,
  "",
);
export type BuildingSummary = {
  id: string;
  name: string;
  source: string;
  floors: { level: number; name: string }[];
};
export type VoiceStatus = {
  configured: boolean;
  speech_to_text: string | false;
  text_to_speech: string | false;
};

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail =
      typeof body?.detail === "string"
        ? body.detail
        : `Request failed (${response.status}).`;
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export const chat = (
  id: string,
  session: string,
  message: string,
  signal?: AbortSignal,
) =>
  request<ChatResponse>(`/buildings/${encodeURIComponent(id)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: session, message }),
    signal,
  });

export const presets: BuildingSummary[] = [
  {
    id: "proc-factory-dev-003",
    name: "Fertigung Ost 27",
    source: "procedural",
    floors: [],
  },
  {
    id: "proc-campus-dev-000",
    name: "Hörsaalzentrum 024",
    source: "procedural",
    floors: [],
  },
  {
    id: "swiss-1689",
    name: "Swiss Dwellings · 1689",
    source: "swiss",
    floors: [],
  },
  {
    id: "osm-way360544293",
    name: "Munich Airport · Terminal 2",
    source: "osm",
    floors: [],
  },
  { id: "resplan-1465", name: "ResPlan · 1465", source: "resplan", floors: [] },
];
