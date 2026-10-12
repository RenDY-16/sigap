import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { GeoPoint, Incident } from "../domain/demoService";

function mapCenterCoordinate(value: string | undefined, min: number, max: number): number {
  const coordinate = value?.trim() ? Number(value) : 0;
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : 0;
}

const center: [number, number] = [
  mapCenterCoordinate(import.meta.env.VITE_DEMO_MAP_CENTER_LAT, -90, 90),
  mapCenterCoordinate(import.meta.env.VITE_DEMO_MAP_CENTER_LNG, -180, 180),
];
const tileUrl = import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const attribution = import.meta.env.VITE_MAP_ATTRIBUTION || "© OpenStreetMap contributors";

const pinIcon = new L.Icon({
  iconUrl: new URL("leaflet/dist/images/marker-icon.png", import.meta.url).href,
  iconRetinaUrl: new URL("leaflet/dist/images/marker-icon-2x.png", import.meta.url).href,
  shadowUrl: new URL("leaflet/dist/images/marker-shadow.png", import.meta.url).href,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [14, -28],
  shadowSize: [41, 41],
});

interface MapViewProps {
  selected?: GeoPoint | null;
  markers?: Incident[];
  onSelect?: (point: GeoPoint) => void;
  focusLocation?: GeoPoint | null;
  focusVersion?: number;
  centerOnSelected?: boolean;
  className?: string;
}

function ClickToSelect({ onSelect }: { onSelect?: (point: GeoPoint) => void }) {
  useMapEvents({
    click(event) {
      onSelect?.({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) });
    },
  });
  return null;
}

function MapFocus({ focusLocation, focusVersion }: Pick<MapViewProps, "focusLocation" | "focusVersion">) {
  const map = useMap();
  useEffect(() => {
    if (!focusLocation || !focusVersion) return;
    map.flyTo([focusLocation.lat, focusLocation.lng], Math.max(map.getZoom(), 13), { duration: 0.8 });
  }, [focusLocation, focusVersion, map]);
  return null;
}

export function MapView({
  selected,
  markers = [],
  onSelect,
  focusLocation,
  focusVersion = 0,
  centerOnSelected = false,
  className = "",
}: MapViewProps) {
  const [tileError, setTileError] = useState(false);
  const tileEvents = useMemo(
    () => ({
      tileerror: () => setTileError(true),
    }),
    [],
  );

  return (
    <div className={`map-wrap ${className}`}>
      <MapContainer
        center={centerOnSelected && selected ? [selected.lat, selected.lng] : center}
        zoom={centerOnSelected && selected ? 11 : 2}
        minZoom={2}
        maxZoom={19}
        scrollWheelZoom
        className="map-canvas"
      >
        {/* Share only the origin with the tile provider; never the report token path. */}
        {!tileError && <TileLayer url={tileUrl} attribution={attribution} referrerPolicy="origin" eventHandlers={tileEvents} />}
        <ClickToSelect onSelect={onSelect} />
        <MapFocus focusLocation={focusLocation} focusVersion={focusVersion} />
        {selected && (
          <Marker position={[selected.lat, selected.lng]} icon={pinIcon}>
            <Tooltip permanent direction="top">Titik simulasi dipilih</Tooltip>
          </Marker>
        )}
        {markers.map((incident) => {
          if (!incident.location) return null;
          const sourceLabel = incident.location.source === "gps" ? "GPS perangkat" : "Lokasi simulasi";
          return (
            <Marker
              key={incident.id}
              position={[incident.location.lat, incident.location.lng]}
              icon={pinIcon}
              title={`${incident.id} · ${sourceLabel}`}
            >
              <Tooltip permanent direction="top">
                {sourceLabel} · {incident.id.slice(0, 6)}
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
      {tileError && (
        <div className="map-tile-warning" role="status">
          Peta dasar tidak termuat. Koordinat dan status laporan tetap tersedia.
        </div>
      )}
    </div>
  );
}
