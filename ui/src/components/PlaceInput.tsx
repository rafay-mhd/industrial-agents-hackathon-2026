import { useId, useState } from "react";
import { MapPin, X } from "lucide-react";
import type { BuildingData } from "../types";
import { placeChoices, nearestChoices } from "../lib/placeSearch";

export function PlaceInput({
  data,
  value,
  onChange,
  label,
  placeholder = "Search places, objects or room numbers",
  disabled = false,
  allowNearest = false,
}: {
  data: BuildingData;
  value: string;
  onChange: (id: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  allowNearest?: boolean;
}) {
  const id = useId(),
    [query, setQuery] = useState<string | null>(null),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const choices = placeChoices(data),
    selected =
      choices.find((s) => s.id === value) ||
      (value.startsWith("nearest:")
        ? {
            id: value,
            name: "Nearest " + value.slice(8).replaceAll("_", " "),
            detail: "Find by walking distance",
          }
        : undefined);
  const q = (query ?? selected?.name ?? "").trim().toLowerCase(),
    words = q.replace(/^(nearest|closest)\s+/, "").split(/\s+/);
  const matches = [
    ...(allowNearest ? nearestChoices(data, q) : []),
    ...choices.filter(
      (s) => !q || words.every((w) => s.search.toLowerCase().includes(w)),
    ),
  ].slice(0, 35);
  const choose = (room: string) => {
    onChange(room);
    setQuery(null);
    setOpen(false);
    setActive(0);
  };
  return (
    <div
      className="place-field"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="place-entry">
        <MapPin size={16} />
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={id + "-options"}
          aria-activedescendant={
            open && matches[active] ? `${id}-${active}` : undefined
          }
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          value={query ?? (selected ? selected.name : "")}
          onFocus={() => {
            setOpen(true);
            setActive(
              Math.max(
                0,
                matches.findIndex((s) => s.id === value),
              ),
            );
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange("");
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((v) => Math.min(v + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((v) => Math.max(0, v - 1));
            } else if (e.key === "Enter" && open && matches[active]) {
              e.preventDefault();
              choose(matches[active].id);
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
        {(value || query) && (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              choose("");
              setQuery(null);
            }}
            disabled={disabled}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {selected && !open && <small>{selected.detail}</small>}
      {open && (
        <div
          className="place-results"
          role="listbox"
          id={id + "-options"}
          aria-label={`${label} suggestions`}
        >
          {matches.map((s, i) => (
            <button
              type="button"
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              key={s.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s.id)}
            >
              <span>{s.name}</span>
              <small>{s.detail}</small>
            </button>
          ))}
          {!matches.length && (
            <p>
              No mapped places or objects match. Try Ask Inside for a
              natural-language request.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
