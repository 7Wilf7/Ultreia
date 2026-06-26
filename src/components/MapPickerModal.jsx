import { useEffect, useMemo, useRef, useState } from "react";
import { s } from "../styles";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { getCurrentLocation, hasValidCoords, reverseGeocode } from "../lib/weather";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";
import { PinIcon } from "./Icons";

const TILE_SIZE = 256;
const MIN_ZOOM = 12;
const MAX_ZOOM = 18;
const FALLBACK_WGS = { lng: 113.2644, lat: 23.1291 }; // Guangzhou
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

function fmtCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(5) : "";
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

function StreetMapView({ center, zoom, onCenterChange, interactive = false, style, children }) {
  const ref = useRef(null);
  const dragRef = useRef(null);
  const size = useElementSize(ref);
  const safeZoom = clamp(Math.round(Number(zoom) || 16), MIN_ZOOM, MAX_ZOOM);
  const safeCenter = validCoord(center) || toMapCoord(FALLBACK_WGS);
  const centerWorld = lngLatToWorld(safeCenter.lng, safeCenter.lat, safeZoom);

  const tiles = useMemo(() => {
    if (!size.width || !size.height) return [];
    const topLeft = {
      x: centerWorld.x - size.width / 2,
      y: centerWorld.y - size.height / 2,
    };
    const minX = Math.floor(topLeft.x / TILE_SIZE) - 1;
    const maxX = Math.floor((topLeft.x + size.width) / TILE_SIZE) + 1;
    const minY = Math.floor(topLeft.y / TILE_SIZE) - 1;
    const maxY = Math.floor((topLeft.y + size.height) / TILE_SIZE) + 1;
    const tileCount = 2 ** safeZoom;
    const out = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        if (y < 0 || y >= tileCount) continue;
        const wrappedX = ((x % tileCount) + tileCount) % tileCount;
        out.push({
          key: `${safeZoom}:${x}:${y}`,
          url: tileUrl(wrappedX, y, safeZoom),
          left: x * TILE_SIZE - topLeft.x,
          top: y * TILE_SIZE - topLeft.y,
        });
      }
    }
    return out;
  }, [centerWorld.x, centerWorld.y, safeZoom, size.height, size.width]);

  function pointerDown(e) {
    if (!interactive || !onCenterChange) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      centerWorld,
    };
  }

  function pointerMove(e) {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId || !onCenterChange) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    onCenterChange(worldToLngLat(drag.centerWorld.x - dx, drag.centerWorld.y - dy, safeZoom));
  }

  function pointerUp(e) {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
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
        background: "var(--bg-elevated)",
        touchAction: interactive ? "none" : "auto",
        cursor: interactive ? "grab" : "default",
        userSelect: "none",
        ...style,
      }}
    >
      {tiles.map(tile => (
        <img
          key={tile.key}
          src={tile.url}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          style={{
            position: "absolute",
            left: tile.left,
            top: tile.top,
            width: TILE_SIZE,
            height: TILE_SIZE,
            pointerEvents: "none",
          }}
        />
      ))}
      <div style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(180deg, rgba(8,11,10,0.08), rgba(8,11,10,0.18))",
        pointerEvents: "none",
      }} />
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
  const point = validCoord(location);
  const center = toMapCoord(point || FALLBACK_WGS);
  const title = String(location?.name || location?.address || "").trim();
  return (
    <button
      type="button"
      onClick={onOpen}
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
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}>
              {t("location.open_map")}
            </span>
          </div>
          <div style={{
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(8, 11, 10, 0.78)",
            borderRadius: 8,
            padding: "9px 10px",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
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
  const initial = validCoord(initialLocation) || FALLBACK_WGS;
  const [center, setCenter] = useState(() => toMapCoord(initial));
  const [zoom, setZoom] = useState(16);
  const [locating, setLocating] = useState(false);
  const [address, setAddress] = useState("");
  const [addressLoading, setAddressLoading] = useState(false);
  const [error, setError] = useState("");
  const centerWgs = useMemo(() => fromMapCoord(center), [center]);

  async function locate(silent = false) {
    setLocating(true);
    if (!silent) setError("");
    try {
      const loc = await getCurrentLocation({ forceDevice: true, highAccuracy: true });
      setCenter(toMapCoord(loc));
      setZoom(16);
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
    const timer = setTimeout(async () => {
      setAddressLoading(true);
      try {
        const label = await reverseGeocode({ lng: centerWgs.lng, lat: centerWgs.lat, lang });
        if (active) setAddress(label || "");
      } finally {
        if (active) setAddressLoading(false);
      }
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [centerWgs.lat, centerWgs.lng, lang]);

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
      }}>
        <div style={{
          padding: "calc(env(safe-area-inset-top) + 12px) 14px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          borderBottom: "1px solid var(--rule)",
          background: "rgba(8, 11, 10, 0.88)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          zIndex: 2,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 650 }}>{t("location.map_fullscreen_title")}</div>
            <div style={{ ...s.muted, fontSize: 11, marginTop: 2 }}>{t("location.map_drag_hint")}</div>
          </div>
          <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
        </div>

        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <StreetMapView
            center={center}
            zoom={zoom}
            onCenterChange={setCenter}
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
                background: "rgba(8, 11, 10, 0.82)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
              }} aria-label={t("location.detect_button")} title={t("location.detect_button")}>
                {locating ? <Spinner size={14} thickness={1.5} /> : <PinIcon size={17} />}
              </button>
              <button type="button" onClick={() => setZoom(z => clamp(z + 1, MIN_ZOOM, MAX_ZOOM))} style={{
                ...s.btnGhost,
                width: 42,
                height: 42,
                minHeight: 42,
                padding: 0,
                fontSize: 20,
                background: "rgba(8, 11, 10, 0.82)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
              }} aria-label={t("location.zoom_in")}>+</button>
              <button type="button" onClick={() => setZoom(z => clamp(z - 1, MIN_ZOOM, MAX_ZOOM))} style={{
                ...s.btnGhost,
                width: 42,
                height: 42,
                minHeight: 42,
                padding: 0,
                fontSize: 22,
                background: "rgba(8, 11, 10, 0.82)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
              }} aria-label={t("location.zoom_out")}>-</button>
            </div>
          </StreetMapView>
        </div>

        <div style={{
          padding: "12px 14px calc(env(safe-area-inset-bottom) + 14px)",
          borderTop: "1px solid var(--rule)",
          background: "rgba(8, 11, 10, 0.92)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
        }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 12,
            alignItems: "center",
          }}>
            <div style={{ minWidth: 0 }}>
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
            <button type="button" onClick={confirm} style={{ ...s.btn, minHeight: 40 }}>
              {t("location.confirm_point")}
            </button>
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 9 }}>{error}</div>}
        </div>
      </div>
    </ModalRoot>
  );
}
