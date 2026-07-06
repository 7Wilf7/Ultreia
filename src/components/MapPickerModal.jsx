import { useEffect, useMemo, useRef, useState } from "react";
import { s } from "../styles";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { getCurrentLocation, hasValidCoords, reverseGeocode } from "../lib/weather";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";
import { PinIcon } from "./Icons";
import { useInstantPress } from "../hooks/useInstantPress";

const TILE_SIZE = 256;
const PRELOAD_TILE_BUFFER = 2;
const MAX_PREFETCH_TILES = 72;
const MIN_ZOOM = 12;
const MAX_ZOOM = 18;
const AMAP_REACT_SYNC_INTERVAL_MS = 90;
const MAP_PICKER_BOTTOM_OFFSET = "calc(128px + env(safe-area-inset-bottom))";
const FALLBACK_WGS = { lng: 113.2644, lat: 23.1291 }; // Guangzhou
const AMAP_LOADER_URL = "https://webapi.amap.com/loader.js";
const AMAP_MAP_STYLE = "amap://styles/normal";
const PI = Math.PI;
const EARTH_A = 6378245.0;
const EARTH_EE = 0.006693421622965943;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function validCoord(coord) {
  return hasValidCoords(coord) ? { lng: Number(coord.lng), lat: Number(coord.lat) } : null;
}

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

function wgs84ToGcj02(coord) {
  const lng = Number(coord?.lng);
  const lat = Number(coord?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || outOfChina(lng, lat)) return { lng, lat };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EARTH_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((EARTH_A * (1 - EARTH_EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (EARTH_A / sqrtMagic * Math.cos(radLat) * PI);
  return { lng: lng + dLng, lat: lat + dLat };
}

function gcj02ToWgs84(coord) {
  const lng = Number(coord?.lng);
  const lat = Number(coord?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || outOfChina(lng, lat)) return { lng, lat };
  const gcj = wgs84ToGcj02({ lng, lat });
  return { lng: lng * 2 - gcj.lng, lat: lat * 2 - gcj.lat };
}

function toMapCoord(wgs) {
  const coord = validCoord(wgs) || FALLBACK_WGS;
  return wgs84ToGcj02(coord);
}

function fromMapCoord(mapCoord) {
  const coord = validCoord(mapCoord) || FALLBACK_WGS;
  return gcj02ToWgs84(coord);
}

function lngLatToWorld(lng, lat, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin(clamp(lat, -85.05112878, 85.05112878) * PI / 180);
  return {
    x: (lng + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * PI)) * scale,
  };
}

function worldToLngLat(x, y, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = x / scale * 360 - 180;
  const n = PI - 2 * PI * y / scale;
  const lat = 180 / PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lng, lat: clamp(lat, -85.05112878, 85.05112878) };
}

function tileUrl(x, y, z) {
  const subdomain = (Math.abs(x + y) % 4) + 1;
  return `https://webrd0${subdomain}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`;
}

const warmedTileUrls = new Set();
let amapLoaderScriptPromise = null;
let amapSdkPromise = null;

function getAmapSdkConfig() {
  const env = import.meta.env || {};
  return {
    key: String(env.VITE_AMAP_JSAPI_KEY || "").trim(),
    securityJsCode: String(env.VITE_AMAP_SECURITY_JS_CODE || "").trim(),
    serviceHost: String(env.VITE_AMAP_SERVICE_HOST || "").trim(),
  };
}

function hasAmapSdkConfig() {
  const config = getAmapSdkConfig();
  return !!config.key && (!!config.securityJsCode || !!config.serviceHost);
}

function loadAmapLoaderScript() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("amap_browser_unavailable"));
  }
  if (window.AMapLoader) return Promise.resolve(window.AMapLoader);
  if (amapLoaderScriptPromise) return amapLoaderScriptPromise;

  amapLoaderScriptPromise = new Promise((resolve, reject) => {
    const existing = [...document.scripts].find(script => script.src === AMAP_LOADER_URL);
    const script = existing || document.createElement("script");
    const onLoad = () => resolve(window.AMapLoader);
    const onError = () => reject(new Error("amap_loader_failed"));
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = AMAP_LOADER_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return amapLoaderScriptPromise;
}

async function loadAmapSdk() {
  if (typeof window === "undefined") throw new Error("amap_browser_unavailable");
  if (window.AMap?.Map) return window.AMap;
  if (amapSdkPromise) return amapSdkPromise;
  const config = getAmapSdkConfig();
  if (!config.key) throw new Error("amap_key_missing");
  if (config.serviceHost) {
    window._AMapSecurityConfig = { serviceHost: config.serviceHost };
  } else if (config.securityJsCode) {
    window._AMapSecurityConfig = { securityJsCode: config.securityJsCode };
  } else {
    throw new Error("amap_security_missing");
  }
  amapSdkPromise = loadAmapLoaderScript().then((AMapLoader) => AMapLoader.load({
    key: config.key,
    version: "2.0",
    plugins: [],
  }));
  return amapSdkPromise;
}

function normalizeZoom(zoom) {
  const n = Number(zoom);
  return clamp(Number.isFinite(n) ? n : 16, MIN_ZOOM, MAX_ZOOM);
}

function tileZoomFor(zoom) {
  return clamp(Math.round(normalizeZoom(zoom)), MIN_ZOOM, MAX_ZOOM);
}

function mapTilesForView(center, size, zoom, buffer = PRELOAD_TILE_BUFFER) {
  const tileZoom = tileZoomFor(zoom);
  const centerWorld = lngLatToWorld(center.lng, center.lat, tileZoom);
  if (!size.width || !size.height) {
    return { tiles: [], centerWorld, tileZoom };
  }
  const topLeft = {
    x: centerWorld.x - size.width / 2,
    y: centerWorld.y - size.height / 2,
  };
  const minX = Math.floor(topLeft.x / TILE_SIZE) - buffer;
  const maxX = Math.floor((topLeft.x + size.width) / TILE_SIZE) + buffer;
  const minY = Math.floor(topLeft.y / TILE_SIZE) - buffer;
  const maxY = Math.floor((topLeft.y + size.height) / TILE_SIZE) + buffer;
  const tileCount = 2 ** tileZoom;
  const tiles = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      if (y < 0 || y >= tileCount) continue;
      const wrappedX = ((x % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${tileZoom}:${x}:${y}`,
        url: tileUrl(wrappedX, y, tileZoom),
        left: x * TILE_SIZE - topLeft.x,
        top: y * TILE_SIZE - topLeft.y,
      });
    }
  }
  return { tiles, centerWorld, tileZoom };
}

function warmTileUrls(urls) {
  if (typeof Image === "undefined") return;
  for (const url of urls.slice(0, MAX_PREFETCH_TILES)) {
    if (!url || warmedTileUrls.has(url)) continue;
    if (warmedTileUrls.size > 900) warmedTileUrls.clear();
    warmedTileUrls.add(url);
    const img = new Image();
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.src = url;
  }
}

function fmtCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(5) : "";
}

function requestFrame(cb) {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(cb);
  return setTimeout(cb, 16);
}

function cancelFrame(id) {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id);
}

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [ref]);
  return size;
}

function StreetMapView({
  center,
  zoom,
  onCenterChange,
  onZoomChange,
  onInteractionStart,
  onInteractionEnd,
  interactive = false,
  style,
  children,
}) {
  const ref = useRef(null);
  const dragRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const frameRef = useRef(0);
  const pendingCenterRef = useRef(null);
  const size = useElementSize(ref);
  const safeZoom = normalizeZoom(zoom);
  const safeCenter = validCoord(center) || toMapCoord(FALLBACK_WGS);
  const centerLng = safeCenter.lng;
  const centerLat = safeCenter.lat;
  const mapWidth = size.width;
  const mapHeight = size.height;
  const view = useMemo(
    () => mapTilesForView({ lng: centerLng, lat: centerLat }, { width: mapWidth, height: mapHeight }, safeZoom, PRELOAD_TILE_BUFFER),
    [centerLat, centerLng, mapHeight, mapWidth, safeZoom],
  );
  const { tiles, centerWorld, tileZoom } = view;
  const viewRef = useRef({ centerWorld, tileZoom });
  const zoomRef = useRef(safeZoom);

  useEffect(() => () => {
    if (frameRef.current) cancelFrame(frameRef.current);
  }, []);

  useEffect(() => {
    viewRef.current = { centerWorld, tileZoom };
    zoomRef.current = safeZoom;
  }, [centerWorld, safeZoom, tileZoom]);

  useEffect(() => {
    warmTileUrls(tiles.map(tile => tile.url));
  }, [tiles]);

  function scheduleCenterChange(nextCenter) {
    if (!onCenterChange) return;
    pendingCenterRef.current = nextCenter;
    if (frameRef.current) return;
    frameRef.current = requestFrame(() => {
      frameRef.current = 0;
      const pending = pendingCenterRef.current;
      pendingCenterRef.current = null;
      if (pending) onCenterChange(pending);
    });
  }

  function flushCenterChange() {
    if (frameRef.current) {
      cancelFrame(frameRef.current);
      frameRef.current = 0;
    }
    const pending = pendingCenterRef.current;
    pendingCenterRef.current = null;
    if (pending && onCenterChange) onCenterChange(pending);
  }

  function activePointerList() {
    return [...pointersRef.current.values()];
  }

  function pointerDistance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function initPinch() {
    const pts = activePointerList();
    if (pts.length < 2) {
      pinchRef.current = null;
      return;
    }
    pinchRef.current = {
      startDistance: Math.max(8, pointerDistance(pts[0], pts[1])),
      startZoom: zoomRef.current,
    };
  }

  function pointerDown(e) {
    if (!interactive || !onCenterChange) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const wasIdle = pointersRef.current.size === 0;
    pointersRef.current.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
    if (wasIdle) onInteractionStart?.();
    if (pointersRef.current.size >= 2) {
      dragRef.current = null;
      initPinch();
      return;
    }
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, ...viewRef.current };
  }

  function pointerMove(e) {
    if (!interactive) return;
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
    }
    if (pointersRef.current.size >= 2) {
      const pts = activePointerList();
      const pinch = pinchRef.current;
      if (!pinch || pts.length < 2 || !onZoomChange) return;
      const ratio = pointerDistance(pts[0], pts[1]) / pinch.startDistance;
      const nextZoom = clamp(pinch.startZoom + Math.log2(Math.max(0.25, ratio)), MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(nextZoom - zoomRef.current) >= 0.01) onZoomChange(nextZoom);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId || !onCenterChange) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    scheduleCenterChange(worldToLngLat(
      drag.centerWorld.x - dx,
      drag.centerWorld.y - dy,
      drag.tileZoom,
    ));
  }

  function pointerUp(e) {
    pointersRef.current.delete(e.pointerId);
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
    if (pointersRef.current.size >= 2) {
      initPinch();
    } else if (pointersRef.current.size === 1) {
      pinchRef.current = null;
      const pt = activePointerList()[0];
      dragRef.current = { id: pt.id, x: pt.x, y: pt.y, ...viewRef.current };
    } else {
      pinchRef.current = null;
      flushCenterChange();
      onInteractionEnd?.();
    }
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  return (
    <div
      ref={ref}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      style={{
        position: "relative",
        overflow: "hidden",
        background: "#e7e7e2",
        touchAction: interactive ? "none" : "auto",
        cursor: interactive ? "grab" : "default",
        userSelect: "none",
        contain: "layout paint",
        isolation: "isolate",
        ...style,
      }}
    >
      {tiles.map(tile => (
        <img
          key={tile.key}
          src={tile.url}
          alt=""
          draggable={false}
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          style={{
            position: "absolute",
            left: tile.left,
            top: tile.top,
            width: TILE_SIZE,
            height: TILE_SIZE,
            pointerEvents: "none",
            transform: "translateZ(0)",
            backfaceVisibility: "hidden",
          }}
        />
      ))}
      {children}
    </div>
  );
}

function AmapSdkMapView({
  center,
  zoom,
  onCenterChange,
  onZoomChange,
  onInteractionStart,
  onInteractionEnd,
  onError,
  interactive = false,
  style,
  children,
}) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const frameRef = useRef(0);
  const lastMapSyncRef = useRef(0);
  const callbacksRef = useRef({ onCenterChange, onZoomChange, onInteractionStart, onInteractionEnd, onError });
  const safeZoom = normalizeZoom(zoom);
  const safeCenter = validCoord(center) || toMapCoord(FALLBACK_WGS);
  const centerLng = safeCenter.lng;
  const centerLat = safeCenter.lat;

  useEffect(() => {
    callbacksRef.current = { onCenterChange, onZoomChange, onInteractionStart, onInteractionEnd, onError };
  }, [onCenterChange, onError, onInteractionEnd, onInteractionStart, onZoomChange]);

  useEffect(() => {
    let disposed = false;

    function readMapState({ force = false } = {}) {
      const map = mapRef.current;
      if (!map || disposed) return;
      const now = Date.now();
      if (!force && now - lastMapSyncRef.current < AMAP_REACT_SYNC_INTERVAL_MS) return;
      lastMapSyncRef.current = now;
      const mapCenter = map.getCenter();
      const mapZoom = Number(map.getZoom());
      callbacksRef.current.onCenterChange?.({ lng: mapCenter.lng, lat: mapCenter.lat });
      if (Number.isFinite(mapZoom)) callbacksRef.current.onZoomChange?.(mapZoom);
    }

    function syncFromMap() {
      if (frameRef.current) return;
      frameRef.current = requestFrame(() => {
        frameRef.current = 0;
        readMapState();
      });
    }

    function startInteraction() {
      callbacksRef.current.onInteractionStart?.();
    }

    function endInteraction() {
      if (frameRef.current) {
        cancelFrame(frameRef.current);
        frameRef.current = 0;
      }
      readMapState({ force: true });
      callbacksRef.current.onInteractionEnd?.();
    }

    loadAmapSdk()
      .then((AMap) => {
        if (disposed || !hostRef.current) return;
        const map = new AMap.Map(hostRef.current, {
          center: [centerLng, centerLat],
          zoom: safeZoom,
          zooms: [MIN_ZOOM, MAX_ZOOM],
          viewMode: "2D",
          resizeEnable: true,
          dragEnable: interactive,
          zoomEnable: interactive,
          touchZoom: interactive,
          doubleClickZoom: interactive,
          keyboardEnable: false,
          jogEnable: false,
          animateEnable: true,
          mapStyle: AMAP_MAP_STYLE,
        });
        mapRef.current = map;
        map.on("movestart", startInteraction);
        map.on("dragstart", startInteraction);
        map.on("zoomstart", startInteraction);
        map.on("mapmove", syncFromMap);
        map.on("moveend", endInteraction);
        map.on("dragend", endInteraction);
        map.on("zoomchange", syncFromMap);
        map.on("zoomend", endInteraction);
      })
      .catch((err) => {
        if (!disposed) callbacksRef.current.onError?.(err);
      });

    return () => {
      disposed = true;
      if (frameRef.current) cancelFrame(frameRef.current);
      const map = mapRef.current;
      mapRef.current = null;
      try { map?.destroy?.(); } catch { /* ignore SDK cleanup failure */ }
    };
    // The SDK map is created once; later center/zoom changes are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const currentCenter = map.getCenter();
      if (Math.abs(Number(currentCenter.lng) - centerLng) > 0.000001 || Math.abs(Number(currentCenter.lat) - centerLat) > 0.000001) {
        map.setCenter([centerLng, centerLat]);
      }
      if (Math.abs(Number(map.getZoom()) - safeZoom) > 0.02) {
        map.setZoom(safeZoom);
      }
    } catch { /* AMap may briefly reject calls while resizing */ }
  }, [centerLat, centerLng, safeZoom]);

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: "#e7e7e2",
        touchAction: interactive ? "none" : "auto",
        userSelect: "none",
        contain: "layout paint",
        isolation: "isolate",
        ...style,
      }}
    >
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      {children}
    </div>
  );
}

function CenterPin({ compact = false }) {
  return (
    <div style={{
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -92%)",
      width: compact ? 34 : 46,
      height: compact ? 34 : 46,
      borderRadius: "50%",
      background: "var(--moss)",
      color: "var(--accent-ink)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 12px 34px rgba(24, 40, 28, 0.42)",
      pointerEvents: "none",
    }}>
      <PinIcon size={compact ? 16 : 22} />
      <span style={{
        position: "absolute",
        left: "50%",
        bottom: compact ? -7 : -9,
        width: compact ? 8 : 10,
        height: compact ? 8 : 10,
        transform: "translateX(-50%) rotate(45deg)",
        background: "var(--moss)",
      }} />
    </div>
  );
}

export function LocationMapPreview({ location, onOpen }) {
  const t = useT();
  const instantPress = useInstantPress();
  const point = validCoord(location);
  const center = toMapCoord(point || FALLBACK_WGS);
  const title = String(location?.name || location?.address || "").trim();
  return (
    <button
      type="button"
      {...instantPress("location-map-preview-open", onOpen)}
      style={{
        width: "100%",
        border: "1px solid var(--rule)",
        borderRadius: 8,
        overflow: "hidden",
        padding: 0,
        background: "var(--bg)",
        color: "var(--ink-1)",
        textAlign: "left",
        cursor: "pointer",
        minHeight: 0,
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <StreetMapView center={center} zoom={point ? 15 : 12} style={{ height: 174 }}>
        {point && <CenterPin compact />}
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 12,
          pointerEvents: "none",
        }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <span style={{
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(8, 11, 10, 0.72)",
              color: "var(--ink-1)",
              borderRadius: 8,
              padding: "6px 9px",
              fontSize: 12,
            }}>
              {t("location.open_map")}
            </span>
          </div>
          <div style={{
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(8, 11, 10, 0.78)",
            borderRadius: 8,
            padding: "9px 10px",
          }}>
            <div style={{
              fontSize: 13,
              fontWeight: 650,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {point ? (title || t("location.unnamed")) : t("location.map_empty_title")}
            </div>
            <div style={{
              marginTop: 4,
              color: "var(--ink-3)",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
            }}>
              {point ? `${fmtCoord(location.lat)}, ${fmtCoord(location.lng)}` : t("location.map_empty")}
            </div>
          </div>
        </div>
      </StreetMapView>
    </button>
  );
}

export function MapPickerModal({ initialLocation, onConfirm, onClose }) {
  const t = useT();
  const { lang } = useLanguage();
  const instantPress = useInstantPress();
  const initial = validCoord(initialLocation) || FALLBACK_WGS;
  const [center, setCenter] = useState(() => toMapCoord(initial));
  const [zoom, setZoom] = useState(16);
  const [locating, setLocating] = useState(false);
  const [address, setAddress] = useState("");
  const [addressLoading, setAddressLoading] = useState(false);
  const [error, setError] = useState("");
  const [sdkUnavailable, setSdkUnavailable] = useState(false);
  const centerWgs = useMemo(() => fromMapCoord(center), [center]);
  const [mapInteracting, setMapInteracting] = useState(false);
  const [addressPoint, setAddressPoint] = useState(() => fromMapCoord(center));
  const mapInteractingRef = useRef(false);
  const centerWgsRef = useRef(centerWgs);
  const useAmapSdk = hasAmapSdkConfig() && !sdkUnavailable;

  function zoomBy(delta, event) {
    event?.stopPropagation?.();
    setZoom(z => clamp(z + delta, MIN_ZOOM, MAX_ZOOM));
  }

  useEffect(() => {
    centerWgsRef.current = centerWgs;
  }, [centerWgs]);

  function updateCenter(nextCenter) {
    setCenter(nextCenter);
    const nextWgs = fromMapCoord(nextCenter);
    centerWgsRef.current = nextWgs;
    if (!mapInteractingRef.current) setAddressPoint(nextWgs);
  }

  function beginMapInteraction() {
    mapInteractingRef.current = true;
    setMapInteracting(true);
    setAddressLoading(false);
  }

  function endMapInteraction() {
    mapInteractingRef.current = false;
    setMapInteracting(false);
    setAddressPoint(centerWgsRef.current);
  }

  async function locate(silent = false) {
    setLocating(true);
    if (!silent) setError("");
    try {
      const loc = await getCurrentLocation({ forceDevice: true, highAccuracy: true });
      mapInteractingRef.current = false;
      updateCenter(toMapCoord(loc));
      setZoom(16);
      setMapInteracting(false);
    } catch {
      if (!silent) setError(t("location.error_no_permission"));
    } finally {
      setLocating(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => locate(true), 0);
    // Full-screen map should start from current device location when possible.
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    if (mapInteracting) return undefined;
    const timer = setTimeout(async () => {
      setAddressLoading(true);
      try {
        const label = await reverseGeocode({ lng: addressPoint.lng, lat: addressPoint.lat, lang });
        if (active) setAddress(label || "");
      } finally {
        if (active) setAddressLoading(false);
      }
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [addressPoint.lat, addressPoint.lng, lang, mapInteracting]);

  function confirm() {
    const point = validCoord(centerWgs);
    if (!point) return;
    onConfirm?.({
      ...point,
      address,
    });
  }

  return (
    <ModalRoot onClose={onClose}>
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 10020,
        background: "var(--bg)",
        color: "var(--ink-1)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-sans)",
        overflow: "hidden",
        isolation: "isolate",
      }}>
        <div style={{
          padding: "calc(env(safe-area-inset-top) + 12px) 14px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          borderBottom: "1px solid var(--rule)",
          background: "#0d1210",
          zIndex: 2,
          flexShrink: 0,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 650 }}>{t("location.map_fullscreen_title")}</div>
            <div style={{ ...s.muted, fontSize: 11, marginTop: 2 }}>{t("location.map_drag_hint")}</div>
          </div>
          <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
        </div>

        <div style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          marginBottom: MAP_PICKER_BOTTOM_OFFSET,
          zIndex: 1,
        }}>
          {useAmapSdk ? (
            <AmapSdkMapView
              center={center}
              zoom={zoom}
              onCenterChange={updateCenter}
              onZoomChange={setZoom}
              onInteractionStart={beginMapInteraction}
              onInteractionEnd={endMapInteraction}
              onError={(err) => {
                console.warn("[map] AMap SDK unavailable, falling back to raster tiles:", err?.message || err);
                setSdkUnavailable(true);
              }}
              interactive
              style={{ position: "absolute", inset: 0 }}
            >
              <CenterPin />
              <div style={{
                position: "absolute",
                right: 12,
                top: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}>
                <button type="button" onClick={() => locate(false)} disabled={locating} style={{
                  ...s.btnGhost,
                  width: 42,
                  height: 42,
                  minHeight: 42,
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#151b18",
                  boxShadow: "none",
                }} aria-label={t("location.detect_button")} title={t("location.detect_button")}>
                  {locating ? <Spinner size={14} thickness={1.5} /> : <PinIcon size={17} />}
                </button>
                <button type="button" {...instantPress("map-picker-sdk-zoom-in", (event) => zoomBy(1, event))} style={{
                  ...s.btnGhost,
                  width: 42,
                  height: 42,
                  minHeight: 42,
                  padding: 0,
                  fontSize: 20,
                  background: "#151b18",
                  boxShadow: "none",
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                }} aria-label={t("location.zoom_in")}>+</button>
                <button type="button" {...instantPress("map-picker-sdk-zoom-out", (event) => zoomBy(-1, event))} style={{
                  ...s.btnGhost,
                  width: 42,
                  height: 42,
                  minHeight: 42,
                  padding: 0,
                  fontSize: 22,
                  background: "#151b18",
                  boxShadow: "none",
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                }} aria-label={t("location.zoom_out")}>-</button>
              </div>
            </AmapSdkMapView>
          ) : (
            <StreetMapView
              center={center}
              zoom={zoom}
              onCenterChange={updateCenter}
              onZoomChange={setZoom}
              onInteractionStart={beginMapInteraction}
              onInteractionEnd={endMapInteraction}
              interactive
              style={{ position: "absolute", inset: 0 }}
            >
            <CenterPin />
            <div style={{
              position: "absolute",
              right: 12,
              top: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}>
              <button type="button" onClick={() => locate(false)} disabled={locating} style={{
                ...s.btnGhost,
                width: 42,
                height: 42,
                minHeight: 42,
                padding: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#151b18",
                boxShadow: "none",
              }} aria-label={t("location.detect_button")} title={t("location.detect_button")}>
                {locating ? <Spinner size={14} thickness={1.5} /> : <PinIcon size={17} />}
              </button>
              <button type="button" {...instantPress("map-picker-fallback-zoom-in", (event) => zoomBy(1, event))} style={{
                ...s.btnGhost,
                width: 42,
                height: 42,
                minHeight: 42,
                padding: 0,
                fontSize: 20,
                background: "#151b18",
                boxShadow: "none",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }} aria-label={t("location.zoom_in")}>+</button>
              <button type="button" {...instantPress("map-picker-fallback-zoom-out", (event) => zoomBy(-1, event))} style={{
                ...s.btnGhost,
                width: 42,
                height: 42,
                minHeight: 42,
                padding: 0,
                fontSize: 22,
                background: "#151b18",
                boxShadow: "none",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }} aria-label={t("location.zoom_out")}>-</button>
            </div>
            </StreetMapView>
          )}
        </div>

        <div style={{
          padding: "12px 14px calc(env(safe-area-inset-bottom) + 14px)",
          borderTop: "1px solid var(--rule)",
          background: "rgb(13, 18, 16)",
          color: "var(--ink-1)",
          boxShadow: "0 -1px 0 rgba(255,255,255,0.03)",
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 6,
          boxSizing: "border-box",
          minHeight: 126,
          pointerEvents: "auto",
        }}>
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}>
            <div style={{ minWidth: 0, width: "100%" }}>
              <div style={{
                color: address ? "var(--ink-1)" : "var(--ink-3)",
                fontSize: 13,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {addressLoading ? t("location.map_address_loading") : (address || t("location.map_address_unknown"))}
              </div>
              <div style={{
                marginTop: 4,
                color: "var(--ink-3)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontVariantNumeric: "tabular-nums",
              }}>
                {fmtCoord(centerWgs.lat)}, {fmtCoord(centerWgs.lng)} · WGS84
              </div>
            </div>
            <button type="button" onClick={confirm} style={{
              ...s.btn,
              width: "100%",
              minHeight: 42,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgb(103, 133, 96)",
              color: "var(--accent-ink)",
              borderColor: "rgb(103, 133, 96)",
              boxShadow: "none",
            }}>
              {t("location.confirm_point")}
            </button>
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 9 }}>{error}</div>}
        </div>
      </div>
    </ModalRoot>
  );
}
