"use client";

import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Terminal, Port, Cluster } from "@/lib/types";
import { useEffect, useState } from "react";

// Fix for default marker icons in Next.js
// Fix for default marker icons in Next.js
// Constants removed as they were unused and causing lint errors


// Custom crane icon for Terminals
const terminalIcon = L.icon({
    iconUrl: "/terminal-icon.svg",
    iconSize: [26, 32], // approx 4:5 ratio matching SVG (40x50)
    iconAnchor: [13, 32],
    popupAnchor: [0, -32],
    tooltipAnchor: [13, -28],
    className: "terminal-icon" // Optional class for additional styling
});

// Dynamic Port Icon (Yellow Circle with Count)
const createPortCountIcon = (count: number) => {
    return L.divIcon({
        className: "custom-port-icon",
        html: `<div style="
            background-color: rgba(248, 254, 98, 0.8); 
            color: #0E0F13; 
            font-weight: bold; 
            border-radius: 50%; 
            width: 32px; 
            height: 32px; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            font-size: 14px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        ">${count}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16], // Center anchor
        popupAnchor: [0, -20],
    });
};

// Dynamic Cluster Icon (Orange Circle with Count & Label)
const createClusterIcon = (count: number, name: string) => {
    return L.divIcon({
        className: "custom-cluster-icon",
        html: `
            <div style="position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
                <div style="
                    position: absolute;
                    top: -20px;
                    left: 50%;
                    transform: translateX(-50%);
                    white-space: nowrap;
                    font-weight: bold;
                    color: #333;
                    text-shadow: 0 1px 2px rgba(255,255,255,0.8);
                    font-size: 12px;
                    pointer-events: none;
                ">${name}</div>
                <div style="
                    background-color: rgba(255, 165, 0, 0.8); 
                    color: #fff; 
                    font-weight: bold; 
                    border-radius: 50%; 
                    width: 40px; 
                    height: 40px; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    font-size: 16px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                ">${count}</div>
            </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -24],
    });
};

// ... (MapProps and MapController remain unchanged)

// Update Props Interface
interface MapProps {
    terminals: Terminal[];
    ports: Port[];
    clusters: Cluster[];
    selectedClusterId?: string;
    onSelectTerminal: (id: string) => void;
    onClearSelection?: () => void;
    hasActiveFilter?: boolean;
}

const MapController = ({
    selectedClusterId,
    ports,
    terminals,
    hasActiveFilter
}: {
    selectedClusterId?: string;
    ports: Port[];
    terminals: Terminal[];
    clusters: Cluster[];
    hasActiveFilter?: boolean;
}) => {
    const map = useMap();

    useEffect(() => {
        // Auto-fit bounds logic
        if (hasActiveFilter && terminals.length > 0) {
            const bounds = L.latLngBounds(terminals.map(t => [t.latitude, t.longitude]));
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
            return;
        }

        if (selectedClusterId) {
            // Find ports in this cluster
            const clusterPorts = ports.filter(p => p.clusterId === selectedClusterId);
            if (clusterPorts.length > 0) {
                const bounds = L.latLngBounds(clusterPorts.map(p => [p.latitude, p.longitude]));
                map.fitBounds(bounds, { padding: [50, 50] });
            }
        }
    }, [selectedClusterId, ports, map, terminals, hasActiveFilter]);

    return null;
};

// Component to track zoom level
const ZoomTracker = ({ onZoomChange }: { onZoomChange: (zoom: number) => void }) => {
    const map = useMapEvents({
        zoomend: () => {
            onZoomChange(map.getZoom());
        },
    });
    return null;
};

const Map = ({ terminals, ports, clusters, selectedClusterId, onSelectTerminal, onClearSelection, hasActiveFilter }: MapProps) => {
    const [zoomLevel, setZoomLevel] = useState(4); // Default start zoom

    // Aggregation Logic
    // If zoom < 8, show Ports. 
    // If zoom >= 8, show Terminals.
    // BUT if we have an active filter (drilled down), we might want to always show terminals? 
    // Let's keep distinct behavior: if we have active filter, likely we are zoomed in or want to see terminals.

    // Logic update: If filtered to a single port (few terminals), likely want to see terminals immediately.
    // Zoom < 6: Show Clusters (Orange)
    // 6 <= Zoom < 9: Show Ports (Yellow)
    // Zoom >= 9: Show Terminals (Acid Lime)

    const showClusters = !hasActiveFilter && zoomLevel < 6;
    const showPorts = !hasActiveFilter && zoomLevel >= 6 && zoomLevel < 9;

    return (
        <div className="h-full w-full relative z-0">
            <MapContainer
                center={[48, 10]} // Europe center
                zoom={4}
                className="h-full w-full"
                style={{ background: "#f0f0f0" }}
            >
                <ZoomTracker onZoomChange={setZoomLevel} />
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                />

                {/* Cluster Markers (Aggregated) */}
                {showClusters && clusters.map(cluster => {
                    // Find ports in this cluster
                    const clusterPorts = ports.filter(p => p.clusterId === cluster.id);
                    // Find terminals in these ports
                    const clusterTerminals = terminals.filter(t => clusterPorts.some(p => p.id === t.portId));
                    const terminalCount = clusterTerminals.length;

                    if (terminalCount === 0) return null;

                    // Calculate Centroid
                    const lats = clusterPorts.map(p => p.latitude);
                    const lngs = clusterPorts.map(p => p.longitude);
                    if (lats.length === 0) return null;

                    const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
                    const centerLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;

                    return (
                        <Marker
                            key={cluster.id}
                            position={[centerLat, centerLng]}
                            icon={createClusterIcon(terminalCount, cluster.name)}
                            eventHandlers={{
                                click: (e) => {
                                    e.target._map.setView([centerLat, centerLng], 8); // Zoom in to port view
                                }
                            }}
                        />
                    );
                })}

                {/* Port Markers (Aggregated) */}
                {showPorts && ports.map(port => {
                    // Check if this port has any visible terminals (filtered)
                    // Note: If we are in "showPorts" mode (zoomed out), we generally want to verify 
                    // if the port has terminals relevant to the dataset.
                    // Counting terminals for this port:
                    const portTerminals = terminals.filter(t => t.portId === port.id);
                    const terminalCount = portTerminals.length;

                    if (terminalCount === 0) return null;

                    return (
                        <Marker
                            key={port.id}
                            position={[port.latitude, port.longitude]}
                            icon={createPortCountIcon(terminalCount)}
                            eventHandlers={{
                                click: (e) => {
                                    e.target._map.setView([port.latitude, port.longitude], 10);
                                }
                            }}
                        >
                            <Popup>
                                <div className="p-1">
                                    <h3 className="font-bold text-sm">{port.name}</h3>
                                    <p className="text-xs text-gray-600">{port.country}</p>
                                    <p className="text-xs mt-1 font-semibold">{terminalCount} Terminals</p>
                                    <p className="text-xs mt-1 italic text-gray-500">Zoom in to see details</p>
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                {/* Terminal Markers (Detail) */}
                {!showPorts && !showClusters && terminals.map((terminal) => {
                    const port = ports.find(p => p.id === terminal.portId);
                    return (
                        <Marker
                            key={terminal.id}
                            position={[terminal.latitude, terminal.longitude]}
                            icon={terminalIcon}
                            eventHandlers={{
                                click: () => onSelectTerminal(terminal.id),
                            }}
                        >
                            <Popup>
                                <div className="p-1">
                                    <h3 className="font-bold text-sm">{terminal.name}</h3>
                                    <p className="text-xs text-gray-600">{port?.name}, {port?.country}</p>
                                    <div className="mt-1 text-xs">
                                        <span className="font-semibold">Vol:</span> {terminal.estAnnualVolume}
                                    </div>
                                    <div className="mt-1">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${terminal.ispsRiskLevel === 'High' || terminal.ispsRiskLevel === 'Very High'
                                            ? 'bg-red-100 text-red-700'
                                            : 'bg-green-100 text-green-700'
                                            }`}>
                                            ISPS: {terminal.ispsRiskLevel}
                                        </span>
                                    </div>
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                <MapController
                    selectedClusterId={selectedClusterId}
                    ports={ports}
                    terminals={terminals}
                    clusters={clusters}
                    hasActiveFilter={hasActiveFilter}
                />
            </MapContainer>

            {/* Clear Filter Control */}
            {hasActiveFilter && onClearSelection && (
                <div className="absolute top-[80px] left-[10px] z-[1000]">
                    <button
                        onClick={onClearSelection}
                        className="bg-white border-2 border-gray-300 rounded shadow-md px-2 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center"
                        title="Show all terminals"
                    >
                        <span>✖ Clear Filter</span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default Map;
