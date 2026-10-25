import {
  ArrowDownUp,
  Navigation,
  Plus,
  X,
  Accessibility,
  LocateFixed,
  Route,
} from "lucide-react";
import { PlaceInput } from "./PlaceInput";
import type { BuildingData, RouteAction } from "../types";
export type TripSelection = {
  start: string;
  destination: string;
  via: string[];
  asset_query?: string;
};

export function DirectionsPanel({
  data,
  trip,
  onChange,
  stepFree,
  onStepFree,
  onRoute,
  onClear,
  busy,
  connected,
  route,
  current,
  onUseCurrent,
  error,
}: {
  data: BuildingData;
  trip: TripSelection;
  onChange: (trip: TripSelection) => void;
  stepFree: boolean;
  onStepFree: (v: boolean) => void;
  onRoute: () => void;
  onClear: () => void;
  busy: boolean;
  connected: boolean;
  route: RouteAction | null;
  current: string | null;
  onUseCurrent: () => void;
  error: string;
}) {
  return (
    <section className="directions-panel" aria-label="Indoor directions">
      <div className="directions-title">
        <div>
          <span className="eyebrow">INDOOR DIRECTIONS</span>
          <h1>Where to?</h1>
        </div>
        <button
          className="icon-button"
          aria-label="Clear directions"
          disabled={busy}
          onClick={onClear}
        >
          <X size={18} />
        </button>
      </div>
      <div className="trip-inputs">
        <PlaceInput
          data={data}
          disabled={busy}
          value={trip.start}
          label="Start"
          placeholder="Choose your starting place"
          onChange={(start) => onChange({ ...trip, start })}
        />
        <button
          className="swap-trip"
          aria-label="Swap start and destination"
          disabled={
            busy ||
            !trip.start ||
            !trip.destination ||
            trip.destination.startsWith("nearest:")
          }
          onClick={() =>
            onChange({
              start: trip.destination,
              destination: trip.start,
              asset_query: undefined,
              via: [...trip.via].reverse(),
            })
          }
        >
          <ArrowDownUp size={16} />
        </button>
        {trip.via.map((id, i) => (
          <div className="trip-stop" key={i}>
            <PlaceInput
              data={data}
              disabled={busy}
              value={id}
              label={`Stop ${i + 1}`}
              onChange={(value) =>
                onChange({
                  ...trip,
                  via: trip.via.map((s, n) => (n === i ? value : s)),
                })
              }
            />
            <button
              aria-label={`Remove stop ${i + 1}`}
              onClick={() =>
                onChange({ ...trip, via: trip.via.filter((_, n) => i !== n) })
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <PlaceInput
          data={data}
          disabled={busy}
          value={trip.destination}
          allowNearest
          label="Destination"
          placeholder="Room, 3D printer, nearest coffee…"
          onChange={(destination) =>
            onChange({
              ...trip,
              destination,
              asset_query: destination.startsWith("nearest:")
                ? destination.slice(8)
                : undefined,
            })
          }
        />
      </div>
      <div className="trip-shortcuts">
        <button disabled={!current || busy} onClick={onUseCurrent}>
          <LocateFixed size={13} />
          Use my marked location
        </button>
        <button
          disabled={trip.via.length >= 12 || busy}
          onClick={() => onChange({ ...trip, via: [...trip.via, ""] })}
        >
          <Plus size={13} />
          Add stop
        </button>
      </div>
      <label className="step-free-option">
        <input
          type="checkbox"
          disabled={busy}
          checked={stepFree}
          onChange={(e) => onStepFree(e.target.checked)}
        />
        <Accessibility size={17} />
        <span>
          Step-free route<small>Avoid stairs and stepped doorways</small>
        </span>
      </label>
      <button
        className="directions-submit"
        disabled={
          !connected ||
          busy ||
          !trip.start ||
          !trip.destination ||
          trip.via.some((v) => !v)
        }
        onClick={onRoute}
      >
        <Navigation size={17} />
        {busy ? "Finding your route…" : "Get directions"}
      </button>
      {!connected && (
        <p className="directions-error">
          Connect the building service to plan a route.
        </p>
      )}
      {error && (
        <p role="status" className="directions-error">
          {error}
        </p>
      )}
      {route && (
        <div className="trip-result">
          <Route size={19} />
          <div>
            <strong title={route.distance_note}>
              {Math.round(route.length_m * 10) / 10} m
              {route.distance_note ? " equiv." : ""}
            </strong>
            <span>
              {route.step_free ? "Step-free · " : ""}
              {new Set(route.segments?.map((s) => s.floor_id)).size ||
                Object.keys(route.floors).length}{" "}
              floor(s) · shortest available route
            </span>
          </div>
        </div>
      )}
      <p className="trip-hint">
        Search rooms or objects. “Nearest coffee machine” uses walking distance
        from your start.
      </p>
    </section>
  );
}
