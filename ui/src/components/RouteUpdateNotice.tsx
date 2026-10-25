import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BellRing, Route, X, ArrowRightLeft } from "lucide-react";
import type { RouteUpdateAction } from "../types";
export function RouteUpdateNotice({
  update,
  onClose,
  compare,
  onCompare,
  canCompare,
}: {
  update: RouteUpdateAction | null;
  onClose: () => void;
  compare: boolean;
  onCompare: () => void;
  canCompare: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {update && (
        <motion.aside
          className={`route-update-notice ${update.new_length_m === null ? "blocked" : ""}`}
          role="status"
          aria-live="polite"
          initial={reduce ? false : { opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          <span className="route-update-icon">
            {update.changed ? <Route size={22} /> : <BellRing size={22} />}
          </span>
          <div>
            <span className="eyebrow">LIVE WARN · FOR YOUR TRIP</span>
            <strong>{update.title}</strong>
            <p>{update.message}</p>
            {update.changed && (
              <small>
                Live walking pauses for route changes. Confirm your current room
                before restarting.
              </small>
            )}
            {canCompare && update.changed && (
              <button className={compare ? "selected" : ""} onClick={onCompare}>
                <ArrowRightLeft size={13} />
                {compare ? "Hide previous route" : "See what changed"}
              </button>
            )}
          </div>
          <button
            className="dismiss-update"
            aria-label="Dismiss route update"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
