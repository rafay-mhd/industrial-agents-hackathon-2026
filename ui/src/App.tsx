import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  TriangleAlert,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Layers3,
  LoaderCircle,
  Map,
  MapPin,
  Mic,
  MicOff,
  Navigation,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
  X,
  Accessibility,
  Info,
  RotateCcw,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type {
  BuildingData,
  ChatMessage,
  ChatResponse,
  ChatAction,
  RouteUpdateAction,
  BuildingChange,
  Space,
  Asset,
} from "./types";
import { connectorLayouts } from "./lib/connectorLayout";
import { describeAsset } from "./lib/assetCatalog";
import { chat, presets, request } from "./lib/api";
import type { BuildingSummary, VoiceStatus } from "./lib/api";
import {
  applyMapActions,
  category,
  emptyMapState,
  interiorPoint,
  label,
  palette,
  parseBuilding,
  polygonArea,
  routeOnFloor,
  visibleClosures,
} from "./lib/model";
import type { Layers, Location, MapState } from "./lib/model";
import {
  RoutePlaybackProvider,
  RoutePlayer,
  FloorTransferOverlay,
  RouteReplayButton,
  WrittenRoute,
  RouteExploreButton,
} from "./components/RoutePlayback";
import IndoorMap from "./components/IndoorMap";
import type { Selection } from "./components/IndoorMap";
import { PixelPerson } from "./components/PixelPerson";
import ExplorerSheet from "./components/ExplorerSheet";
import type { Sheet } from "./components/ExplorerSheet";
import { useVoice } from "./hooks/useVoice";
import "./App.css";
import "./experience.css";
import "./maps.css";
import { DirectionsPanel } from "./components/DirectionsPanel";
import type { TripSelection } from "./components/DirectionsPanel";
import { BuildingUpdates } from "./components/BuildingUpdates";
import { AccessibilityPulse } from "./components/AccessibilityPulse";
import "./navigation-upgrade.css";
import { LiveWarnings } from "./components/LiveWarnings";
import { warningsOf } from "./lib/liveWarnings";
import { RouteUpdateNotice } from "./components/RouteUpdateNotice";
import { useBuildingFeed } from "./hooks/useBuildingFeed";
import type { PlannedTrip, FeedEvent } from "./hooks/useBuildingFeed";
import "./live-warnings.css";

const BuildingScene = lazy(() => import("./components/BuildingScene"));
const VoiceOrb = lazy(() => import("./components/VoiceOrb"));
const ShaderSurface = lazy(() => import("./components/ShaderSurface"));
const emptyTrip: TripSelection = { start: "", destination: "", via: [] };
const defaultId =
  new URLSearchParams(window.location.search).get("building") ||
  "proc-factory-dev-003";
const time = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const welcome = (): ChatMessage => ({
  id: crypto.randomUUID(),
  sender: "agent",
  text: "A little guidance goes a long way. Tell me where you are and where you’d like to go.",
  timestamp: time(),
});

export default function App() {
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const reducedMotion = useReducedMotion();
  const animateEffects = effectsEnabled && !reducedMotion;
  const [catalog, setCatalog] = useState<BuildingSummary[]>(presets),
    [server, setServer] = useState(false),
    [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceFeatures, setVoiceFeatures] = useState({
    streaming: false,
    realtime: false,
  });
  const [data, setData] = useState<BuildingData | null>(null),
    [buildingId, setBuildingId] = useState(defaultId),
    [floorId, setFloorId] = useState(""),
    [liveData, setLiveData] = useState(false);
  const [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [mapState, setMapState] = useState<MapState>(emptyMapState),
    [location, setLocation] = useState<Location | null>(null),
    [selection, setSelection] = useState<Selection>(null);
  const [layers, setLayers] = useState<Layers>({
    labels: true,
    openings: false,
    assets: true,
    route: true,
  });
  const [expandedMap, setExpandedMap] = useState(false);
  useEffect(() => {
    if (!expandedMap) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedMap(false);
    };
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", escape);
    };
  }, [expandedMap]);
  const [view, setView] = useState<"2d" | "3d">("2d"),
    [preview, setPreview] = useState(false),
    [activeStep, setActiveStep] = useState(0);
  const [directoryMode, setDirectoryMode] = useState<"rooms" | "objects">(
    "rooms",
  );
  const [assetFilter, setAssetFilter] = useState("all");
  const [directoryQuery, setDirectoryQuery] = useState(""),
    [buildingQuery, setBuildingQuery] = useState(""),
    [buildingPicker, setBuildingPicker] = useState(false);
  const [panel, setPanel] = useState<Sheet>(null),
    [sidebar, setSidebar] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [welcome()]),
    [draft, setDraft] = useState(""),
    [spokenAnswers, setSpokenAnswers] = useState(false);
  const [avatar, setAvatar] = useState(0),
    [stepFree, setStepFree] = useState(false);
  const [understood, setUnderstood] = useState(""),
    [clarification, setClarification] = useState(false);
  const session = useRef(crypto.randomUUID()),
    loadVersion = useRef(0),
    requestAbort = useRef<AbortController | null>(null),
    busyRef = useRef(false);
  const [trip, setTrip] = useState<TripSelection>(emptyTrip),
    [tripError, setTripError] = useState(""),
    [assistantOpen, setAssistantOpen] = useState(false);
  const tripClear = useRef<Promise<unknown>>(Promise.resolve());
  const plannedTrip = useRef<PlannedTrip | null>(null);
  const appliedRevision = useRef(0);
  const [pulseEnabled, setPulseEnabled] = useState(false);
  const receivePulse = useCallback(
    (pulse: import("./types").AccessibilityResult | null) =>
      setMapState((s) => ({ ...s, pulse })),
    [],
  );
  const [warningsOpen, setWarningsOpen] = useState(false),
    [routeUpdate, setRouteUpdate] = useState<RouteUpdateAction | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const canChat = server && liveData && !loading;

  const reset = useCallback((building: BuildingData, live: boolean) => {
    requestAbort.current?.abort();
    session.current = crypto.randomUUID();
    busyRef.current = false;
    setBusy(false);
    setData(building);
    setBuildingId(building.building.id);
    const url = new URL(window.location.href);
    url.searchParams.set("building", building.building.id);
    window.history.replaceState(null, "", url);
    setLiveData(live);
    setFloorId(
      (building.floors.find((f) => f.level === 0) ?? building.floors[0]).id,
    );
    setMapState({
      ...emptyMapState,
      closed:
        (building.building.closed_element_ids as string[] | undefined) ?? [],
    });
    setTrip(emptyTrip);
    setPulseEnabled(false);
    plannedTrip.current = null;
    appliedRevision.current = Number(building.building.revision ?? 0);
    setRouteUpdate(null);
    setTripError("");
    setLocation(null);
    setSelection(null);
    setPreview(false);
    setActiveStep(0);
    setDirectoryQuery("");
    setAssetFilter("all");
    setMessages([welcome()]);
    setUnderstood("");
    setClarification(false);
    setStepFree(false);
  }, []);
  const loadBuilding = useCallback(
    async (id: string, online: boolean) => {
      const version = ++loadVersion.current;
      setLoading(true);
      setNotice("");
      setBuildingPicker(false);
      requestAbort.current?.abort();
      try {
        let building: BuildingData,
          live = false;
        if (online) {
          try {
            building = parseBuilding(
              await request(`/buildings/${encodeURIComponent(id)}`, {
                signal: AbortSignal.timeout(10000),
              }),
            );
            live = true;
          } catch (error) {
            if (!presets.some((p) => p.id === id)) throw error;
            const response = await fetch(`/buildings/${id}.json`);
            if (!response.ok) throw new Error("Building could not be loaded.");
            building = parseBuilding(await response.json());
          }
        } else {
          const response = await fetch(`/buildings/${id}.json`);
          if (!response.ok)
            throw new Error("Connect the agent to load this building.");
          building = parseBuilding(await response.json());
        }
        if (version === loadVersion.current) reset(building, live);
      } catch (error) {
        if (version === loadVersion.current)
          setNotice(
            error instanceof Error
              ? error.message
              : "Could not load the building.",
          );
      } finally {
        if (version === loadVersion.current) setLoading(false);
      }
    },
    [reset],
  );
  const connect = useCallback(async () => {
    try {
      const [buildings, status] = await Promise.all([
        request<BuildingSummary[]>("/buildings", {
          signal: AbortSignal.timeout(4000),
        }),
        request<VoiceStatus>("/voice/status", {
          signal: AbortSignal.timeout(4000),
        }).catch(() => null),
      ]);
      setCatalog(buildings);
      setServer(true);
      setVoiceFeatures({
        streaming: !!status?.streaming,
        realtime: !!status?.realtime,
      });
      setVoiceAvailable(
        !!status?.configured &&
          !!status?.speech_to_text &&
          !!status?.text_to_speech,
      );
      return true;
    } catch {
      setCatalog(presets);
      setServer(false);
      setVoiceAvailable(false);
      return false;
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    void Promise.resolve()
      .then(connect)
      .then((online) => {
        if (mounted) void loadBuilding(defaultId, online);
      });
    return () => {
      mounted = false;
      requestAbort.current?.abort();
    };
  }, [connect, loadBuilding]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "nearest",
    });
  }, [messages, busy]);

  const receiveActions = useCallback((actions: ChatAction[]) => {
    const snapshot = actions.find((a) => a.type === "building_state");
    if (snapshot?.type === "building_state") {
      const revision = Number(snapshot.building.building.revision ?? 0);
      if (revision < appliedRevision.current) return;
      appliedRevision.current = revision;
    }
    setMapState((previous) => applyMapActions(previous, actions));
    for (const action of actions) {
      if (action.type === "building_state")
        setData((previous) =>
          Number(previous?.building.revision ?? 0) ===
          Number(action.building.building.revision ?? 0)
            ? previous
            : action.geometry_changed === false && previous
              ? { ...previous, building: action.building.building }
              : parseBuilding(action.building),
        );
      if (action.type === "route_update") setRouteUpdate(action);
      if (action.type === "route") {
        if (action.start_space_id && action.destination_space_id)
          plannedTrip.current = {
            start: action.start_space_id,
            destination:
              action.destination_asset_id ?? action.destination_space_id,
            asset_query: action.asset_query ?? undefined,
            via: action.via_place_ids ?? action.via_space_ids ?? [],
            step_free: action.step_free ?? false,
          };
        if (action.start_space_id && action.destination_space_id)
          setTrip({
            start: action.start_space_id,
            destination:
              action.destination_asset_id ?? action.destination_space_id,
            asset_query: action.asset_query ?? undefined,
            via: action.via_place_ids ?? action.via_space_ids ?? [],
          });
        if (action.step_free !== undefined) setStepFree(action.step_free);
        setTripError(action.geometry_notice ?? "");
        setPreview(false);
        setActiveStep(0);
      }
      if (action.type === "route_unavailable") {
        setTripError(action.reason);
        setPreview(false);
        setActiveStep(0);
      }
    }
  }, []);
  const requestTrip = useCallback(
    async (selection: TripSelection, accessible: boolean) => {
      if (
        !canChat ||
        busyRef.current ||
        !selection.start ||
        !selection.destination ||
        selection.via.some((v) => !v)
      )
        return;
      const current = session.current,
        controller = new AbortController();
      requestAbort.current = controller;
      busyRef.current = true;
      setBusy(true);
      setTripError("");
      setRouteUpdate(null);
      plannedTrip.current = { ...selection, step_free: accessible };
      setNotice("");
      setMapState((previous) => ({
        ...previous,
        route: null,
        previousRoute: null,
        comparePrevious: false,
      }));
      try {
        await tripClear.current;
        if (controller.signal.aborted || current !== session.current) return;
        const response = await request<Pick<ChatResponse, "actions" | "reply">>(
          `/buildings/${encodeURIComponent(buildingId)}/route`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: current,
              ...selection,
              step_free: accessible,
            }),
            signal: controller.signal,
          },
        );
        if (session.current !== current) return;
        receiveActions(response.actions);
        setSelection(null);
        const start = data?.spaces.find((s) => s.id === selection.start);
        if (start) setFloorId(start.floor_id);
      } catch (error) {
        if (!controller.signal.aborted && session.current === current)
          setTripError(
            error instanceof Error
              ? error.message
              : "Unable to find this route.",
          );
      } finally {
        if (session.current === current) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [canChat, buildingId, data, receiveActions],
  );
  const editBuilding = async (edit: Record<string, unknown>) => {
    if (!canChat || busyRef.current) return false;
    const current = session.current,
      controller = new AbortController();
    requestAbort.current = controller;
    busyRef.current = true;
    setBusy(true);
    setTripError("");
    try {
      const response = await request<Pick<ChatResponse, "actions" | "reply">>(
        `/buildings/${encodeURIComponent(buildingId)}/changes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: current, ...edit }),
          signal: controller.signal,
        },
      );
      if (current !== session.current) return false;
      receiveActions(response.actions);
      setNotice(response.reply);
      return true;
    } catch (error) {
      if (!controller.signal.aborted && current === session.current)
        setTripError(
          error instanceof Error
            ? error.message
            : "Unable to save this change.",
        );
      return false;
    } finally {
      if (current === session.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const forgetTrip = () => {
    plannedTrip.current = null;
    setRouteUpdate(null);
    setMapState((s) => ({ ...s, previousRoute: null, comparePrevious: false }));
    if (canChat)
      tripClear.current = request(
        `/buildings/${encodeURIComponent(buildingId)}/trip/${encodeURIComponent(session.current)}`,
        { method: "DELETE" },
      ).catch(() =>
        setNotice(
          "The map is cleared. Reconnect to clear the agent’s saved trip.",
        ),
      );
  };
  const changeTrip = (next: TripSelection) => {
    setTrip(next);
    setTripError("");
    if (mapState.route || plannedTrip.current) {
      setPreview(false);
      setMapState((s) => ({ ...s, route: null }));
      forgetTrip();
    }
  };
  const clearDirections = () => {
    setTrip(emptyTrip);
    plannedTrip.current = null;
    setRouteUpdate(null);
    setTripError("");
    setPreview(false);
    setMapState((s) => ({ ...s, route: null }));
    forgetTrip();
  };
  const revision = Number(data?.building.revision ?? 0);
  const receiveFeedEvent = useCallback((event: FeedEvent) => {
    setMapState((previous) => {
      if (
        previous.route?.element_ids?.some(
          (id) =>
            event.closed.includes(id) || event.unavailable_assets?.includes(id),
        )
      )
        return {
          ...previous,
          pulse: null,
          previousRoute: previous.route,
          route: null,
          comparePrevious: false,
        };
      return { ...previous, pulse: null };
    });
  }, []);
  const feedStatus = useBuildingFeed({
    buildingId,
    enabled: canChat,
    revision,
    appliedRevision,
    session,
    busy: busyRef,
    setBusy,
    trip: plannedTrip,
    onActions: receiveActions,
    onEvent: receiveFeedEvent,
    onError: setNotice,
  });
  const warningMutation = async (
    path: string,
    body: Record<string, unknown>,
  ) => {
    if (!canChat || busyRef.current) return false;
    const current = session.current,
      controller = new AbortController();
    requestAbort.current = controller;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await request<Pick<ChatResponse, "actions" | "reply">>(
        `/buildings/${encodeURIComponent(buildingId)}${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: current,
            ...body,
            planned_trip: plannedTrip.current
              ? { session_id: current, ...plannedTrip.current }
              : null,
          }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20000),
          ]),
        },
      );
      if (current !== session.current) return false;
      receiveActions(response.actions);
      setNotice(response.reply);
      return true;
    } catch (error) {
      if (!controller.signal.aborted && current === session.current)
        setNotice(
          error instanceof Error
            ? error.message
            : "Could not save this report.",
        );
      return false;
    } finally {
      if (current === session.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const openWarnings = () => {
    setWarningsOpen(true);
    setSidebar(true);
    setExpandedMap(false);
    requestAnimationFrame(() =>
      document
        .getElementById("community-warnings")
        ?.scrollIntoView({
          behavior: animateEffects ? "smooth" : "auto",
          block: "nearest",
        }),
    );
  };
  const locateWarning = (id: string) => {
    if (!data) return;
    const asset = data.assets?.find((a) => a.id === id);
    if (asset) {
      setFloorId(asset.floor_id);
      setSelection({ kind: "asset", id });
      setView("2d");
      return;
    }
    const connector = data.vertical_connectors?.find((c) => c.id === id);
    const space =
      data.spaces.find((s) => s.id === id) ||
      data.spaces.find(
        (s) => connector?.space_ids.includes(s.id) && s.floor_id === floorId,
      ) ||
      data.spaces.find((s) => connector?.space_ids.includes(s.id));
    const door = data.openings?.find((d) => d.id === id);
    if (space) {
      setFloorId(space.floor_id);
      setSelection({ kind: "space", id: space.id });
    } else if (door) {
      setFloorId(door.floor_id);
      setSelection({ kind: "opening", id: door.id });
    }
    setView("2d");
  };

  const send = useCallback(
    async (text: string, displayText = text): Promise<string | null> => {
      if (!text.trim() || busyRef.current) return null;
      if (!canChat) {
        setNotice(
          "Connect this building to the agent to enable questions and routing.",
        );
        return null;
      }
      const currentSession = session.current,
        controller = new AbortController();
      requestAbort.current = controller;
      busyRef.current = true;
      setBusy(true);
      setNotice("");
      setDraft("");
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          sender: "user",
          text: displayText.trim(),
          timestamp: time(),
        },
      ]);
      try {
        const response: ChatResponse = await chat(
          buildingId,
          currentSession,
          text.trim(),
          controller.signal,
        );
        if (session.current !== currentSession) return null;
        if (
          typeof response.reply !== "string" ||
          !Array.isArray(response.actions)
        )
          throw new Error(
            "The agent returned an unexpected response. Please retry.",
          );
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sender: "agent",
            text: response.reply,
            response,
            timestamp: time(),
          },
        ]);
        receiveActions(response.actions);
        setUnderstood(response.understood ?? "");
        setClarification(response.needs_clarification);
        if (
          response.actions.some((a) =>
            ["route", "closed", "door_added"].includes(a.type),
          )
        ) {
          setPreview(false);
          setActiveStep(0);
        }
        const highlighted = response.actions.find(
          (a) => a.type === "highlight",
        );
        if (highlighted?.type === "highlight") {
          const space = data?.spaces.find((s) =>
            highlighted.space_ids?.includes(s.id),
          );
          const asset = data?.assets?.find((a) =>
            highlighted.asset_ids?.includes(a.id),
          );
          if (space || asset) {
            setFloorId((space ?? asset)!.floor_id);
            setSelection(
              space
                ? { kind: "space", id: space.id }
                : { kind: "asset", id: asset!.id },
            );
          }
        }
        for (const action of response.actions)
          if (action.type === "building_created") {
            setNotice(
              "The agent created a building. Choose it from the refreshed building list.",
            );
            void connect();
          }
        return response.reply;
      } catch (error) {
        if (!controller.signal.aborted && session.current === currentSession)
          setNotice(
            error instanceof Error
              ? error.message
              : "The agent is unavailable. Please retry.",
          );
        return null;
      } finally {
        if (session.current === currentSession) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [buildingId, canChat, data, connect, receiveActions],
  );

  const voice = useVoice(buildingId, send, setNotice, {
    ...voiceFeatures,
    onInterrupt: () => requestAbort.current?.abort(),
  });
  const submitText = async (text: string, displayText = text) => {
    if (voice.active) voice.stop();
    const reply = await send(text, displayText);
    if (reply && spokenAnswers && voiceAvailable)
      await voice.speak(reply).catch((error) => setNotice(error.message));
  };
  const switchBuilding = (id: string) => {
    voice.stop();
    void loadBuilding(id, server);
  };
  const floor = data?.floors.find((f) => f.id === floorId) ?? data?.floors[0];
  const floors = useMemo(
    () => [...(data?.floors ?? [])].sort((a, b) => a.level - b.level),
    [data],
  );
  const spaces = useMemo(
    () => (data?.spaces ?? []).filter((s) => s.floor_id === floorId),
    [data, floorId],
  );
  const results = useMemo(() => {
    const query = directoryQuery.toLowerCase().trim();
    return (query ? (data?.spaces ?? []) : spaces)
      .filter(
        (s) =>
          !query ||
          `${label(s)} ${category(s)} ${s.id}`.toLowerCase().includes(query),
      )
      .sort((a, b) =>
        label(a).localeCompare(label(b), undefined, { numeric: true }),
      );
  }, [data, spaces, directoryQuery]);
  const objectResults = useMemo(() => {
    const q = directoryQuery.trim().toLowerCase();
    return (data?.assets ?? [])
      .filter(
        (a) =>
          (q || a.floor_id === floorId) &&
          (assetFilter === "all" || a.category === assetFilter) &&
          (!q ||
            `${a.name} ${a.type} ${a.category} ${a.id}`
              .toLowerCase()
              .includes(q)),
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  }, [data, directoryQuery, floorId, assetFilter]);
  const assetCategories = useMemo(
    () =>
      [
        ...new Set(
          (data?.assets ?? [])
            .map((a) => a.category)
            .filter((c): c is string => !!c),
        ),
      ].sort(),
    [data],
  );
  const directoryCount =
    directoryMode === "rooms" ? results.length : objectResults.length;
  const selectedSpace =
    selection?.kind === "space"
      ? data?.spaces.find((s) => s.id === selection.id)
      : undefined;
  const selectedConnector =
    selection?.kind === "connector"
      ? data?.vertical_connectors?.find((c) => c.id === selection.id)
      : undefined;
  const connectorGeometry = useMemo(
    () => (data ? connectorLayouts(data) : []),
    [data],
  );
  const selectedConnectorLayout = connectorGeometry.find(
    (c) => c.connector.id === selectedConnector?.id,
  );
  const selectedAsset =
    selection?.kind === "asset"
      ? data?.assets?.find((a) => a.id === selection.id)
      : undefined;
  const assetDescription = selectedAsset ? describeAsset(selectedAsset) : null;
  const selectedDoor =
    selection?.kind === "opening"
      ? [...(data?.openings ?? []), ...mapState.doors].find(
          (d) => d.id === selection.id,
        )
      : undefined;
  const displayedClosures = useMemo(
    () => (data ? visibleClosures(data, mapState.closed) : new Set<string>()),
    [data, mapState.closed],
  );
  const closedConnector = data?.vertical_connectors?.find(
    (c) =>
      mapState.closed.includes(c.id) &&
      c.space_ids.includes(selection?.id ?? ""),
  );
  const closureId = closedConnector?.id ?? selection?.id;
  const selectedName = selectedSpace
    ? label(selectedSpace)
    : selectedConnector?.name ||
      selectedAsset?.name ||
      selectedDoor?.name ||
      selectedDoor?.kind ||
      selection?.id;
  const currentLocation = data?.spaces.find((s) => s.id === location?.spaceId);
  const route = mapState.route;
  const phase = busy ? "thinking" : voice.phase;
  const phaseLabels = {
    idle: "Meet your building guide",
    connecting: "Opening your microphone",
    listening: "I’m listening",
    hearing: "Go on, I’m listening",
    transcribing: "Finding your words",
    thinking: "Finding the way",
    speaking: "Here’s your answer",
    error: "Let’s try that again",
  };
  const selectSpace = (space: Space) => {
    setFloorId(space.floor_id);
    setSelection({ kind: "space", id: space.id });
  };
  const selectAsset = (asset: Asset) => {
    setLayers((l) => ({ ...l, assets: true }));
    setFloorId(asset.floor_id);
    setSelection({ kind: "asset", id: asset.id });
  };
  const setHere = (space: Space) => {
    setLocation({
      spaceId: space.id,
      floorId: space.floor_id,
      position: interiorPoint(space.polygon),
    });
    setTrip((previous) => ({ ...previous, start: space.id }));
    if (canChat)
      void submitText(
        `I am currently in ${label(space)} (space id ${space.id}). ${stepFree ? "I need step-free routes." : ""} ${route ? "Replan my current trip from here, preserving the destination, visit order and accessibility requirements." : ""}`,
        `I’m in ${label(space)}.${stepFree ? " I need step-free routes." : ""}`,
      );
  };
  const goTo = (space: Space) => {
    const next = {
      ...trip,
      start: trip.start || currentLocation?.id || "",
      destination: space.id,
      asset_query: undefined,
    };
    setTrip(next);
    setSidebar(true);
    if (next.start) void requestTrip(next, stepFree);
    else setTripError("Choose a starting place to get directions.");
  };
  const created = async (value: BuildingData, warnings: string[]) => {
    const building = parseBuilding(value);
    const version = ++loadVersion.current;
    voice.stop();
    setLoading(false);
    await connect();
    if (version !== loadVersion.current) return;
    reset(building, true);
    setPanel(null);
    setNotice(
      (building.building.source === "floor-plan draft"
        ? "Draft building created and connected. Review the inferred rooms and doors. "
        : "Building connected. Chat, voice and routing are ready. ") +
        warnings.slice(0, 3).join(" "),
    );
  };
  const upload = async (file: File) => {
    try {
      if (file.size > 20 * 1024 * 1024)
        throw Error("Choose a JSON file under 20 MB.");
      parseBuilding(JSON.parse(await file.text()));
      const form = new FormData();
      form.append("file", file);
      const result = await request<{
        building: BuildingData;
        warnings: string[];
      }>("/buildings/import", { method: "POST", body: form });
      await created(result.building, result.warnings);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not import this building.",
      );
    }
  };
  const refresh = async () => {
    voice.stop();
    const online = await connect();
    if (online) await loadBuilding(buildingId, true);
    else
      setNotice(
        "The agent is offline. Bundled maps and local imports remain available.",
      );
  };

  return (
    <MotionConfig reducedMotion={effectsEnabled ? "user" : "always"}>
      <RoutePlaybackProvider
        data={data}
        route={route}
        location={location}
        playing={preview}
        setPlaying={setPreview}
        onFloorChange={setFloorId}
        onBegin={() => {
          setSelection(null);
          setLayers((l) => (l.route ? l : { ...l, route: true }));
        }}
        onClear={clearDirections}
        onWalkView={() => {
          setView("3d");
          setExpandedMap(true);
        }}
      >
        <div
          className={`app-shell inside-maps ${assistantOpen ? "assistant-open" : ""}`}
          data-motion={animateEffects ? "on" : "off"}
        >
          <div className="ambient-wash" aria-hidden="true">
            <Suspense fallback={null}>
              <ShaderSurface enabled={animateEffects} />
            </Suspense>
          </div>
          <header className="topbar" inert={expandedMap}>
            <a
              className="wordmark"
              href="#"
              onClick={(e) => e.preventDefault()}
              aria-label="Inside, your building guide"
            >
              <span className="brand-icon">
                <Compass size={22} strokeWidth={1.4} />
              </span>
              inside<span className="brand-dot">.</span>
            </a>
            <div className="topbar-center">
              <span className="topbar-orbit" aria-hidden="true">
                <i />
              </span>
              Your building, brought to life
            </div>
            <div className="topbar-actions">
              <button
                className="motion-toggle"
                aria-label="Animated visual effects"
                aria-pressed={animateEffects}
                disabled={!!reducedMotion}
                title={
                  reducedMotion
                    ? "Your system’s reduced-motion preference is enabled"
                    : animateEffects
                      ? "Pause decorative animations"
                      : "Resume decorative animations"
                }
                onClick={() => setEffectsEnabled((v) => !v)}
              >
                <Sparkles size={14} />
                <span>Motion {animateEffects ? "on" : "off"}</span>
              </button>
              <button
                className={`connection-pill ${canChat ? "connected" : ""}`}
                onClick={() => void refresh()}
                title="Refresh connection and building list"
              >
                <span className="status-dot" />
                {canChat ? "Agent connected" : "Map explorer"}
                <RotateCcw size={12} />
              </button>
              <button
                className="avatar-button"
                aria-label="Customize your map character"
                onClick={() => setPanel("profile")}
              >
                <PixelPerson variant={avatar} />
              </button>
            </div>
          </header>
          <div className={`workspace ${sidebar ? "" : "sidebar-collapsed"}`}>
            <aside
              className="sidebar"
              aria-label="Building, room and object directory"
              inert={expandedMap}
            >
              <div className="building-picker-wrap">
                <button
                  className="building-picker"
                  aria-expanded={buildingPicker}
                  onClick={() => setBuildingPicker((v) => !v)}
                >
                  <span className="building-symbol">
                    <Building2 size={21} strokeWidth={1.5} />
                  </span>
                  <span>
                    <small>CURRENT BUILDING</small>
                    <strong>
                      {data?.building.name ?? "Choose a building"}
                    </strong>
                  </span>
                  <ChevronDown size={15} />
                </button>
                <AnimatePresence>
                  {buildingPicker && (
                    <motion.div
                      className="building-popover"
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      <div className="search-field">
                        <Search size={15} />
                        <input
                          aria-label="Search buildings"
                          placeholder="Find a building…"
                          value={buildingQuery}
                          onChange={(e) => setBuildingQuery(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="building-options">
                        {catalog
                          .filter((b) =>
                            `${b.name} ${b.id}`
                              .toLowerCase()
                              .includes(buildingQuery.toLowerCase()),
                          )
                          .map((b) => (
                            <button
                              key={b.id}
                              onClick={() => switchBuilding(b.id)}
                              className={b.id === buildingId ? "selected" : ""}
                            >
                              <Building2 size={16} />
                              <span>
                                {b.name}
                                <small>
                                  {b.source} · {b.id}
                                </small>
                              </span>
                              {b.id === buildingId && <Check size={14} />}
                            </button>
                          ))}
                      </div>
                      <div className="popover-footer">
                        {catalog.length} buildings available
                        <button onClick={() => setBuildingPicker(false)}>
                          Close
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {data && (
                <DirectionsPanel
                  data={data}
                  trip={trip}
                  onChange={changeTrip}
                  stepFree={stepFree}
                  onStepFree={(value) => {
                    setStepFree(value);
                    if (route || plannedTrip.current)
                      void requestTrip(trip, value);
                  }}
                  onRoute={() => void requestTrip(trip, stepFree)}
                  onClear={clearDirections}
                  busy={busy || voice.active}
                  connected={canChat}
                  route={route}
                  current={currentLocation?.id ?? null}
                  onUseCurrent={() =>
                    currentLocation &&
                    changeTrip({ ...trip, start: currentLocation.id })
                  }
                  error={tripError}
                />
              )}
              {data && (
                <AccessibilityPulse
                  data={data}
                  start={trip.start || location?.spaceId || ""}
                  enabled={pulseEnabled}
                  onEnabled={(v) => {
                    setPulseEnabled(v);
                    setMapState((s) => ({ ...s, pulseActive: v, pulse: null }));
                  }}
                  result={mapState.pulse ?? null}
                  onResult={receivePulse}
                  connected={canChat}
                />
              )}
              {data && (
                <LiveWarnings
                  key={buildingId}
                  data={data}
                  busy={busy}
                  connected={!!canChat}
                  onReconnect={() => void refresh()}
                  status={feedStatus}
                  selected={selection?.id ?? ""}
                  open={warningsOpen}
                  setOpen={setWarningsOpen}
                  onPost={(body) => warningMutation("/warnings", body)}
                  onResolve={(id) =>
                    warningMutation(
                      `/warnings/${encodeURIComponent(id)}/resolve`,
                      {},
                    )
                  }
                  onLocate={locateWarning}
                />
              )}
              {data && canChat && (
                <BuildingUpdates
                  data={data}
                  closed={mapState.closed}
                  changes={
                    (data.building.changes as BuildingChange[] | undefined) ??
                    []
                  }
                  busy={busy || voice.active}
                  onEdit={editBuilding}
                />
              )}
              <details className="explore-directory">
                <summary>
                  <Search size={16} />
                  Explore rooms & objects<span>{directoryCount}</span>
                </summary>
                <div className="directory-heading">
                  <span className="eyebrow">THE DIRECTORY</span>
                  <span>{directoryCount}</span>
                </div>
                <div
                  className="directory-tabs"
                  role="group"
                  aria-label="Directory type"
                >
                  <button
                    aria-pressed={directoryMode === "rooms"}
                    onClick={() => {
                      setDirectoryMode("rooms");
                      setDirectoryQuery("");
                    }}
                  >
                    {directoryMode === "rooms" && (
                      <motion.span
                        className="tab-indicator"
                        layoutId="directory-tab"
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 36,
                        }}
                      />
                    )}
                    <Map size={14} /> Rooms
                  </button>
                  <button
                    aria-pressed={directoryMode === "objects"}
                    onClick={() => {
                      setDirectoryMode("objects");
                      setDirectoryQuery("");
                    }}
                  >
                    {directoryMode === "objects" && (
                      <motion.span
                        className="tab-indicator"
                        layoutId="directory-tab"
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 36,
                        }}
                      />
                    )}
                    <Box size={14} /> Objects
                  </button>
                </div>
                <div className="search-field directory-search">
                  <Search size={16} />
                  <input
                    aria-label={
                      directoryMode === "rooms"
                        ? "Search rooms across all floors"
                        : "Search objects across all floors"
                    }
                    placeholder={
                      directoryMode === "rooms"
                        ? "A room, a place, a purpose…"
                        : "A desk, a machine, a chair…"
                    }
                    value={directoryQuery}
                    onChange={(e) => setDirectoryQuery(e.target.value)}
                  />
                  {directoryQuery && (
                    <button
                      aria-label="Clear directory search"
                      onClick={() => setDirectoryQuery("")}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                {directoryMode === "objects" && (
                  <div className="object-directory-filter">
                    <select
                      aria-label="Object category"
                      value={assetFilter}
                      onChange={(e) => setAssetFilter(e.target.value)}
                    >
                      <option value="all">All object types</option>
                      {assetCategories.map((c) => (
                        <option key={c} value={c}>
                          {c.charAt(0).toUpperCase() + c.slice(1)}
                        </option>
                      ))}
                    </select>
                    <span>{directoryQuery ? "All floors" : floor?.name}</span>
                  </div>
                )}
                <div className="directory-list">
                  {directoryMode === "objects" &&
                    objectResults.slice(0, 100).map((asset) => (
                      <button
                        className={`directory-item object-item ${selection?.id === asset.id ? "selected" : ""}`}
                        key={asset.id}
                        onClick={() => selectAsset(asset)}
                      >
                        <span className="object-list-icon">
                          <Box size={16} />
                        </span>
                        <span>
                          <strong>{asset.name}</strong>
                          <small>
                            {asset.type?.replaceAll("_", " ") || "Unclassified"}{" "}
                            ·{" "}
                            {data?.spaces.find((s) => s.id === asset.space_id)
                              ?.name || "Room unspecified"}
                          </small>
                        </span>
                        <ChevronRight size={13} />
                      </button>
                    ))}
                  {directoryMode === "rooms" &&
                    results.slice(0, 100).map((space) => (
                      <button
                        className={`directory-item ${selection?.id === space.id ? "selected" : ""}`}
                        key={space.id}
                        onClick={() => selectSpace(space)}
                      >
                        <span
                          className="room-dot"
                          style={{ backgroundColor: palette(space).ink }}
                        />
                        <span>
                          <strong>{label(space)}</strong>
                          <small>
                            {category(space)}
                            {directoryQuery
                              ? ` · ${data?.floors.find((f) => f.id === space.floor_id)?.name}`
                              : ""}
                          </small>
                        </span>
                        {displayedClosures.has(space.id) ? (
                          <span className="closed-tag">Closed</span>
                        ) : (
                          <ChevronRight size={13} />
                        )}
                      </button>
                    ))}
                  {!directoryCount && (
                    <p className="empty-note">
                      No {directoryMode} match this search.
                      <br />
                      Try a name or type.
                    </p>
                  )}
                  {directoryCount > 100 && (
                    <p className="empty-note">
                      Showing 100 of {directoryCount}. Search to narrow the
                      list.
                    </p>
                  )}
                </div>
              </details>
              <div className="sidebar-bottom">
                <button
                  className="import-link"
                  onClick={() => {
                    setNotice("");
                    setPanel("import");
                  }}
                >
                  <span>
                    <Upload size={18} />
                  </span>
                  <div>
                    <strong>Somewhere new?</strong>
                    <small>Bring your own building</small>
                  </div>
                  <ArrowUpRight size={17} />
                </button>
                <button
                  className="source-link"
                  onClick={() => setPanel("source")}
                >
                  <ShieldCheck size={13} />
                  Original building data
                  <ChevronRight size={12} />
                </button>
              </div>
            </aside>
            <main className="main-workspace">
              <div className="workspace-heading" inert={expandedMap}>
                <div>
                  <div className="breadcrumb">
                    <button
                      onClick={() => setSidebar((v) => !v)}
                      aria-label={
                        sidebar ? "Hide directions" : "Show directions"
                      }
                    >
                      {sidebar ? (
                        <PanelLeftClose size={16} />
                      ) : (
                        <PanelLeftOpen size={16} />
                      )}
                    </button>
                    <span>Indoor map</span>
                    <ChevronRight size={11} />
                    <span>{floor?.name ?? "Your building"}</span>
                  </div>
                  <h2>
                    {data?.building.name ?? "Your next destination"}
                    <span className="heading-spark">✧</span>
                  </h2>
                  <p className="workspace-subtitle">
                    Rooms, doorways and routes across every floor.
                  </p>
                </div>
                <div className="heading-details">
                  {data && (
                    <div className="building-facts">
                      <span>
                        <Layers3 size={13} />
                        <strong>{floors.length}</strong>{" "}
                        {floors.length === 1 ? "floor" : "floors"}
                      </span>
                      <span>
                        <MapPin size={13} />
                        <strong>{data.spaces.length}</strong> spaces
                      </span>
                    </div>
                  )}
                  <button
                    className="subtle-button"
                    aria-label="About this place"
                    onClick={() => setPanel("source")}
                  >
                    <Info size={16} />
                    <span>About this place</span>
                  </button>
                </div>
              </div>
              <button
                className="assistant-launcher"
                aria-expanded={assistantOpen}
                aria-controls="building-assistant"
                onClick={() => {
                  if (assistantOpen) voice.stop();
                  setAssistantOpen((v) => !v);
                }}
              >
                <Mic size={17} />
                {assistantOpen ? "Close assistant" : "Ask Inside"}
                <span>Voice & chat</span>
              </button>
              <div className="explorer-grid">
                <section
                  id="building-explorer"
                  className={`map-card ${expandedMap ? "expanded-map" : ""}`}
                  aria-label="Building explorer"
                >
                  <div className="map-toolbar">
                    <div className="view-switch" aria-label="Map view">
                      {(["2d", "3d"] as const).map((mode) => (
                        <button
                          key={mode}
                          className={view === mode ? "active" : ""}
                          aria-pressed={view === mode}
                          onClick={() => setView(mode)}
                        >
                          {view === mode && (
                            <motion.span
                              className="tab-indicator"
                              layoutId="map-view-tab"
                              transition={{
                                type: "spring",
                                stiffness: 420,
                                damping: 36,
                              }}
                            />
                          )}
                          {mode === "2d" ? (
                            <Map size={15} />
                          ) : (
                            <Layers3 size={15} />
                          )}
                          {mode === "2d" ? "2D map" : "3D building"}
                        </button>
                      ))}
                    </div>
                    <div className="map-tools">
                      {expandedMap && (
                        <span className="expanded-building-name">
                          {data?.building.name}
                        </span>
                      )}
                      <span className="map-data-badge">
                        <span />
                        {liveData ? "Live building" : "Local map"}
                      </span>
                      {data && (
                        <button
                          className="map-warnings-button"
                          aria-label="View building warnings"
                          aria-controls="community-warnings"
                          onClick={openWarnings}
                        >
                          <TriangleAlert size={17} />
                          <span>Warnings</span>
                          <b>
                            {
                              warningsOf(data).filter(
                                (w) => w.status === "active",
                              ).length
                            }
                          </b>
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label="Map layers"
                        onClick={() => setPanel("layers")}
                      >
                        <Settings2 size={18} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={
                          expandedMap ? "Exit expanded map" : "Expand map"
                        }
                        aria-expanded={expandedMap}
                        aria-controls="building-explorer"
                        onClick={() => setExpandedMap((v) => !v)}
                      >
                        {expandedMap ? (
                          <Minimize2 size={18} />
                        ) : (
                          <Maximize2 size={18} />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="map-body">
                    <RouteUpdateNotice
                      update={routeUpdate}
                      onClose={() => setRouteUpdate(null)}
                      compare={!!mapState.comparePrevious}
                      onCompare={() => {
                        setView("2d");
                        setMapState((s) => ({
                          ...s,
                          comparePrevious: !s.comparePrevious,
                        }));
                      }}
                      canCompare={
                        !!mapState.previousRoute &&
                        !!mapState.route &&
                        JSON.stringify(mapState.previousRoute.segments) !==
                          JSON.stringify(mapState.route.segments)
                      }
                    />

                    <div className="map-atmosphere" aria-hidden="true">
                      <Suspense fallback={null}>
                        <ShaderSurface kind="stage" enabled={animateEffects} />
                      </Suspense>
                    </div>
                    {data && floor && (
                      <Suspense
                        fallback={
                          <div className="map-loading">
                            <LoaderCircle className="spin" />
                            Preparing your 3D building…
                          </div>
                        }
                      >
                        {view === "2d" ? (
                          <IndoorMap
                            key={`${buildingId}:${floor.id}`}
                            data={data}
                            floor={floor}
                            state={mapState}
                            layers={layers}
                            selected={selection}
                            location={location}
                            avatar={avatar}
                            onSelect={setSelection}
                            onWarning={openWarnings}
                          />
                        ) : (
                          <BuildingScene
                            key={buildingId}
                            data={data}
                            floor={floor}
                            state={mapState}
                            layers={layers}
                            selected={selection}
                            location={location}
                            avatar={avatar}
                            wheelchair={stepFree}
                            onSelect={(next) => {
                              setSelection(next);
                              const item =
                                next?.kind === "space"
                                  ? data.spaces.find((s) => s.id === next.id)
                                  : next?.kind === "asset"
                                    ? data.assets?.find((a) => a.id === next.id)
                                    : [
                                        ...(data.openings ?? []),
                                        ...mapState.doors,
                                      ].find((d) => d.id === next?.id);
                              if (item) setFloorId(item.floor_id);
                            }}
                          />
                        )}
                      </Suspense>
                    )}
                    <RoutePlayer avatar={avatar} />
                    <FloorTransferOverlay />
                    {loading && (
                      <div className="map-loading">
                        <LoaderCircle className="spin" />
                        Getting to know the building…
                      </div>
                    )}
                    {!loading && !data && (
                      <div className="map-loading">
                        <Building2 />
                        No map loaded
                        <button
                          className="primary-button"
                          onClick={() => void refresh()}
                        >
                          Try again
                        </button>
                      </div>
                    )}
                    <div className="floor-switch" aria-label="Choose a floor">
                      {[...floors].reverse().map((f) => (
                        <RouteExploreButton
                          key={f.id}
                          title={f.name}
                          className={floorId === f.id ? "active" : ""}
                          aria-label={f.name}
                          aria-pressed={floorId === f.id}
                          onClick={() => {
                            setFloorId(f.id);
                            setSelection(null);
                          }}
                        >
                          {f.level === 0
                            ? "G"
                            : f.level < 0
                              ? `B${Math.abs(f.level)}`
                              : f.level}
                          {route && routeOnFloor(route, f).length > 0 && (
                            <span />
                          )}
                        </RouteExploreButton>
                      ))}
                    </div>
                    <AnimatePresence>
                      {selection && selectedName && (
                        <motion.div
                          className={`selection-card ${selectedAsset ? "object-selection" : ""}`}
                          key={selection.id}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                        >
                          <div className="selection-title">
                            <span className="eyebrow">
                              {selectedSpace
                                ? category(selectedSpace)
                                : selectedAsset
                                  ? selectedAsset.type?.replaceAll("_", " ") ||
                                    "Equipment"
                                  : selectedConnector
                                    ? selectedConnector.kind === "lift"
                                      ? "Lift connection"
                                      : selectedConnector.kind === "stairs"
                                        ? "Stair connection"
                                        : "Floor connection"
                                    : "Opening"}
                            </span>
                            <button
                              aria-label="Close selection"
                              onClick={() => setSelection(null)}
                            >
                              <X size={15} />
                            </button>
                          </div>
                          <h3>{selectedName}</h3>
                          <p>
                            {selectedSpace
                              ? `${polygonArea(selectedSpace.polygon).toLocaleString(undefined, { maximumFractionDigits: 1 })} m² · ${data?.floors.find((f) => f.id === selectedSpace.floor_id)?.name}`
                              : selectedConnector
                                ? selectedConnector.floor_ids
                                    .map(
                                      (id) =>
                                        data?.floors.find((f) => f.id === id)
                                          ?.name ?? id,
                                    )
                                    .join(" ↔ ")
                                : selectedDoor
                                  ? `${selectedDoor.width_m != null ? `${selectedDoor.width_m} m wide` : "Width not supplied"} · ${selectedDoor.step_free == null ? "Accessibility unknown" : selectedDoor.step_free ? "Step-free" : "Has a step"}`
                                  : `${selectedAsset?.category || "Asset"} · ${data?.spaces.find((s) => s.id === selectedAsset?.space_id)?.name || ""}`}
                          </p>
                          {selectedConnector && (
                            <div className="connector-details">
                              <span className="connection-access">
                                {selectedConnector.step_free === true
                                  ? "Step-free connection"
                                  : selectedConnector.step_free === false
                                    ? "Not step-free"
                                    : "Accessibility not supplied"}
                                {selectedConnector.synthetic
                                  ? " · Generated source link"
                                  : ""}
                              </span>
                              <div className="connection-stops">
                                {selectedConnector.space_ids
                                  .map((id) =>
                                    data?.spaces.find((s) => s.id === id),
                                  )
                                  .filter((s): s is Space => !!s)
                                  .map((stop) => (
                                    <button
                                      key={stop.id}
                                      onClick={() => selectSpace(stop)}
                                    >
                                      <Layers3 size={13} />
                                      <span>
                                        {
                                          data?.floors.find(
                                            (f) => f.id === stop.floor_id,
                                          )?.name
                                        }
                                        <small>{label(stop)}</small>
                                      </span>
                                      <ArrowUpRight size={12} />
                                    </button>
                                  ))}
                              </div>
                              <p>
                                {!selectedConnectorLayout
                                  ? "Insufficient landing data to draw this connection."
                                  : selectedConnectorLayout.spans.some(
                                        (s) => !s.footprint,
                                      )
                                    ? "Offset or ambiguous landings use schematic links. No shaft position is invented."
                                    : "Connected at source floor elevations. Stair flights, rails and shaft outlines are illustrative."}
                              </p>
                              <button
                                className="text-button"
                                disabled={!canChat || busy}
                                onClick={() =>
                                  void submitText(
                                    `Tell me about ${selectedConnector.name} (connector id ${selectedConnector.id}), which floors it connects and its accessibility.`,
                                    `Tell me about ${selectedConnector.name}.`,
                                  )
                                }
                              >
                                Ask about this connection{" "}
                                <ArrowRight size={13} />
                              </button>
                            </div>
                          )}
                          {selectedSpace && (
                            <div className="selection-actions">
                              <button
                                onClick={() => setHere(selectedSpace)}
                                disabled={busy}
                              >
                                <MapPin size={14} />
                                I’m here
                              </button>
                              <button
                                className="primary-button"
                                onClick={() => goTo(selectedSpace)}
                                disabled={!canChat || busy}
                              >
                                <Navigation size={14} />
                                Go here
                              </button>
                            </div>
                          )}
                          {(selectedSpace ||
                            selectedDoor ||
                            selectedConnector) && (
                            <button
                              className="closure-action"
                              disabled={!canChat || busy}
                              onClick={() =>
                                void submitText(
                                  `${closureId && mapState.closed.includes(closureId) ? "Reopen" : "Close"} ${closedConnector?.name || selectedName} (element id ${closureId}).`,
                                  `${closureId && mapState.closed.includes(closureId) ? "Reopen" : "Close"} ${closedConnector?.name || selectedName}.`,
                                )
                              }
                            >
                              {selectedConnector
                                ? mapState.closed.includes(selectedConnector.id)
                                  ? "Reopen this connection"
                                  : "Mark connection as closed"
                                : closedConnector
                                  ? `Reopen ${closedConnector.name || "this connector"}`
                                  : mapState.closed.includes(selection.id)
                                    ? "Reopen this space / opening"
                                    : "Mark as temporarily closed"}
                            </button>
                          )}
                          {selectedAsset && assetDescription && (
                            <div className="object-details">
                              <div className="object-source">
                                <span
                                  className={
                                    selectedAsset.source === "dataset"
                                      ? "annotated"
                                      : "generated"
                                  }
                                />
                                {assetDescription.provenance}
                              </div>
                              <dl>
                                <div>
                                  <dt>Footprint</dt>
                                  <dd>
                                    {assetDescription.footprintKnown
                                      ? `${assetDescription.width} × ${assetDescription.depth} m`
                                      : "Not supplied"}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Height</dt>
                                  <dd>
                                    {assetDescription.heightKnown
                                      ? `${assetDescription.height} m`
                                      : "Estimated for display"}
                                  </dd>
                                </div>
                              </dl>

                              {assetDescription.family === "unknown" && (
                                <p>
                                  Unclassified shape shown as a bounding volume.
                                </p>
                              )}
                              <details>
                                <summary>About this model</summary>
                                <p>
                                  Position & identity from the source. Shape and
                                  finishes are illustrative.
                                </p>
                                <p>
                                  Orientation:{" "}
                                  {assetDescription.footprintKnown
                                    ? `${assetDescription.rotation}°`
                                    : "not supplied"}
                                  .
                                </p>
                                <code>{selectedAsset.id}</code>
                              </details>
                            </div>
                          )}
                          {selectedAsset && (
                            <button
                              className="text-button"
                              disabled={!canChat || busy}
                              onClick={() =>
                                void submitText(
                                  `Tell me about ${selectedAsset.name} (asset id ${selectedAsset.id}).`,
                                  `Tell me about ${selectedAsset.name}.`,
                                )
                              }
                            >
                              Ask about this item
                              <ArrowRight size={13} />
                            </button>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="map-footer">
                    <div
                      className="legend"
                      title="Room categories; choose Room colours to colour the 3D model by use."
                    >
                      {[
                        ...new globalThis.Map(
                          (view === "3d" ? (data?.spaces ?? []) : spaces).map(
                            (s) => {
                              const p = palette(s);
                              return [p.group, p] as const;
                            },
                          ),
                        ).values(),
                      ].map((p) => (
                        <span key={p.group}>
                          <i
                            style={{
                              background: view === "3d" ? p.solid : p.fill,
                            }}
                          />
                          {p.group}
                        </span>
                      ))}
                      {mapState.closed.length > 0 && (
                        <span>
                          <i style={{ background: "#b34252" }} />
                          {mapState.closed.length} closed
                        </span>
                      )}
                    </div>
                    <span>
                      {view === "3d"
                        ? `${data?.spaces.length ?? 0} mapped spaces · ${floors.length} floors`
                        : `${spaces.length} spaces · ${floor?.name}`}
                    </span>
                  </div>
                </section>
                <aside
                  id="building-assistant"
                  className="assistant-card"
                  hidden={!assistantOpen}
                  data-phase={phase}
                  inert={expandedMap}
                  aria-label="Your building assistant"
                >
                  <div className="assistant-header">
                    <span>
                      <Sparkles size={16} />
                      YOUR BUILDING GUIDE
                    </span>
                    <button
                      className="icon-button"
                      aria-label="Close assistant"
                      onClick={() => {
                        voice.stop();
                        setAssistantOpen(false);
                      }}
                    >
                      <X size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={
                        spokenAnswers
                          ? "Mute spoken replies"
                          : "Enable spoken replies"
                      }
                      aria-pressed={spokenAnswers}
                      disabled={!voiceAvailable}
                      onClick={() => {
                        if (spokenAnswers) voice.stop();
                        setSpokenAnswers((v) => !v);
                      }}
                    >
                      {spokenAnswers ? (
                        <Volume2 size={17} />
                      ) : (
                        <VolumeX size={17} />
                      )}
                    </button>
                  </div>
                  <div className="voice-stage">
                    {voice.transcript && (
                      <p className="live-transcript" aria-live="polite">
                        {voice.transcript}
                      </p>
                    )}
                    <div className="voice-art">
                      <div className="voice-shader-halo">
                        <Suspense fallback={null}>
                          <ShaderSurface
                            kind="halo"
                            enabled={animateEffects && !expandedMap}
                            active={voice.active || busy}
                          />
                        </Suspense>
                      </div>
                      <div className="voice-orbits" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </div>
                      <Suspense
                        fallback={
                          <div className="orb-shell">
                            <div className="orb-render orb-fallback" />
                          </div>
                        }
                      >
                        <VoiceOrb
                          phase={phase}
                          input={voice.input}
                          output={voice.output}
                          animated={animateEffects && !expandedMap}
                        />
                      </Suspense>
                    </div>
                    <div
                      className={`voice-state ${phase !== "idle" && phase !== "error" ? "engaged" : ""}`}
                    >
                      <i />
                      {phase === "idle"
                        ? "A little guidance, a conversation away"
                        : phase === "error"
                          ? "Connection needs attention"
                          : "Your guide is with you"}
                    </div>
                    <h3 aria-live="polite">{phaseLabels[phase]}</h3>
                    <p>
                      {voice.active
                        ? "Speak naturally. Pause to send your question."
                        : "A familiar voice in an unfamiliar place."}
                    </p>
                    <button
                      className={`voice-button ${voice.active ? "active" : ""}`}
                      disabled={
                        !canChat ||
                        !voiceAvailable ||
                        (!voice.active &&
                          (busy || voice.phase === "connecting"))
                      }
                      onClick={() => {
                        if (voice.active) voice.stop();
                        else void voice.start();
                      }}
                    >
                      {voice.active ? <MicOff size={15} /> : <Mic size={15} />}
                      {voice.active ? "End conversation" : "Let’s talk"}
                      {!voice.active && <ArrowUpRight size={14} />}
                    </button>
                    {phase === "speaking" && (
                      <button
                        className="interrupt-button"
                        onClick={voice.interrupt}
                      >
                        {voice.active ? "Interrupt & speak" : "Stop playback"}
                      </button>
                    )}
                    <span className="voice-caption">
                      {voiceAvailable && canChat
                        ? `YOUR AGENT · ${voice.active ? (voice.transport === "realtime" ? "LIVE VOICE" : "TURN-BY-TURN VOICE") : "ELEVENLABS VOICE"}`
                        : canChat
                          ? "Voice service unavailable · text is ready"
                          : "Connect the agent to start a conversation"}
                    </span>
                  </div>
                  <div className="conversation-divider">
                    <span />
                    OR, A FEW WORDS
                    <span />
                  </div>
                  <div
                    className="conversation"
                    role="log"
                    aria-label="Conversation with your building agent"
                    aria-live="polite"
                  >
                    {messages.map((message) => (
                      <motion.div
                        key={message.id}
                        className={`message message-${message.sender}`}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <span className="message-author">
                          {message.sender === "agent" ? (
                            <>
                              <span className="mini-spark">✧</span>Inside
                            </>
                          ) : (
                            <>
                              You
                              <PixelPerson variant={avatar} />
                            </>
                          )}
                          <time>{message.timestamp}</time>
                        </span>
                        <p>{message.text}</p>
                        {message.response?.needs_clarification && (
                          <span className="clarification-label">
                            One detail will help me get this right
                          </span>
                        )}
                      </motion.div>
                    ))}
                    {busy && (
                      <div className="thinking-message">
                        <span />
                        <span />
                        <span />
                        <small>Checking your building</small>
                      </div>
                    )}
                    <div ref={chatEnd} />
                  </div>
                  {messages.length < 2 && (
                    <div className="suggestions">
                      <button
                        disabled={!canChat}
                        onClick={() =>
                          void submitText(
                            "Give me a quick overview of this building.",
                          )
                        }
                      >
                        <Building2 size={13} />
                        Show me around
                        <ArrowUpRight size={12} />
                      </button>
                      <button
                        disabled={!canChat}
                        onClick={() =>
                          void submitText(
                            "Where are the lifts in this building?",
                          )
                        }
                      >
                        <Accessibility size={13} />
                        Find a lift
                        <ArrowUpRight size={12} />
                      </button>
                    </div>
                  )}
                  <form
                    className="composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitText(draft);
                    }}
                  >
                    <textarea
                      rows={1}
                      aria-label="Message your building agent"
                      placeholder={
                        voice.active
                          ? "End voice to type a message…"
                          : clarification
                            ? "Add that little detail…"
                            : "Where would you like to go?"
                      }
                      value={draft}
                      disabled={voice.active}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (draft.trim() && !busy) void submitText(draft);
                        }
                      }}
                    />
                    <button
                      aria-label="Send message"
                      disabled={
                        !draft.trim() || busy || !canChat || voice.active
                      }
                    >
                      {busy ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        <ArrowRight size={18} />
                      )}
                    </button>
                  </form>
                  <div className="assistant-footnote">
                    Grounded in your building’s data.
                  </div>
                </aside>
                <section className="journey-card" inert={expandedMap}>
                  <div className="journey-person">
                    <PixelPerson variant={avatar} />
                    <span className="person-ring" />
                  </div>
                  <div className="journey-location">
                    <span className="eyebrow">YOU ARE HERE</span>
                    <strong>
                      {currentLocation
                        ? label(currentLocation)
                        : "A good place to begin"}
                    </strong>
                    <span>
                      {currentLocation
                        ? `${data?.floors.find((f) => f.id === currentLocation.floor_id)?.name} · Location you selected`
                        : "Select a room on the map, then “I’m here”."}
                    </span>
                  </div>
                  <button
                    className={`accessibility-toggle ${stepFree ? "active" : ""}`}
                    aria-pressed={stepFree}
                    disabled={busy || voice.active}
                    onClick={() => {
                      const next = !stepFree;
                      setStepFree(next);
                      if (canChat)
                        void submitText(
                          next
                            ? "For my next routes, I need step-free access. Avoid stairs."
                            : "For my next routes, stairs are allowed again.",
                        );
                    }}
                  >
                    <Accessibility size={18} />
                    <span>Step-free</span>
                    <i />
                  </button>
                </section>
              </div>
              <AnimatePresence>
                {route && (
                  <motion.section
                    className="route-card"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <div className="route-heading">
                      <div>
                        <span className="eyebrow">YOUR ROUTE</span>
                        <h3>
                          {route.length_m.toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                          })}
                          <span>metres to your destination.</span>
                        </h3>
                      </div>
                      <div>
                        <RouteReplayButton />
                        <button
                          className="icon-button"
                          aria-label="Clear displayed route"
                          onClick={() =>
                            setMapState((s) => ({ ...s, route: null }))
                          }
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                    {understood && (
                      <p className="route-understood">{understood}</p>
                    )}
                    {route.steps.some((step) =>
                      /outside|outdoor/i.test(step),
                    ) && (
                      <p className="outdoor-note">
                        <Info size={14} />
                        This journey goes outside. The map shows the indoor
                        geometry supplied by the agent; follow the full written
                        directions for the outdoor leg.
                      </p>
                    )}
                    <div className="route-floors">
                      {floors
                        .filter((f) => routeOnFloor(route, f).length > 0)
                        .map((f) => (
                          <RouteExploreButton
                            key={f.id}
                            className={floorId === f.id ? "active" : ""}
                            onClick={() => setFloorId(f.id)}
                          >
                            <Layers3 size={12} />
                            {f.name}
                          </RouteExploreButton>
                        ))}
                    </div>
                    <WrittenRoute>
                      <ol className="route-steps">
                        {route.steps.map((step, i) => (
                          <li key={`${i}:${step}`}>
                            <button
                              className={activeStep === i ? "active" : ""}
                              onClick={() => setActiveStep(i)}
                            >
                              <span>{String(i + 1).padStart(2, "0")}</span>
                              <p>{step}</p>
                              {activeStep === i && <Navigation size={14} />}
                            </button>
                          </li>
                        ))}
                      </ol>
                    </WrittenRoute>
                    <span className="route-note">
                      Directions from the building agent · preview does not
                      track your physical location
                    </span>
                  </motion.section>
                )}
              </AnimatePresence>
              <footer className="workspace-footer" inert={expandedMap}>
                <span>
                  <Compass size={13} />A building becomes a place when you know
                  your way.
                </span>
                <span>Made with care · Team Simran</span>
              </footer>
            </main>
          </div>
          <AnimatePresence>
            {notice && !panel && (
              <motion.div
                className="notice"
                role="status"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
              >
                <Info size={18} />
                <p>{notice}</p>
                <button
                  aria-label="Dismiss notice"
                  onClick={() => setNotice("")}
                >
                  <X size={17} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <ExplorerSheet
            panel={panel}
            close={() => setPanel(null)}
            data={data}
            layers={layers}
            setLayers={setLayers}
            avatar={avatar}
            setAvatar={setAvatar}
            upload={upload}
            onCreated={created}
            notice={notice}
          />
        </div>
      </RoutePlaybackProvider>
    </MotionConfig>
  );
}
