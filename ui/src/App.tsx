import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import type {
  BuildingData,
  Space,
  Opening,
  Asset,
  RouteAction,
  ChatResponse,
  ChatMessage,
  ChatAction,
} from './types';
import { parseFootprint } from './types';
import './App.css';

const SERVER_URL = 'http://localhost:8000';

function getSessionId(): string {
  let sid = sessionStorage.getItem('building_agent_session_id');
  if (!sid) {
    sid = 'sess_' + Math.random().toString(36).substring(2, 11);
    sessionStorage.setItem('building_agent_session_id', sid);
  }
  return sid;
}

interface ServerBuildingSummary {
  id: string;
  name: string;
  source: string;
  floors?: { level: number; name: string }[];
}

// Polygon Centroid and Area calculation using Shoelace formula
function getPolygonMetrics(points: [number, number][]): { centroid: [number, number]; area: number } {
  let areaSum = 0;
  let cx = 0;
  let cy = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    areaSum += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  const signedArea = areaSum / 2;
  const area = Math.abs(signedArea);

  if (Math.abs(signedArea) < 1e-6) {
    const avgX = points.reduce((acc, p) => acc + p[0], 0) / n;
    const avgY = points.reduce((acc, p) => acc + p[1], 0) / n;
    return { centroid: [avgX, avgY], area: 0 };
  }

  return {
    centroid: [cx / (6 * signedArea), cy / (6 * signedArea)],
    area,
  };
}

// 5-Pointed Star Points Generator for Route End Marker
function getStarPoints(cx: number, cy: number, spikes = 5, outerR = 1.2, innerR = 0.55): string {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  const pts: string[] = [];
  for (let i = 0; i < spikes; i++) {
    let x = cx + Math.cos(rot) * outerR;
    let y = cy + Math.sin(rot) * outerR;
    pts.push(`${x},${y}`);
    rot += step;
    x = cx + Math.cos(rot) * innerR;
    y = cy + Math.sin(rot) * innerR;
    pts.push(`${x},${y}`);
    rot += step;
  }
  return pts.join(' ');
}

interface PresetBuilding {
  id: string;
  name: string;
  badge: string;
  file: string;
}

const PRESET_BUILDINGS: PresetBuilding[] = [
  {
    id: 'proc-factory-dev-003',
    name: 'Fertigung Ost 27',
    badge: 'Procedural Factory',
    file: '/buildings/proc-factory-dev-003.json',
  },
  {
    id: 'proc-campus-dev-000',
    name: 'Hörsaalzentrum 024',
    badge: '5-Floor Campus',
    file: '/buildings/proc-campus-dev-000.json',
  },
  {
    id: 'swiss-1689',
    name: 'Swiss 1689',
    badge: 'Rotated Rooms',
    file: '/buildings/swiss-1689.json',
  },
  {
    id: 'osm-way360544293',
    name: 'Terminal 2 (Munich)',
    badge: 'OSM 130-pt Polygon',
    file: '/buildings/osm-way360544293.json',
  },
  {
    id: 'resplan-1465',
    name: 'Residence 1465',
    badge: 'ResPlan Home',
    file: '/buildings/resplan-1465.json',
  },
];

interface MockOption {
  id: string;
  label: string;
  file: string;
  prompt: string;
}

const MOCK_OPTIONS: MockOption[] = [
  {
    id: 'chat_route',
    label: 'Route: H-A1 → Office 1.11',
    file: '/mock/chat_route.json',
    prompt: 'Route from Production zone H-A1 to Office 1.11',
  },
  {
    id: 'chat_clarify',
    label: 'Clarification Needed',
    file: '/mock/chat_clarify.json',
    prompt: 'Where is the office?',
  },
  {
    id: 'chat_closed',
    label: 'Close Staircase 0.17',
    file: '/mock/chat_closed.json',
    prompt: 'Staircase 0.17 is closed for maintenance',
  },
  {
    id: 'chat_highlight',
    label: 'Highlight CNC Mill',
    file: '/mock/chat_highlight.json',
    prompt: 'Where is the cnc mill?',
  },
  {
    id: 'chat_door_added',
    label: 'Add Door H-A2 ↔ 0.20',
    file: '/mock/chat_door_added.json',
    prompt: 'Add a door between Assembly zone H-A2 and Hall access 0.20',
  },
];

type HoveredEntity =
  | { kind: 'space'; space: Space; area: number }
  | { kind: 'asset'; asset: Asset; dimensions?: string }
  | { kind: 'door'; opening: Opening; connectedRefs: string[] }
  | { kind: 'entrance'; opening: Opening };

export default function App() {
  const [data, setData] = useState<BuildingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live Server Status (Step 7)
  const [serverOnline, setServerOnline] = useState<boolean>(false);
  const [serverBuildings, setServerBuildings] = useState<ServerBuildingSummary[]>([]);

  // Active Building Selection
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('proc-factory-dev-003');

  // Active Floor Selection
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');

  // Hover state
  const [hoveredEntity, setHoveredEntity] = useState<HoveredEntity | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Layer Toggles
  const [showLabels, setShowLabels] = useState(true);
  const [showDoors, setShowDoors] = useState(true);
  const [showAssets, setShowAssets] = useState(true);
  const [showRoute, setShowRoute] = useState(true);

  // Route State (Step 5)
  const [activeRoute, setActiveRoute] = useState<RouteAction | null>(null);
  const [routeUnderstood, setRouteUnderstood] = useState<string | null>(null);
  const [showRoutePanel, setShowRoutePanel] = useState<boolean>(true);

  // Action States (Step 6)
  const [highlightedSpaceIds, setHighlightedSpaceIds] = useState<Set<string>>(new Set());
  const [highlightedAssetIds, setHighlightedAssetIds] = useState<Set<string>>(new Set());
  const [closedElementIds, setClosedElementIds] = useState<Set<string>>(new Set());
  const [addedDoors, setAddedDoors] = useState<Opening[]>([]);

  // Chat Panel State (Step 6)
  const [chatMinimized, setChatMinimized] = useState(false);
  const [inputQuery, setInputQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-init',
      sender: 'agent',
      text: 'Hello! I am your indoor assistant. Ask me for routes, room locations, or building closures.',
      timestamp: '12:00',
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Voice Controls State (Step 9)
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const recognitionRef = useRef<any>(null);

  // Polish State (Step 10: 3D Isometric View & Navigation Step Walkthrough)
  const [isIsometric, setIsIsometric] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [isPlayingNav, setIsPlayingNav] = useState(false);

  // Pan and Zoom State
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number }>({
    clientX: 0,
    clientY: 0,
    panX: 0,
    panY: 0,
  });

  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll chat to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Execute chat actions in UI
  const applyActions = useCallback((actions: ChatAction[]) => {
    for (const act of actions) {
      if (act.type === 'route') {
        setActiveRoute(act);
        setShowRoute(true);
        setShowRoutePanel(true);
      } else if (act.type === 'highlight') {
        if (act.space_ids && act.space_ids.length > 0) {
          setHighlightedSpaceIds(new Set(act.space_ids));
        }
        if (act.asset_ids && act.asset_ids.length > 0) {
          setHighlightedAssetIds(new Set(act.asset_ids));
        }
      } else if (act.type === 'closed') {
        setClosedElementIds((prev) => {
          const next = new Set(prev);
          for (const id of act.element_ids) {
            next.add(id);
          }
          return next;
        });
      } else if (act.type === 'door_added') {
        setAddedDoors((prev) => [...prev, act.opening]);
      }
    }
  }, []);

  // Check Live Server Connection (Step 7)
  const checkServer = useCallback(() => {
    fetch(`${SERVER_URL}/buildings`)
      .then((res) => {
        if (!res.ok) throw new Error('Live server unreachable');
        return res.json();
      })
      .then((bList: ServerBuildingSummary[]) => {
        setServerOnline(true);
        if (Array.isArray(bList) && bList.length > 0) {
          setServerBuildings(bList);
        }
      })
      .catch(() => {
        setServerOnline(false);
      });
  }, []);

  useEffect(() => {
    checkServer();
    const timer = setInterval(checkServer, 10000);
    return () => clearInterval(timer);
  }, [checkServer]);

  // Load building by ID or URL (Step 7: GET /buildings/{id} replaces static files when online)
  const loadBuilding = useCallback(
    (buildingId: string) => {
      setLoading(true);
      setError(null);

      const fetchPromise = serverOnline
        ? fetch(`${SERVER_URL}/buildings/${buildingId}`)
            .then((res) => {
              if (!res.ok) throw new Error('Live server building fetch error');
              return res.json();
            })
            .catch(() => {
              const preset = PRESET_BUILDINGS.find((b) => b.id === buildingId);
              const targetFile = preset ? preset.file : `/buildings/${buildingId}.json`;
              return fetch(targetFile).then((r) => r.json());
            })
        : (() => {
            const preset = PRESET_BUILDINGS.find((b) => b.id === buildingId);
            const targetFile = preset ? preset.file : `/buildings/${buildingId}.json`;
            return fetch(targetFile)
              .then((r) => {
                if (!r.ok) return fetch('/sample.json');
                return r;
              })
              .then((r) => r.json());
          })();

      fetchPromise
        .then((json: BuildingData) => {
          setData(json);
          setSelectedBuildingId(buildingId);
          const ground = json.floors.find((f) => f.level === 0) || json.floors[0];
          if (ground) {
            setSelectedFloorId(ground.id);
          }
          setZoom(1.0);
          setPan({ x: 0, y: 0 });
          setHighlightedSpaceIds(new Set());
          setHighlightedAssetIds(new Set());
          setClosedElementIds(new Set());
          setAddedDoors([]);
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message || 'Error loading building data');
          setLoading(false);
        });
    },
    [serverOnline]
  );

  // Initial load
  useEffect(() => {
    loadBuilding('proc-factory-dev-003');
  }, [loadBuilding]);

  // Step 9: Text-to-Speech (TTS)
  const speakText = useCallback(
    async (text: string) => {
      if (!text || !ttsEnabled) return;
      // Strip markdown syntax for natural voice reading
      const cleanText = text.replace(/[*_#`[\]()]/g, '').trim();
      if (!cleanText) return;

      // Try Backend /tts if live server is reachable
      if (serverOnline) {
        try {
          const resp = await fetch(`${SERVER_URL}/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: cleanText }),
          });
          if (resp.ok) {
            const blob = await resp.blob();
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            await audio.play();
            return;
          }
        } catch (e) {
          console.warn('Backend /tts request failed, falling back to Web Speech Synthesis:', e);
        }
      }

      // Fallback to browser Web Speech API SpeechSynthesis
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.lang = 'en-US';
        window.speechSynthesis.speak(utterance);
      }
    },
    [serverOnline, ttsEnabled]
  );

  // Fallback Mock Dispatcher
  const fallbackMockDispatch = useCallback(
    (text: string) => {
      const lower = text.toLowerCase();
      let mockFile = '/mock/chat_route.json';
      if (
        lower.includes('close') ||
        lower.includes('shut') ||
        lower.includes('broken') ||
        lower.includes('reopen') ||
        lower.includes('open')
      ) {
        // Match specific space or door in current building
        const targetSpace = data?.spaces?.find(
          (s) =>
            (s.name && lower.includes(s.name.toLowerCase())) ||
            (s.ref && lower.includes(s.ref.toLowerCase())) ||
            lower.includes(s.id.toLowerCase())
        );
        const targetDoor = data?.openings?.find(
          (o) =>
            (o.name && lower.includes(o.name.toLowerCase())) ||
            lower.includes(o.id.toLowerCase())
        );
        const matched = targetSpace || targetDoor;

        if (matched) {
          const isReopen =
            (lower.includes('open') || lower.includes('reopen')) &&
            !lower.includes('close') &&
            !lower.includes('shut');
          const matchedName =
            matched.name || ('ref' in matched ? (matched as any).ref : matched.id);

          if (isReopen) {
            setClosedElementIds((prev) => {
              const next = new Set(prev);
              next.delete(matched.id);
              return next;
            });
            const res: ChatResponse = {
              reply: `${matchedName} is now reopened and back in service.`,
              understood: `${matchedName} reopened`,
              needs_clarification: false,
              actions: [],
            };
            const agentMsg: ChatMessage = {
              id: `agent-${Date.now()}`,
              sender: 'agent',
              text: res.reply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              response: res,
            };
            setMessages((prev) => [...prev, agentMsg]);
            if (res.understood) setRouteUnderstood(res.understood);
            speakText(res.reply);
            return;
          } else {
            setClosedElementIds((prev) => {
              const next = new Set(prev);
              next.add(matched.id);
              return next;
            });
            const res: ChatResponse = {
              reply: `${matchedName} is now marked as closed. Route recalculations will redirect traffic away from it.`,
              understood: `${matchedName} closed for maintenance`,
              needs_clarification: false,
              actions: [
                {
                  type: 'closed',
                  element_ids: [matched.id],
                },
              ],
            };
            const agentMsg: ChatMessage = {
              id: `agent-${Date.now()}`,
              sender: 'agent',
              text: res.reply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              response: res,
            };
            setMessages((prev) => [...prev, agentMsg]);
            if (res.understood) setRouteUnderstood(res.understood);
            speakText(res.reply);
            return;
          }
        } else {
          mockFile = '/mock/chat_closed.json';
        }
      } else if (
        lower.includes('printer') ||
        lower.includes('coffee') ||
        lower.includes('toilet') ||
        lower.includes('restroom') ||
        lower.includes('bathroom') ||
        lower.includes('cnc') ||
        lower.includes('mill') ||
        lower.includes('waterjet')
      ) {
        // Smart Nearest Asset Navigation & Highlight
        let searchTerm = 'printer';
        if (lower.includes('coffee')) searchTerm = 'coffee';
        else if (lower.includes('cnc') || lower.includes('mill')) searchTerm = 'cnc';
        else if (
          lower.includes('toilet') ||
          lower.includes('restroom') ||
          lower.includes('bathroom')
        )
          searchTerm = 'toilet';
        else if (lower.includes('waterjet')) searchTerm = 'waterjet';

        const matchedAsset = data?.assets?.find((a) => {
          const t = (a.type || '').toLowerCase();
          const n = (a.name || '').toLowerCase();
          const c = (a.category || '').toLowerCase();
          return t.includes(searchTerm) || n.includes(searchTerm) || c.includes(searchTerm);
        });

        if (matchedAsset) {
          const assetRoom = data?.spaces?.find((s) => s.id === matchedAsset.space_id);
          const roomName = assetRoom ? assetRoom.name || assetRoom.ref : 'designated area';
          const assetFloor = data?.floors?.find((f) => f.id === matchedAsset.floor_id);
          const floorName = assetFloor ? assetFloor.name : 'Ground floor';
          const floorLvl = assetFloor ? String(assetFloor.level) : '0';

          const isRouteQuery =
            lower.includes('route') ||
            lower.includes('navigate') ||
            lower.includes('nearest') ||
            lower.includes('how to get') ||
            lower.includes('take me') ||
            lower.includes('way to');

          if (isRouteQuery) {
            if (matchedAsset.floor_id && selectedFloorId !== matchedAsset.floor_id) {
              setSelectedFloorId(matchedAsset.floor_id);
            }

            const startPt: [number, number] = [-7.25, 8.55];
            const destPt: [number, number] = [
              matchedAsset.position[0],
              matchedAsset.position[1],
            ];
            const midPt1: [number, number] = [-7.25, (startPt[1] + destPt[1]) / 2];
            const midPt2: [number, number] = [destPt[0], (startPt[1] + destPt[1]) / 2];

            const dx = destPt[0] - startPt[0];
            const dy = destPt[1] - startPt[1];
            const approxDist = Math.max(
              Math.round(Math.sqrt(dx * dx + dy * dy) * 1.25),
              18
            );

            const prettyType = (matchedAsset.type || 'equipment').replace(/_/g, ' ');
            const res: ChatResponse = {
              reply: `The nearest ${prettyType} is ${matchedAsset.name} in ${roomName} on ${floorName} (${approxDist} m away). Here is the fastest route to it.`,
              understood: `Route to nearest ${prettyType}: ${matchedAsset.name} in ${roomName}`,
              needs_clarification: false,
              actions: [
                {
                  type: 'highlight',
                  space_ids: assetRoom ? [assetRoom.id] : [],
                  asset_ids: [matchedAsset.id],
                },
                {
                  type: 'route',
                  length_m: approxDist,
                  steps: [
                    `Start in Production zone H-A1 on ${floorName}.`,
                    `Follow the central aisle toward ${roomName}.`,
                    `Enter ${roomName} through the doorway.`,
                    `Arrive at ${matchedAsset.name}.`,
                  ],
                  floors: {
                    [floorLvl]: [startPt, midPt1, midPt2, destPt],
                  },
                },
              ],
            };

            const agentMsg: ChatMessage = {
              id: `agent-${Date.now()}`,
              sender: 'agent',
              text: res.reply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              response: res,
            };
            setMessages((prev) => [...prev, agentMsg]);
            if (res.understood) setRouteUnderstood(res.understood);
            applyActions(res.actions);
            speakText(res.reply);
            return;
          } else {
            // Locate / Highlight without route
            if (matchedAsset.floor_id && selectedFloorId !== matchedAsset.floor_id) {
              setSelectedFloorId(matchedAsset.floor_id);
            }
            const prettyType = (matchedAsset.type || 'equipment').replace(/_/g, ' ');
            const res: ChatResponse = {
              reply: `${matchedAsset.name} (${prettyType}) is located in ${roomName} on ${floorName}. I have highlighted it on the map for you.`,
              understood: `Locating ${matchedAsset.name} in ${roomName}`,
              needs_clarification: false,
              actions: [
                {
                  type: 'highlight',
                  space_ids: assetRoom ? [assetRoom.id] : [],
                  asset_ids: [matchedAsset.id],
                },
              ],
            };
            const agentMsg: ChatMessage = {
              id: `agent-${Date.now()}`,
              sender: 'agent',
              text: res.reply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              response: res,
            };
            setMessages((prev) => [...prev, agentMsg]);
            if (res.understood) setRouteUnderstood(res.understood);
            applyActions(res.actions);
            speakText(res.reply);
            return;
          }
        }
        mockFile = '/mock/chat_highlight.json';
      } else if (
        lower.includes('where') ||
        lower.includes('find')
      ) {
        mockFile = '/mock/chat_highlight.json';
      } else if (lower.includes('door') || lower.includes('add') || lower.includes('wall')) {
        mockFile = '/mock/chat_door_added.json';
      } else if (lower.includes('?') || lower.includes('office')) {
        mockFile = '/mock/chat_clarify.json';
      }

      fetch(mockFile)
        .then((res) => res.json())
        .then((res: ChatResponse) => {
          const agentMsg: ChatMessage = {
            id: `agent-${Date.now()}`,
            sender: 'agent',
            text: res.reply,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            response: res,
          };
          setMessages((prev) => [...prev, agentMsg]);
          if (res.understood) setRouteUnderstood(res.understood);
          applyActions(res.actions);
          speakText(res.reply);
        })
        .catch((err) => console.error('Error fetching mock response:', err));
    },
    [data, applyActions, speakText]
  );

  // Pick a mock response from dropdown or quick chips
  const handleSelectMock = useCallback(
    (mockId: string) => {
      const opt = MOCK_OPTIONS.find((m) => m.id === mockId);
      if (!opt) return;

      fetch(opt.file)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load mock`);
          return res.json();
        })
        .then((res: ChatResponse) => {
          const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const userMsg: ChatMessage = {
            id: `user-${Date.now()}`,
            sender: 'user',
            text: opt.prompt,
            timestamp: time,
          };
          const agentMsg: ChatMessage = {
            id: `agent-${Date.now()}`,
            sender: 'agent',
            text: res.reply,
            timestamp: time,
            response: res,
          };
          setMessages((prev) => [...prev, userMsg, agentMsg]);
          if (res.understood) setRouteUnderstood(res.understood);
          applyActions(res.actions);
          speakText(res.reply);
        })
        .catch((err) => console.error('Error applying mock:', err));
    },
    [applyActions, speakText]
  );

  // Send message on Enter, click, or voice (Step 7 & 9)
  const handleSendMessage = useCallback(
    (overrideText?: string) => {
      const rawText = typeof overrideText === 'string' ? overrideText : inputQuery;
      if (!rawText.trim()) return;
      const text = rawText.trim();
      setInputQuery('');

      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text,
        timestamp: time,
      };
      setMessages((prev) => [...prev, userMsg]);

      if (serverOnline) {
        fetch(`${SERVER_URL}/buildings/${selectedBuildingId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: getSessionId(),
            message: text,
          }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((res: ChatResponse) => {
            const agentMsg: ChatMessage = {
              id: `agent-${Date.now()}`,
              sender: 'agent',
              text: res.reply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              response: res,
            };
            setMessages((prev) => [...prev, agentMsg]);
            if (res.understood) setRouteUnderstood(res.understood);
            applyActions(res.actions);
            speakText(res.reply);
          })
          .catch((err) => {
            console.warn('Live chat failed, using fallback mock dispatch:', err);
            fallbackMockDispatch(text);
          });
      } else {
        fallbackMockDispatch(text);
      }
    },
    [inputQuery, serverOnline, selectedBuildingId, applyActions, fallbackMockDispatch, speakText]
  );

  // Step 9: Web Speech API Recognition (STT Microphone)
  const toggleListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert(
        'Speech Recognition is not supported by your current browser. Please use Google Chrome or Microsoft Edge.'
      );
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setInputQuery(transcript);
          handleSendMessage(transcript);
        }
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to initialize speech recognition:', err);
      setIsListening(false);
    }
  }, [isListening, handleSendMessage]);

  // Step 10: Click a lift, stair, space, or door to toggle closed (sends "Lift 1 is closed" to chat)
  const handleToggleElementClosure = useCallback(
    (id: string, label: string, isCurrentlyClosed: boolean) => {
      const nextClosed = !isCurrentlyClosed;
      const msg = nextClosed
        ? `${label} is closed for maintenance`
        : `${label} is now open`;

      setClosedElementIds((prev) => {
        const copy = new Set(prev);
        if (nextClosed) {
          copy.add(id);
        } else {
          copy.delete(id);
        }
        return copy;
      });

      handleSendMessage(msg);
    },
    [handleSendMessage]
  );

  // Handle Custom File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text) as BuildingData;
        if (!parsed.building || !parsed.spaces || !parsed.floors) {
          throw new Error('Invalid building schema: missing building, spaces, or floors');
        }
        setData(parsed);
        setSelectedBuildingId(parsed.building.id);
        const ground = parsed.floors.find((f) => f.level === 0) || parsed.floors[0];
        if (ground) {
          setSelectedFloorId(ground.id);
        }
        setZoom(1.0);
        setPan({ x: 0, y: 0 });
        setActiveRoute(null);
        setHighlightedSpaceIds(new Set());
        setHighlightedAssetIds(new Set());
        setClosedElementIds(new Set());
        setAddedDoors([]);
        setLoading(false);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Failed to parse uploaded building: ${message}`);
        setLoading(false);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Sorted Floors by level ascending
  const sortedFloors = useMemo(() => {
    if (!data?.floors) return [];
    return [...data.floors].sort((a, b) => a.level - b.level);
  }, [data]);

  // Current Floor
  const currentFloor = useMemo(() => {
    if (!data?.floors) return null;
    return data.floors.find((f) => f.id === selectedFloorId) || sortedFloors[0] || null;
  }, [data, selectedFloorId, sortedFloors]);

  // Spaces for current floor
  const currentSpaces = useMemo(() => {
    if (!data || !currentFloor) return [];
    return data.spaces.filter((s) => s.floor_id === currentFloor.id);
  }, [data, currentFloor]);

  // Map of space_id -> ref/name for fast door label lookups
  const spaceMap = useMemo(() => {
    const map = new Map<string, Space>();
    if (data?.spaces) {
      for (const s of data.spaces) {
        map.set(s.id, s);
      }
    }
    return map;
  }, [data]);

  // Openings on current floor
  const currentOpenings = useMemo(() => {
    if (!data?.openings || !currentFloor) return [];
    return data.openings.filter((o) => o.floor_id === currentFloor.id);
  }, [data, currentFloor]);

  const { doors, entrances } = useMemo(() => {
    const d: Opening[] = [];
    const e: Opening[] = [];
    for (const op of currentOpenings) {
      if (op.kind === 'entrance' || op.space_ids.includes('outside')) {
        e.push(op);
      } else {
        d.push(op);
      }
    }
    return { doors: d, entrances: e };
  }, [currentOpenings]);

  // Added doors on current floor
  const currentAddedDoors = useMemo(() => {
    if (!currentFloor) return [];
    return addedDoors.filter((d) => d.floor_id === currentFloor.id);
  }, [addedDoors, currentFloor]);

  // Assets on current floor
  const currentAssets = useMemo(() => {
    if (!data?.assets || !currentFloor) return [];
    return data.assets.filter((a) => a.floor_id === currentFloor.id);
  }, [data, currentFloor]);

  // Compute Bounding Box across all spaces on current floor
  const bounds = useMemo(() => {
    if (currentSpaces.length === 0) {
      if (data?.spaces && data.spaces.length > 0) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const space of data.spaces) {
          for (const [x, y] of space.polygon) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        return {
          minX,
          maxX,
          minY,
          maxY,
          width: Math.max(maxX - minX, 1),
          height: Math.max(maxY - minY, 1),
        };
      }
      return { minX: 0, maxX: 100, minY: 0, maxY: 100, width: 100, height: 100 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const space of currentSpaces) {
      for (const [x, y] of space.polygon) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    return {
      minX,
      maxX,
      minY,
      maxY,
      width: Math.max(maxX - minX, 1),
      height: Math.max(maxY - minY, 1),
    };
  }, [currentSpaces, data]);

  // Reset Pan/Zoom whenever floor changes
  useEffect(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    setHoveredEntity(null);
  }, [selectedFloorId]);

  // Dynamic metrics for scaling lines, dots, triangles, and fonts
  const buildingScale = useMemo(() => {
    return Math.max(bounds.width, bounds.height);
  }, [bounds]);

  const strokeWidth = useMemo(() => {
    return Math.max(buildingScale * 0.0025, 0.15);
  }, [buildingScale]);

  const baseFontSize = useMemo(() => {
    return Math.max(buildingScale * 0.012, 0.85);
  }, [buildingScale]);

  const doorRadius = useMemo(() => {
    return Math.max(buildingScale * 0.0055, 0.35);
  }, [buildingScale]);

  const entranceSize = useMemo(() => {
    return Math.max(buildingScale * 0.014, 1.1);
  }, [buildingScale]);

  // Base ViewBox with 4% padding
  const baseViewBoxMetrics = useMemo(() => {
    const pad = Math.max(bounds.width, bounds.height) * 0.04;
    const baseW = bounds.width + 2 * pad;
    const baseH = bounds.height + 2 * pad;
    const baseCenterX = bounds.minX + bounds.width / 2;
    const baseCenterY = bounds.minY + bounds.height / 2;
    return { baseW, baseH, baseCenterX, baseCenterY };
  }, [bounds]);

  // Current viewBox based on zoom and pan
  const viewBoxStr = useMemo(() => {
    const { baseW, baseH, baseCenterX, baseCenterY } = baseViewBoxMetrics;
    const currentW = baseW / zoom;
    const currentH = baseH / zoom;
    const currentVx = (baseCenterX + pan.x) - currentW / 2;
    const currentVy = (baseCenterY + pan.y) - currentH / 2;
    return `${currentVx} ${currentVy} ${currentW} ${currentH}`;
  }, [baseViewBoxMetrics, zoom, pan]);

  // Route points on the currently displayed floor
  const currentFloorRoute = useMemo(() => {
    if (!activeRoute || !currentFloor) return null;
    const levelKey = String(currentFloor.level);
    const rawPoints = activeRoute.floors[levelKey];
    if (!rawPoints || rawPoints.length < 2) return null;

    const flippedPoints = rawPoints.map(([x, y]) => [x, bounds.maxY + bounds.minY - y] as [number, number]);
    const pointsStr = flippedPoints.map(([x, y]) => `${x},${y}`).join(' ');

    const floorLevels = Object.keys(activeRoute.floors);
    const isGlobalStartFloor = levelKey === floorLevels[0];
    const isGlobalEndFloor = levelKey === floorLevels[floorLevels.length - 1];

    const startPoint = flippedPoints[0];
    const endPoint = flippedPoints[flippedPoints.length - 1];

    return {
      pointsStr,
      flippedPoints,
      isGlobalStartFloor,
      isGlobalEndFloor,
      startPoint,
      endPoint,
    };
  }, [activeRoute, currentFloor, bounds]);

  // Route floor keys sorted
  const routeFloorKeys = useMemo(() => {
    if (!activeRoute?.floors) return [];
    return Object.keys(activeRoute.floors).sort((a, b) => Number(a) - Number(b));
  }, [activeRoute]);

  // Step 10: Reset nav step player when route or building changes
  useEffect(() => {
    setActiveStepIndex(null);
    setIsPlayingNav(false);
  }, [activeRoute, selectedBuildingId]);

  // Step 10: Step-by-Step Navigation Player Timer
  useEffect(() => {
    if (!isPlayingNav || !activeRoute || !activeRoute.steps || activeRoute.steps.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      setActiveStepIndex((prev) => {
        const next = prev === null ? 0 : prev + 1;
        if (next >= activeRoute.steps.length) {
          setIsPlayingNav(false);
          return prev;
        }
        return next;
      });
    }, 2400);

    return () => clearInterval(interval);
  }, [isPlayingNav, activeRoute]);

  // Step 10: Highlight room/corridor for the current route step
  const navHighlightedSpaceIds = useMemo(() => {
    if (activeStepIndex === null || !activeRoute || !activeRoute.steps) {
      return new Set<string>();
    }
    const currentStepText = activeRoute.steps[activeStepIndex] || '';
    const lower = currentStepText.toLowerCase();

    const ids = new Set<string>();
    for (const space of currentSpaces) {
      const ref = (space.ref || '').toLowerCase();
      const name = (space.name || '').toLowerCase();
      const id = space.id.toLowerCase();

      if (
        (ref && ref.length >= 2 && lower.includes(ref)) ||
        (name && name.length >= 3 && lower.includes(name)) ||
        (id && lower.includes(id))
      ) {
        ids.add(space.id);
      }
    }
    return ids;
  }, [activeStepIndex, activeRoute, currentSpaces]);

  // Step 10: Auto-switch floor when navigation step reaches a different floor
  useEffect(() => {
    if (activeStepIndex === null || !activeRoute || !activeRoute.steps) return;
    const currentStepText = activeRoute.steps[activeStepIndex] || '';
    const lower = currentStepText.toLowerCase();

    for (const floor of sortedFloors) {
      const flName = floor.name.toLowerCase();
      const flLvl = `floor ${floor.level}`;
      const lvlLvl = `level ${floor.level}`;
      if (
        (lower.includes(flLvl) || lower.includes(lvlLvl) || lower.includes(flName)) &&
        selectedFloorId !== floor.id
      ) {
        setSelectedFloorId(floor.id);
        break;
      }
    }
  }, [activeStepIndex, activeRoute, sortedFloors, selectedFloorId]);

  // Pan and Zoom Event Handlers
  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mouseRatioX = (e.clientX - rect.left) / rect.width;
      const mouseRatioY = (e.clientY - rect.top) / rect.height;

      const { baseW, baseH, baseCenterX, baseCenterY } = baseViewBoxMetrics;
      const currentW = baseW / zoom;
      const currentH = baseH / zoom;
      const currentVx = (baseCenterX + pan.x) - currentW / 2;
      const currentVy = (baseCenterY + pan.y) - currentH / 2;

      const mouseSvgX = currentVx + mouseRatioX * currentW;
      const mouseSvgY = currentVy + mouseRatioY * currentH;

      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const nextZoom = Math.min(Math.max(zoom * factor, 0.2), 50);

      const nextW = baseW / nextZoom;
      const nextH = baseH / nextZoom;

      const nextVx = mouseSvgX - mouseRatioX * nextW;
      const nextVy = mouseSvgY - mouseRatioY * nextH;

      const nextPanX = (nextVx + nextW / 2) - baseCenterX;
      const nextPanY = (nextVy + nextH / 2) - baseCenterY;

      setZoom(nextZoom);
      setPan({ x: nextPanX, y: nextPanY });
    },
    [baseViewBoxMetrics, zoom, pan]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }, [pan]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (hoveredEntity) {
        setTooltipPos({ x: e.clientX, y: e.clientY });
      }
      if (!isDragging || !svgRef.current) return;

      const rect = svgRef.current.getBoundingClientRect();
      const { baseW, baseH } = baseViewBoxMetrics;
      const currentW = baseW / zoom;
      const currentH = baseH / zoom;

      const dxScreen = e.clientX - dragStartRef.current.clientX;
      const dyScreen = e.clientY - dragStartRef.current.clientY;

      const dxSvg = dxScreen * (currentW / rect.width);
      const dySvg = dyScreen * (currentH / rect.height);

      setPan({
        x: dragStartRef.current.panX - dxSvg,
        y: dragStartRef.current.panY - dySvg,
      });
    },
    [isDragging, hoveredEntity, baseViewBoxMetrics, zoom]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleResetView = useCallback(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z * 1.3, 50));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z / 1.3, 0.2));
  }, []);

  if (loading) {
    return (
      <div className="state-container">
        <div className="spinner"></div>
        <p>Loading building floor plan...</p>
      </div>
    );
  }

  if (error || !data || !currentFloor) {
    return (
      <div className="state-container">
        <p style={{ color: '#ef4444' }}>Error: {error || 'No floors found'}</p>
        <button
          type="button"
          onClick={() => loadBuilding('proc-factory-dev-003')}
          style={{
            marginTop: '12px',
            padding: '8px 16px',
            background: '#3b82f6',
            color: '#fff',
            borderRadius: '6px',
          }}
        >
          Load Default Building
        </button>
      </div>
    );
  }

  return (
    <div className="app-container" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      {/* Top Navigation Bar */}
      <header className="app-header">
        <div className="header-left">
          <div className="brand-badge">
            <svg className="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Talk to Your Building
          </div>

          {/* Connection Status Pill (Live Server vs Mock Mode) */}
          <div
            className={`connection-status-pill ${serverOnline ? 'online' : 'offline'}`}
            onClick={checkServer}
            title={
              serverOnline
                ? 'Connected to live agent server on localhost:8000'
                : 'Agent server offline — Click to retry connection to localhost:8000'
            }
          >
            <span className="status-dot-pulse" />
            <span>{serverOnline ? 'Live Server (8000)' : 'Mock Mode'}</span>
          </div>

          {/* Building Selector Dropdown & File Picker */}
          <div className="building-picker-group">
            <select
              aria-label="Select Building"
              value={selectedBuildingId}
              onChange={(e) => loadBuilding(e.target.value)}
              className="building-select"
            >
              {serverOnline && serverBuildings.length > 0
                ? serverBuildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.source})
                    </option>
                  ))
                : PRESET_BUILDINGS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.badge})
                    </option>
                  ))}
              {!PRESET_BUILDINGS.some((b) => b.id === selectedBuildingId) &&
                !serverBuildings.some((b) => b.id === selectedBuildingId) && (
                  <option value={selectedBuildingId}>Custom: {data.building.name}</option>
                )}
            </select>

            {/* Custom JSON File Upload */}
            <label className="upload-file-label" title="Upload any building.json file">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="upload-file-input"
                onChange={handleFileUpload}
              />
            </label>
          </div>

          <div className="building-title-group">
            <h1 className="building-name">{data.building.name}</h1>
            <div className="building-meta">
              <span>{data.building.id}</span>
              <span>•</span>
              <span>Elevation: {currentFloor.elevation_m ?? 0}m</span>
              <span>•</span>
              <span>Height: {currentFloor.height_m ?? 3.5}m</span>
            </div>
          </div>
        </div>

        {/* Floor Selector Tabs (sorted by level) */}
        <div className="floor-tabs-container">
          {sortedFloors.map((floor) => {
            const isActive = floor.id === selectedFloorId;
            return (
              <button
                key={floor.id}
                type="button"
                className={`floor-tab ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedFloorId(floor.id)}
              >
                <span className="floor-level-pill">L{floor.level}</span>
                <span>{floor.name}</span>
              </button>
            );
          })}
        </div>

        {/* Stats on Right */}
        <div className="header-right">
          <div className="stats-pill">
            <span>Spaces:</span>
            <strong>{currentSpaces.length}</strong>
          </div>
          <div className="stats-pill">
            <span>Doors:</span>
            <strong>{doors.length + currentAddedDoors.length}</strong>
          </div>
          <div className="stats-pill">
            <span>Assets:</span>
            <strong>{currentAssets.length}</strong>
          </div>
        </div>
      </header>

      {/* Main Floor Plan Viewport */}
      <main
        ref={containerRef}
        className={`viewport-container ${isDragging ? 'is-dragging' : ''} ${isIsometric ? 'isometric-tilt' : ''}`}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
      >
        {isIsometric && currentFloor && (
          <div className="isometric-badge">
            <span>⬡ 3D Isometric BIM View</span>
            <span>• Floor {currentFloor.level} ({currentFloor.name})</span>
          </div>
        )}

        {/* Layer Toggles */}
        <div className="layer-toggles-bar">
          <button
            type="button"
            className={`layer-toggle-btn ${showLabels ? 'active' : ''}`}
            onClick={() => setShowLabels(!showLabels)}
          >
            Labels
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${showDoors ? 'active' : ''}`}
            onClick={() => setShowDoors(!showDoors)}
          >
            Doors ({doors.length + entrances.length + currentAddedDoors.length})
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${showAssets ? 'active' : ''}`}
            onClick={() => setShowAssets(!showAssets)}
          >
            Assets ({currentAssets.length})
          </button>
          {activeRoute && (
            <button
              type="button"
              className={`layer-toggle-btn ${showRoute ? 'active' : ''}`}
              onClick={() => setShowRoute(!showRoute)}
            >
              Route ({activeRoute.length_m}m)
            </button>
          )}
        </div>

        {/* Zoom & Fit Floating Controls */}
        <div className="floating-controls">
          <button type="button" className="control-btn" onClick={handleZoomIn} title="Zoom In (+)">
            +
          </button>
          <div className="zoom-indicator">{Math.round(zoom * 100)}%</div>
          <button type="button" className="control-btn" onClick={handleZoomOut} title="Zoom Out (-)">
            −
          </button>
          <div className="control-divider" />
          <button type="button" className="control-btn" onClick={handleResetView} title="Fit to View">
            ⛶
          </button>
          <div className="control-divider" />
          <button
            type="button"
            className={`control-btn ${isIsometric ? 'active' : ''}`}
            onClick={() => setIsIsometric(!isIsometric)}
            title={isIsometric ? 'Switch to 2D Plan View' : 'Switch to 3D Isometric View'}
            aria-label="Toggle 3D Isometric Mode"
          >
            {isIsometric ? '⬒ 2D' : '⬡ 3D'}
          </button>
        </div>

        {/* Route Side Panel Toggle (if route exists and panel closed) */}
        {activeRoute && !showRoutePanel && (
          <button
            type="button"
            className="route-toggle-btn"
            onClick={() => setShowRoutePanel(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Route ({activeRoute.length_m} m)
          </button>
        )}

        {/* Route Side Panel (Step 5 & 10) */}
        {activeRoute && showRoutePanel && (
          <aside className="route-panel">
            <div className="route-panel-header">
              <div className="route-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
                  <path d="M4 19l4-14 4 14" />
                  <path d="M12 5l4 14 4-14" />
                </svg>
                <span>Navigation Route</span>
                <span className="route-distance-badge">{activeRoute.length_m} m</span>
              </div>
              <button
                type="button"
                className="close-panel-btn"
                onClick={() => setShowRoutePanel(false)}
                title="Hide route panel"
              >
                ×
              </button>
            </div>

            {/* Floor Navigation Badges (e.g. "0 → 1" that switch floors) */}
            {routeFloorKeys.length > 1 && (
              <div className="route-floor-badges">
                <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>Floors:</span>
                {routeFloorKeys.map((lvl, idx) => {
                  const targetFloor = sortedFloors.find((f) => f.level === Number(lvl));
                  const isCurrent = currentFloor.level === Number(lvl);
                  return (
                    <span key={lvl} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      {idx > 0 && <span style={{ color: 'var(--text-dim)' }}>→</span>}
                      <button
                        type="button"
                        className={`route-floor-btn ${isCurrent ? 'active' : ''}`}
                        onClick={() => {
                          if (targetFloor) setSelectedFloorId(targetFloor.id);
                        }}
                      >
                        L{lvl} {targetFloor ? `(${targetFloor.name})` : ''}
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Understood Summary Chip */}
            {routeUnderstood && (
              <div className="route-understood-box">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span>{routeUnderstood}</span>
              </div>
            )}

            {/* Numbered Steps with Interactive Playback Controls */}
            {activeRoute.steps && activeRoute.steps.length > 0 && (
              <>
                <div className="route-nav-controls">
                  <button
                    type="button"
                    className="route-nav-play-btn"
                    onClick={() => {
                      if (isPlayingNav) {
                        setIsPlayingNav(false);
                      } else {
                        if (
                          activeStepIndex === null ||
                          activeStepIndex >= activeRoute.steps.length - 1
                        ) {
                          setActiveStepIndex(0);
                        }
                        setIsPlayingNav(true);
                      }
                    }}
                    title={isPlayingNav ? 'Pause Walkthrough' : 'Play Animated Walkthrough'}
                  >
                    {isPlayingNav ? '⏸ Pause' : '▶ Walkthrough'}
                  </button>

                  <div className="route-nav-arrows">
                    <button
                      type="button"
                      className="route-arrow-btn"
                      disabled={activeStepIndex === null || activeStepIndex <= 0}
                      onClick={() =>
                        setActiveStepIndex((prev) =>
                          prev !== null && prev > 0 ? prev - 1 : 0
                        )
                      }
                      title="Previous Step"
                    >
                      ◀
                    </button>
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        padding: '0 4px',
                        fontWeight: 600,
                      }}
                    >
                      {activeStepIndex !== null
                        ? `${activeStepIndex + 1}/${activeRoute.steps.length}`
                        : `0/${activeRoute.steps.length}`}
                    </span>
                    <button
                      type="button"
                      className="route-arrow-btn"
                      disabled={
                        activeStepIndex !== null &&
                        activeStepIndex >= activeRoute.steps.length - 1
                      }
                      onClick={() =>
                        setActiveStepIndex((prev) =>
                          prev === null
                            ? 0
                            : Math.min(prev + 1, activeRoute.steps.length - 1)
                        )
                      }
                      title="Next Step"
                    >
                      ▶
                    </button>
                  </div>
                </div>

                <div className="route-steps-container">
                  {activeRoute.steps.map((step, idx) => {
                    const isCurrentStep = activeStepIndex === idx;
                    return (
                      <div
                        key={idx}
                        className={`route-step-row ${isCurrentStep ? 'active' : ''}`}
                        onClick={() => {
                          setActiveStepIndex(idx);
                          setIsPlayingNav(false);
                        }}
                        title="Click to view and highlight this step on the floor plan"
                      >
                        <span className="route-step-num">{idx + 1}</span>
                        <span>{step}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </aside>
        )}

        {/* SVG Floor Plan Canvas */}
        <svg
          ref={svgRef}
          className="floor-svg"
          viewBox={viewBoxStr}
          preserveAspectRatio="xMidYMid meet"
          onWheel={handleWheel}
        >
          {/* Layer 1: Space Polygons */}
          <g id="spaces-layer">
            {currentSpaces.map((space) => {
              const flippedPointsStr = space.polygon
                .map(([x, y]) => {
                  const flippedY = bounds.maxY + bounds.minY - y;
                  return `${x},${flippedY}`;
                })
                .join(' ');

              const typeClass = `type-${space.type.toLowerCase()}`;
              const { area } = getPolygonMetrics(space.polygon);

              // Step 6, 7 & 10: Action effects, closures & walkthrough highlights
              const isClosed = closedElementIds.has(space.id);
              const isHighlighted = highlightedSpaceIds.has(space.id);
              const isStepHighlighted = navHighlightedSpaceIds.has(space.id);

              const isLift = space.type === 'lift';
              const isStair = space.type === 'stair';
              const spaceLabel =
                space.name ||
                (isLift
                  ? `Lift ${space.ref || space.id}`
                  : isStair
                  ? `Staircase ${space.ref || space.id}`
                  : space.ref
                  ? `Room ${space.ref}`
                  : `Space ${space.id}`);

              return (
                <polygon
                  key={space.id}
                  id={space.id}
                  points={flippedPointsStr}
                  className={`space-polygon ${typeClass} ${isClosed ? 'closed-space' : ''} ${
                    isHighlighted ? 'pulse-highlight' : ''
                  } ${isStepHighlighted ? 'step-highlight-space' : ''}`}
                  strokeWidth={strokeWidth}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleElementClosure(space.id, spaceLabel, isClosed);
                  }}
                  onMouseEnter={(e) => {
                    setHoveredEntity({ kind: 'space', space, area });
                    setTooltipPos({ x: e.clientX, y: e.clientY });
                  }}
                  onMouseLeave={() => {
                    setHoveredEntity(null);
                    setTooltipPos(null);
                  }}
                />
              );
            })}
          </g>

          {/* Layer 2: Assets / Furniture */}
          {showAssets && (
            <g id="assets-layer">
              {currentAssets.map((asset) => {
                const posX = asset.position[0];
                const posY = bounds.maxY + bounds.minY - asset.position[1];
                const fp = parseFootprint(asset.footprint);
                const w = fp ? fp.width_m : 1.0;
                const d = fp ? fp.depth_m : 0.8;
                const rot = fp ? -fp.rotation_deg : 0;

                let categoryClass = 'asset-default';
                const cat = (asset.category || '').toLowerCase();
                const type = (asset.type || '').toLowerCase();
                if (cat === 'furniture' || type.includes('desk') || type.includes('table') || type.includes('chair')) {
                  categoryClass = 'asset-furniture';
                } else if (cat === 'machine' || type.includes('cnc') || type.includes('mill') || type.includes('lathe')) {
                  categoryClass = 'asset-machine';
                } else if (type.includes('storage') || type.includes('cabinet') || type.includes('rack')) {
                  categoryClass = 'asset-storage';
                }

                // Step 6 & 7: Action highlight pulse on assets
                const isAssetHighlighted = highlightedAssetIds.has(asset.id);

                return (
                  <rect
                    key={asset.id}
                    id={asset.id}
                    x={-w / 2}
                    y={-d / 2}
                    width={w}
                    height={d}
                    rx={Math.min(w, d) * 0.12}
                    transform={`translate(${posX}, ${posY}) rotate(${rot})`}
                    className={`asset-rect ${categoryClass} ${isAssetHighlighted ? 'pulse-highlight' : ''}`}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHoveredEntity({
                        kind: 'asset',
                        asset,
                        dimensions: `${w.toFixed(1)}m × ${d.toFixed(1)}m`,
                      });
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => {
                      setHoveredEntity(null);
                      setTooltipPos(null);
                    }}
                  />
                );
              })}
            </g>
          )}

          {/* Layer 3: Openings (Doors, Entrances, Added Doors) */}
          {showDoors && (
            <g id="openings-layer">
              {doors.map((door) => {
                const doorX = door.position[0];
                const doorY = bounds.maxY + bounds.minY - door.position[1];
                const connectedRefs = door.space_ids
                  .map((id) => spaceMap.get(id)?.ref || spaceMap.get(id)?.name || id)
                  .filter(Boolean);

                const isDoorClosed = closedElementIds.has(door.id);
                const doorLabel =
                  door.name ||
                  (connectedRefs.length > 0
                    ? `Door between ${connectedRefs.join(' and ')}`
                    : `Door ${door.id}`);

                return (
                  <circle
                    key={door.id}
                    id={door.id}
                    cx={doorX}
                    cy={doorY}
                    r={isDoorClosed ? doorRadius * 1.3 : doorRadius}
                    className={`door-dot ${isDoorClosed ? 'closed-door' : ''}`}
                    strokeWidth={strokeWidth * 0.5}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleElementClosure(door.id, doorLabel, isDoorClosed);
                    }}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHoveredEntity({ kind: 'door', opening: door, connectedRefs });
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => {
                      setHoveredEntity(null);
                      setTooltipPos(null);
                    }}
                  />
                );
              })}

              {/* Added Doors (Step 6 & 7: new dot, green) */}
              {currentAddedDoors.map((door) => {
                const doorX = door.position[0];
                const doorY = bounds.maxY + bounds.minY - door.position[1];
                const connectedRefs = door.space_ids
                  .map((id) => spaceMap.get(id)?.ref || spaceMap.get(id)?.name || id)
                  .filter(Boolean);

                return (
                  <circle
                    key={door.id}
                    id={door.id}
                    cx={doorX}
                    cy={doorY}
                    r={doorRadius * 1.3}
                    className="added-door-dot"
                    strokeWidth={strokeWidth * 0.7}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHoveredEntity({ kind: 'door', opening: door, connectedRefs });
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => {
                      setHoveredEntity(null);
                      setTooltipPos(null);
                    }}
                  />
                );
              })}

              {/* Entrances */}
              {entrances.map((ent) => {
                const entX = ent.position[0];
                const entY = bounds.maxY + bounds.minY - ent.position[1];
                const s = entranceSize;
                const triPoints = `${entX},${entY - s} ${entX - s * 0.866},${entY + s * 0.5} ${entX + s * 0.866},${entY + s * 0.5}`;

                return (
                  <polygon
                    key={ent.id}
                    id={ent.id}
                    points={triPoints}
                    className="entrance-triangle"
                    strokeWidth={strokeWidth * 0.6}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHoveredEntity({ kind: 'entrance', opening: ent });
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => {
                      setHoveredEntity(null);
                      setTooltipPos(null);
                    }}
                  />
                );
              })}
            </g>
          )}

          {/* Layer 4: Ref Labels at Centroid */}
          {showLabels && (
            <g id="labels-layer">
              {currentSpaces.map((space) => {
                if (!space.ref) return null;

                const { centroid } = getPolygonMetrics(space.polygon);
                const labelX = centroid[0];
                const labelY = bounds.maxY + bounds.minY - centroid[1];

                const xs = space.polygon.map((p) => p[0]);
                const ys = space.polygon.map((p) => p[1]);
                const w = Math.max(...xs) - Math.min(...xs);
                const h = Math.max(...ys) - Math.min(...ys);
                const minDim = Math.min(w, h);
                const adaptiveFontSize = Math.min(baseFontSize, Math.max(minDim * 0.35, 0.45));

                return (
                  <text
                    key={`label-${space.id}`}
                    x={labelX}
                    y={labelY}
                    fontSize={adaptiveFontSize}
                    className="space-label"
                  >
                    {space.ref}
                  </text>
                );
              })}
            </g>
          )}

          {/* Layer 5: Route Layer (Step 5) */}
          {showRoute && currentFloorRoute && (
            <g id="route-layer">
              <polyline
                points={currentFloorRoute.pointsStr}
                className="route-casing"
                strokeWidth={strokeWidth * 3.8}
              />
              <polyline
                points={currentFloorRoute.pointsStr}
                className="route-core"
                strokeWidth={strokeWidth * 1.9}
              />
              {currentFloorRoute.isGlobalStartFloor && (
                <circle
                  cx={currentFloorRoute.startPoint[0]}
                  cy={currentFloorRoute.startPoint[1]}
                  r={doorRadius * 1.5}
                  className="route-start-dot"
                  strokeWidth={strokeWidth * 0.6}
                />
              )}
              {currentFloorRoute.isGlobalEndFloor && (
                <polygon
                  points={getStarPoints(
                    currentFloorRoute.endPoint[0],
                    currentFloorRoute.endPoint[1],
                    5,
                    entranceSize * 0.9,
                    entranceSize * 0.45
                  )}
                  className="route-end-star"
                  strokeWidth={strokeWidth * 0.4}
                />
              )}
            </g>
          )}
        </svg>

        {/* Dynamic Hover Tooltip */}
        {hoveredEntity && tooltipPos && (
          <div
            className="hover-tooltip"
            style={{
              left: `${tooltipPos.x}px`,
              top: `${tooltipPos.y - 12}px`,
            }}
          >
            {hoveredEntity.kind === 'space' && (
              <>
                <div className="tooltip-title">
                  <span>{hoveredEntity.space.name || hoveredEntity.space.ref}</span>
                  <span className="tooltip-badge">Ref: {hoveredEntity.space.ref}</span>
                </div>
                <div className="tooltip-meta-row">
                  <span>Type: <strong className="tooltip-highlight">{hoveredEntity.space.type}</strong></span>
                  {hoveredEntity.space.room_type && (
                    <span>({hoveredEntity.space.room_type})</span>
                  )}
                  <span>•</span>
                  <span>{hoveredEntity.area.toFixed(1)} m²</span>
                </div>
                <div style={{ marginTop: '5px', fontSize: '10px', color: closedElementIds.has(hoveredEntity.space.id) ? '#ef4444' : '#60a5fa', fontWeight: 600 }}>
                  🖱 Click to {closedElementIds.has(hoveredEntity.space.id) ? 'reopen' : 'toggle closed (maintenance)'}
                </div>
              </>
            )}

            {hoveredEntity.kind === 'asset' && (
              <>
                <div className="tooltip-title">
                  <span>{hoveredEntity.asset.name}</span>
                  <span className="tooltip-badge">{hoveredEntity.asset.category || 'Asset'}</span>
                </div>
                <div className="tooltip-meta-row">
                  <span>Type: <strong className="tooltip-highlight">{hoveredEntity.asset.type}</strong></span>
                  {hoveredEntity.dimensions && <span>• {hoveredEntity.dimensions}</span>}
                </div>
              </>
            )}

            {hoveredEntity.kind === 'door' && (
              <>
                <div className="tooltip-title">
                  <span>{hoveredEntity.opening.synthetic ? 'Added Door (New)' : 'Door'}</span>
                  <span className="tooltip-badge">{hoveredEntity.opening.step_free ? 'Step-free' : 'Step'}</span>
                </div>
                <div className="tooltip-meta-row">
                  <span>Width: <strong className="tooltip-highlight">{hoveredEntity.opening.width_m} m</strong></span>
                  {hoveredEntity.connectedRefs.length > 0 && (
                    <span>• Connects: {hoveredEntity.connectedRefs.join(' ↔ ')}</span>
                  )}
                </div>
                <div style={{ marginTop: '5px', fontSize: '10px', color: closedElementIds.has(hoveredEntity.opening.id) ? '#ef4444' : '#60a5fa', fontWeight: 600 }}>
                  🖱 Click to {closedElementIds.has(hoveredEntity.opening.id) ? 'reopen' : 'toggle closed (maintenance)'}
                </div>
              </>
            )}

            {hoveredEntity.kind === 'entrance' && (
              <>
                <div className="tooltip-title">
                  <span style={{ color: '#ef4444' }}>▲ Building Entrance</span>
                  <span className="tooltip-badge">{hoveredEntity.opening.step_free ? 'Step-free' : 'Standard'}</span>
                </div>
                <div className="tooltip-meta-row">
                  <span>Width: <strong className="tooltip-highlight">{hoveredEntity.opening.width_m} m</strong></span>
                  <span>• Main external access</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Floating Chat Panel (Step 6 & 7) */}
        <div className={`chat-panel-container ${chatMinimized ? 'minimized' : ''}`}>
          <div className="chat-header" onClick={() => chatMinimized && setChatMinimized(false)}>
            <div className="chat-title-group">
              <span className="chat-status-dot" />
              <span>Building Assistant</span>
            </div>

            {!chatMinimized && (
              <>
                <button
                  type="button"
                  className={`speaker-toggle-btn ${ttsEnabled ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTtsEnabled(!ttsEnabled);
                  }}
                  title={ttsEnabled ? 'Voice output enabled - click to mute' : 'Voice output muted - click to enable'}
                >
                  {ttsEnabled ? '🔊 Audio ON' : '🔇 Audio OFF'}
                </button>
                <select
                  aria-label="Pick Mock"
                  className="mock-selector-select"
                  onChange={(e) => {
                    if (e.target.value) handleSelectMock(e.target.value);
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Pick Mock...
                  </option>
                  {MOCK_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </>
            )}

            <div className="chat-controls-btns">
              <button
                type="button"
                className="chat-btn-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setChatMinimized(!chatMinimized);
                }}
                title={chatMinimized ? 'Expand Chat' : 'Minimize Chat'}
              >
                {chatMinimized ? '▲' : '−'}
              </button>
            </div>
          </div>

          {!chatMinimized && (
            <>
              {/* Message List */}
              <div className="chat-messages-list">
                {messages.map((msg) => (
                  <div key={msg.id} className={`chat-message-bubble ${msg.sender}`}>
                    {/* Understood chip */}
                    {msg.response?.understood && (
                      <span className="understood-chip">
                        💡 Understood: {msg.response.understood}
                      </span>
                    )}

                    {/* Clarification chip */}
                    {msg.response?.needs_clarification && (
                      <span className="clarify-chip">
                        ⚠️ Needs clarification
                      </span>
                    )}

                    <div>
                      {msg.text}
                      {msg.sender === 'agent' && (
                        <button
                          type="button"
                          className="msg-speak-btn"
                          onClick={() => speakText(msg.text)}
                          title="Read aloud"
                          aria-label="Read aloud"
                        >
                          🔊
                        </button>
                      )}
                    </div>

                    {/* Action badges */}
                    {msg.response?.actions && msg.response.actions.length > 0 && (
                      <div className="action-badges-row">
                        {msg.response.actions.map((act, actIdx) => (
                          <span
                            key={actIdx}
                            className={`action-badge ${
                              act.type === 'door_added' ? 'door' : act.type
                            }`}
                          >
                            {act.type === 'route' && `Route: ${act.length_m} m`}
                            {act.type === 'highlight' && `Highlighted elements`}
                            {act.type === 'closed' && `Closed: ${act.element_ids.length} element(s)`}
                            {act.type === 'door_added' && `New Door: ${act.opening.width_m}m`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Mock Chips */}
              <div className="quick-mocks-bar">
                {MOCK_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className="quick-mock-chip"
                    onClick={() => handleSelectMock(opt.id)}
                  >
                    {opt.label.split(':')[0]}
                  </button>
                ))}
              </div>

              {/* Chat Input Bar */}
              <div className="chat-input-bar">
                <input
                  type="text"
                  placeholder="Ask for route, room, or closures..."
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendMessage();
                  }}
                  className="chat-input"
                />
                <button
                  type="button"
                  className={`voice-mic-btn ${isListening ? 'listening' : ''}`}
                  onClick={toggleListening}
                  title={isListening ? 'Listening... click to stop' : 'Speak message (Microphone)'}
                  aria-label="Microphone input"
                >
                  {isListening ? '🛑' : '🎤'}
                </button>
                <button type="button" className="chat-send-btn" onClick={() => handleSendMessage()}>
                  Send
                </button>
              </div>
            </>
          )}
        </div>

        {/* Color & Symbol Legend */}
        <div className="legend-bar">
          <div className="legend-item">
            <span className="legend-swatch room" />
            <span>Room</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch corridor" />
            <span>Corridor</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch hall" />
            <span>Hall</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch stair" />
            <span>Stair</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch lift" />
            <span>Lift</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch outdoor" />
            <span>Outdoor</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch door" />
            <span>Door</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch entrance" />
            <span>Entrance</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch asset" />
            <span>Asset</span>
          </div>
        </div>
      </main>
    </div>
  );
}
