"use client";

import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Terminal, Port, Cluster, PriorityTier, TerminalProposal } from "@/lib/types";
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

// Proposal icon with distinct styling (dashed border, orange/blue)
const createProposalIcon = () => {
    return L.divIcon({
        className: "custom-proposal-icon",
        html: `<div style="
            background-color: rgba(255, 165, 0, 0.6); 
            border: 2px dashed rgba(255, 140, 0, 0.9);
            border-radius: 4px;
            width: 24px; 
            height: 30px; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            font-size: 12px;
            font-weight: bold;
            color: #fff;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        ">P</div>`,
        iconSize: [24, 30],
        iconAnchor: [12, 30],
        popupAnchor: [0, -30],
    });
};

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

// Dynamic Cluster Icon (Orange Circle with Count, color-coded by priority tier, size by terminal count)
const createClusterIcon = (count: number, priorityTier: PriorityTier, minCount: number, maxCount: number) => {
    // Calculate dynamic size based on terminal count (32px to 60px range)
    const minSize = 32;
    const maxSize = 60;
    let size = minSize;
    if (maxCount > minCount) {
        size = minSize + ((count - minCount) / (maxCount - minCount)) * (maxSize - minSize);
    } else {
        size = (minSize + maxSize) / 2; // Default to middle size if all counts are the same
    }
    size = Math.round(size);

    // Calculate font size proportionally (12px for 32px icon, 18px for 60px icon)
    const fontSize = Math.round(12 + ((size - minSize) / (maxSize - minSize)) * 6);

    // Color coding by priority tier
    let backgroundColor: string;
    switch (priorityTier) {
        case 1:
            backgroundColor = "rgba(255, 140, 0, 0.9)"; // Dark orange for Tier 1
            break;
        case 2:
            backgroundColor = "rgba(255, 165, 0, 0.8)"; // Medium orange for Tier 2
            break;
        case 3:
            backgroundColor = "rgba(255, 200, 100, 0.8)"; // Light orange for Tier 3
            break;
        default:
            backgroundColor = "rgba(255, 165, 0, 0.8)"; // Default to Tier 2 color
    }

    return L.divIcon({
        className: "custom-cluster-icon",
        html: `
            <div style="
                background-color: ${backgroundColor}; 
                color: #fff; 
                font-weight: bold; 
                border-radius: 50%; 
                width: ${size}px; 
                height: ${size}px; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                font-size: ${fontSize}px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            ">${count}</div>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2 - 4],
    });
};

// Helper function to validate coordinates
const isValidCoordinates = (lat: number, lng: number, portCountry?: string): boolean => {
    // Check for NaN or Infinity
    if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) {
        return false;
    }
    
    // Check valid ranges
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return false;
    }
    
    // Check for default Europe center (50.0, 10.0) - only valid if port is actually in Europe
    // For now, we'll be lenient and allow it, but could be more strict
    // if (lat === 50.0 && lng === 10.0 && portCountry && !isEuropeanCountry(portCountry)) {
    //     return false;
    // }
    
    return true;
};

// Helper function to filter terminals with valid coordinates
const filterValidTerminals = (terminals: Terminal[]): Terminal[] => {
    return terminals.filter(t => isValidCoordinates(t.latitude, t.longitude));
};

// Update Props Interface
interface MapProps {
    terminals: Terminal[];
    ports: Port[];
    clusters: Cluster[];
    proposals?: TerminalProposal[];
    selectedClusterId?: string;
    zoomToClusterId?: string;
    zoomToPortId?: string;
    zoomToTerminalId?: string;
    onSelectTerminal: (id: string) => void;
    onSelectProposal?: (id: string) => void;
    onClearSelection?: () => void;
    hasActiveFilter?: boolean;
}

const MapController = ({
    selectedClusterId,
    zoomToClusterId,
    zoomToPortId,
    zoomToTerminalId,
    ports,
    terminals,
    proposals,
    hasActiveFilter
}: {
    selectedClusterId?: string;
    zoomToClusterId?: string;
    zoomToPortId?: string;
    zoomToTerminalId?: string;
    ports: Port[];
    terminals: Terminal[];
    proposals?: TerminalProposal[];
    hasActiveFilter?: boolean;
}) => {
    const map = useMap();

    useEffect(() => {
        // Priority: zoomTo props > hasActiveFilter > selectedClusterId
        
        // Handle zoom to terminal (highest priority)
        if (zoomToTerminalId) {
            const terminal = terminals.find(t => t.id === zoomToTerminalId);
            if (terminal && isValidCoordinates(terminal.latitude, terminal.longitude)) {
                // Calculate adaptive zoom based on nearby terminal density
                const validTerminals = filterValidTerminals(terminals);
                const portTerminals = validTerminals.filter(t => t.portId === terminal.portId);
                
                // If terminal is in a dense port (many terminals), use zoom 12
                // If isolated, use zoom 14 for closer view
                const zoomLevel = portTerminals.length > 5 ? 12 : 14;
                
                map.setView([terminal.latitude, terminal.longitude], zoomLevel, { animate: true });
                return;
            }
        }

        // Handle zoom to port
        if (zoomToPortId) {
            const portTerminals = filterValidTerminals(terminals.filter(t => t.portId === zoomToPortId));
            
            // Filter valid proposals for this port
            const portProposals = proposals 
                ? proposals.filter(p => 
                    p.portId === zoomToPortId && 
                    p.latitude !== null && 
                    p.longitude !== null &&
                    isValidCoordinates(p.latitude, p.longitude)
                )
                : [];
            
            // Combine terminals and proposals for bounds calculation
            const allLocations: Array<{ latitude: number; longitude: number }> = [
                ...portTerminals.map(t => ({ latitude: t.latitude, longitude: t.longitude })),
                ...portProposals.map(p => ({ latitude: p.latitude!, longitude: p.longitude! }))
            ];
            
            if (allLocations.length > 0) {
                const bounds = L.latLngBounds(allLocations.map(loc => [loc.latitude, loc.longitude]));
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
                return;
            }
        }

        // Handle zoom to cluster
        if (zoomToClusterId) {
            const clusterPorts = ports.filter(p => p.clusterId === zoomToClusterId);
            const clusterTerminals = filterValidTerminals(terminals.filter(t => clusterPorts.some(p => p.id === t.portId)));
            if (clusterTerminals.length > 0) {
                const bounds = L.latLngBounds(clusterTerminals.map(t => [t.latitude, t.longitude]));
                map.fitBounds(bounds, { padding: [50, 50] });
                return;
            }
        }

        // Auto-fit bounds logic for active filters
        if (hasActiveFilter && terminals.length > 0) {
            const validTerminals = filterValidTerminals(terminals);
            if (validTerminals.length > 0) {
                const bounds = L.latLngBounds(validTerminals.map(t => [t.latitude, t.longitude]));
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
                return;
            }
        }

        // Handle selectedClusterId (for filter panel)
        if (selectedClusterId) {
            // Find terminals in this cluster
            const clusterPorts = ports.filter(p => p.clusterId === selectedClusterId);
            const clusterTerminals = filterValidTerminals(terminals.filter(t => clusterPorts.some(p => p.id === t.portId)));
            if (clusterTerminals.length > 0) {
                const bounds = L.latLngBounds(clusterTerminals.map(t => [t.latitude, t.longitude]));
                map.fitBounds(bounds, { padding: [50, 50] });
            }
        }
    }, [selectedClusterId, zoomToClusterId, zoomToPortId, zoomToTerminalId, ports, map, terminals, proposals, hasActiveFilter]);

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

const Map = ({ terminals, ports, clusters, proposals, selectedClusterId, zoomToClusterId, zoomToPortId, zoomToTerminalId, onSelectTerminal, onSelectProposal, onClearSelection, hasActiveFilter }: MapProps) => {
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
                {showClusters && (() => {
                    // Calculate min/max terminal counts across all clusters for size scaling
                    const clusterTerminalCounts = clusters.map(cluster => {
                        const clusterPorts = ports.filter(p => p.clusterId === cluster.id);
                        const clusterTerminals = filterValidTerminals(terminals.filter(t => clusterPorts.some(p => p.id === t.portId)));
                        return clusterTerminals.length;
                    }).filter(count => count > 0);

                    const minTerminalCount = clusterTerminalCounts.length > 0 ? Math.min(...clusterTerminalCounts) : 0;
                    const maxTerminalCount = clusterTerminalCounts.length > 0 ? Math.max(...clusterTerminalCounts) : 0;

                    return clusters.map(cluster => {
                        // Find ports in this cluster
                        const clusterPorts = ports.filter(p => p.clusterId === cluster.id);
                        // Find terminals in these ports and filter for valid coordinates
                        const clusterTerminals = filterValidTerminals(terminals.filter(t => clusterPorts.some(p => p.id === t.portId)));
                        const terminalCount = clusterTerminals.length;

                        if (terminalCount === 0) return null;

                        // Calculate Centroid from terminal coordinates
                        const lats = clusterTerminals.map(t => t.latitude);
                        const lngs = clusterTerminals.map(t => t.longitude);
                        if (lats.length === 0) return null;

                        const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
                        const centerLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;

                        return (
                            <Marker
                                key={cluster.id}
                                position={[centerLat, centerLng]}
                                icon={createClusterIcon(terminalCount, cluster.priorityTier, minTerminalCount, maxTerminalCount)}
                                eventHandlers={{
                                    click: (e) => {
                                        e.target._map.setView([centerLat, centerLng], 8); // Zoom in to port view
                                    }
                                }}
                            >
                                <Popup>
                                    <div className="p-1">
                                        <h3 className="font-bold text-sm">{cluster.name}</h3>
                                        <p className="text-xs text-gray-600">{cluster.countries.join(", ")}</p>
                                        <div className="mt-1 text-xs">
                                            <span className="font-semibold">Priority Tier:</span> {cluster.priorityTier}
                                        </div>
                                        <p className="text-xs mt-1 font-semibold">{terminalCount} Terminals</p>
                                        {cluster.description && (
                                            <p className="text-xs mt-1 text-gray-500 italic">{cluster.description}</p>
                                        )}
                                        <p className="text-xs mt-1 italic text-gray-500">Click to zoom in</p>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    });
                })()}

                {/* Port Markers (Aggregated) */}
                {showPorts && ports.map(port => {
                    // Check if this port has any visible terminals (filtered)
                    // Note: If we are in "showPorts" mode (zoomed out), we generally want to verify 
                    // if the port has terminals relevant to the dataset.
                    // Counting terminals for this port with valid coordinates:
                    const portTerminals = filterValidTerminals(terminals.filter(t => t.portId === port.id));
                    const terminalCount = portTerminals.length;

                    if (terminalCount === 0) return null;

                    // Calculate port position from terminal coordinates (centroid)
                    const lats = portTerminals.map(t => t.latitude);
                    const lngs = portTerminals.map(t => t.longitude);
                    const portLat = lats.reduce((a, b) => a + b, 0) / lats.length;
                    const portLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;

                    return (
                        <Marker
                            key={port.id}
                            position={[portLat, portLng]}
                            icon={createPortCountIcon(terminalCount)}
                            eventHandlers={{
                                click: (e) => {
                                    e.target._map.setView([portLat, portLng], 10);
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
                {!showPorts && !showClusters && terminals
                    .filter(terminal => isValidCoordinates(terminal.latitude, terminal.longitude))
                    .map((terminal) => {
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
                                            <span className="font-semibold">Capacity:</span> {terminal.capacity}
                                        </div>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}

                {/* Proposal Markers (only show when viewing a port) */}
                {!showPorts && !showClusters && proposals && proposals
                    .filter(proposal => 
                        proposal.latitude !== null && 
                        proposal.longitude !== null && 
                        isValidCoordinates(proposal.latitude, proposal.longitude)
                    )
                    .map((proposal) => {
                        const port = ports.find(p => p.id === proposal.portId);
                        return (
                            <Marker
                                key={`proposal-${proposal.id}`}
                                position={[proposal.latitude!, proposal.longitude!]}
                                icon={createProposalIcon()}
                                eventHandlers={{
                                    click: () => {
                                        if (onSelectProposal) {
                                            onSelectProposal(proposal.id);
                                        }
                                    },
                                }}
                            >
                                <Popup>
                                    <div className="p-1">
                                        <div className="flex items-center space-x-2 mb-1">
                                            <h3 className="font-bold text-sm">{proposal.name}</h3>
                                            <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-xs rounded font-semibold">Proposal</span>
                                        </div>
                                        <p className="text-xs text-gray-600">{port?.name}, {port?.country}</p>
                                        {proposal.address && (
                                            <p className="text-xs text-gray-500 mt-1">{proposal.address}</p>
                                        )}
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}

                <MapController
                    selectedClusterId={selectedClusterId}
                    zoomToClusterId={zoomToClusterId}
                    zoomToPortId={zoomToPortId}
                    zoomToTerminalId={zoomToTerminalId}
                    ports={ports}
                    terminals={terminals}
                    proposals={proposals}
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
