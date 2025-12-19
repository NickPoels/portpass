"use client";

import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { TerminalOperator, Port, Cluster, PriorityTier, TerminalOperatorProposal } from "@/lib/types";
import { useEffect, useState } from "react";

// Fix for default marker icons in Next.js
// Fix for default marker icons in Next.js
// Constants removed as they were unused and causing lint errors


// Custom crane icon for Operators
const operatorIcon = L.icon({
    iconUrl: "/terminal-icon.svg",
    iconSize: [26, 32], // approx 4:5 ratio matching SVG (40x50)
    iconAnchor: [13, 32],
    popupAnchor: [0, -32],
    tooltipAnchor: [13, -28],
    className: "operator-icon" // Optional class for additional styling
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

// Dynamic Cluster Icon (Orange Circle with Count, color-coded by priority tier, size by operator count)
const createClusterIcon = (count: number, priorityTier: PriorityTier, minCount: number, maxCount: number) => {
    // Calculate dynamic size based on operator count (32px to 60px range)
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

// Helper function to filter operators with valid coordinates
const filterValidOperators = (operators: TerminalOperator[]): TerminalOperator[] => {
    return operators.filter(o => o.latitude !== null && o.longitude !== null && isValidCoordinates(o.latitude!, o.longitude!));
};

// Update Props Interface
interface MapProps {
    operators: TerminalOperator[];
    ports: Port[];
    clusters: Cluster[];
    proposals?: TerminalOperatorProposal[];
    selectedClusterId?: string;
    zoomToClusterId?: string;
    zoomToPortId?: string;
    zoomToOperatorId?: string;
    onSelectOperator: (id: string) => void;
    onSelectProposal?: (id: string) => void;
    onClearSelection?: () => void;
    hasActiveFilter?: boolean;
}

const MapController = ({
    selectedClusterId,
    zoomToClusterId,
    zoomToPortId,
    zoomToOperatorId,
    ports,
    operators,
    proposals,
    hasActiveFilter
}: {
    selectedClusterId?: string;
    zoomToClusterId?: string;
    zoomToPortId?: string;
    zoomToOperatorId?: string;
    ports: Port[];
    operators: TerminalOperator[];
    proposals?: TerminalOperatorProposal[];
    hasActiveFilter?: boolean;
}) => {
    const map = useMap();

    useEffect(() => {
        // Priority: zoomTo props > hasActiveFilter > selectedClusterId
        
        // Handle zoom to operator (highest priority)
        if (zoomToOperatorId) {
            const operator = operators.find(o => o.id === zoomToOperatorId);
            if (operator && isValidCoordinates(operator.latitude, operator.longitude)) {
                // Calculate adaptive zoom based on nearby operator density
                const validOperators = filterValidOperators(operators);
                const portOperators = validOperators.filter(o => o.portId === operator.portId);
                
                // If operator is in a dense port (many operators), use zoom 12
                // If isolated, use zoom 14 for closer view
                const zoomLevel = portOperators.length > 5 ? 12 : 14;
                
                map.setView([operator.latitude, operator.longitude], zoomLevel, { animate: true });
                return;
            }
        }

        // Handle zoom to port
        if (zoomToPortId) {
            const portOperators = filterValidOperators(operators.filter(o => o.portId === zoomToPortId));
            
            // Filter valid proposals for this port
            const portProposals = proposals 
                ? proposals.filter(p => 
                    p.portId === zoomToPortId && 
                    p.latitude !== null && 
                    p.longitude !== null &&
                    isValidCoordinates(p.latitude, p.longitude)
                )
                : [];
            
            // Combine operators and proposals for bounds calculation
            const allLocations: Array<{ latitude: number; longitude: number }> = [
                ...portOperators.map(o => ({ latitude: o.latitude!, longitude: o.longitude! })),
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
            const clusterOperators = filterValidOperators(operators.filter(o => clusterPorts.some(p => p.id === o.portId)));
            if (clusterOperators.length > 0) {
                const bounds = L.latLngBounds(clusterOperators.map(o => [o.latitude!, o.longitude!]));
                map.fitBounds(bounds, { padding: [50, 50] });
                return;
            }
        }

        // Auto-fit bounds logic for active filters
        if (hasActiveFilter && operators.length > 0) {
            const validOperators = filterValidOperators(operators);
            if (validOperators.length > 0) {
                const bounds = L.latLngBounds(validOperators.map(o => [o.latitude!, o.longitude!]));
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
                return;
            }
        }

        // Handle selectedClusterId (for filter panel)
        if (selectedClusterId) {
            // Find operators in this cluster
            const clusterPorts = ports.filter(p => p.clusterId === selectedClusterId);
            const clusterOperators = filterValidOperators(operators.filter(o => clusterPorts.some(p => p.id === o.portId)));
            if (clusterOperators.length > 0) {
                const bounds = L.latLngBounds(clusterOperators.map(o => [o.latitude!, o.longitude!]));
                map.fitBounds(bounds, { padding: [50, 50] });
            }
        }
    }, [selectedClusterId, zoomToClusterId, zoomToPortId, zoomToOperatorId, ports, map, operators, proposals, hasActiveFilter]);

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

const Map = ({ operators, ports, clusters, proposals, selectedClusterId, zoomToClusterId, zoomToPortId, zoomToOperatorId, onSelectOperator, onSelectProposal, onClearSelection, hasActiveFilter }: MapProps) => {
    const [zoomLevel, setZoomLevel] = useState(4); // Default start zoom

    // Aggregation Logic
    // If zoom < 8, show Ports. 
    // If zoom >= 8, show Operators.
    // BUT if we have an active filter (drilled down), we might want to always show operators? 
    // Let's keep distinct behavior: if we have active filter, likely we are zoomed in or want to see operators.

    // Logic update: If filtered to a single port (few operators), likely want to see operators immediately.
    // Zoom < 6: Show Clusters (Orange)
    // 6 <= Zoom < 9: Show Ports (Yellow)
    // Zoom >= 9: Show Operators (Acid Lime)

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
                    // Calculate min/max operator counts across all clusters for size scaling
                    const clusterOperatorCounts = clusters.map(cluster => {
                        const clusterPorts = ports.filter(p => p.clusterId === cluster.id);
                        const clusterOperators = filterValidOperators(operators.filter(o => clusterPorts.some(p => p.id === o.portId)));
                        return clusterOperators.length;
                    }).filter(count => count > 0);

                    const minOperatorCount = clusterOperatorCounts.length > 0 ? Math.min(...clusterOperatorCounts) : 0;
                    const maxOperatorCount = clusterOperatorCounts.length > 0 ? Math.max(...clusterOperatorCounts) : 0;

                    return clusters.map(cluster => {
                        // Find ports in this cluster
                        const clusterPorts = ports.filter(p => p.clusterId === cluster.id);
                        // Find operators in these ports and filter for valid coordinates
                        const clusterOperators = filterValidOperators(operators.filter(o => clusterPorts.some(p => p.id === o.portId)));
                        const operatorCount = clusterOperators.length;

                        if (operatorCount === 0) return null;

                        // Calculate Centroid from operator coordinates
                        const lats = clusterOperators.map(o => o.latitude!);
                        const lngs = clusterOperators.map(o => o.longitude!);
                        if (lats.length === 0) return null;

                        const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
                        const centerLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;

                        return (
                            <Marker
                                key={cluster.id}
                                position={[centerLat, centerLng]}
                                icon={createClusterIcon(operatorCount, cluster.priorityTier, minOperatorCount, maxOperatorCount)}
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
                                        <p className="text-xs mt-1 font-semibold">{operatorCount} Operators</p>
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
                    // Check if this port has any visible operators (filtered)
                    // Note: If we are in "showPorts" mode (zoomed out), we generally want to verify 
                    // if the port has operators relevant to the dataset.
                    // Counting operators for this port with valid coordinates:
                    const portOperators = filterValidOperators(operators.filter(o => o.portId === port.id));
                    const operatorCount = portOperators.length;

                    if (operatorCount === 0) return null;

                    // Calculate port position from operator coordinates (centroid)
                    const lats = portOperators.map(o => o.latitude!);
                    const lngs = portOperators.map(o => o.longitude!);
                    const portLat = lats.reduce((a, b) => a + b, 0) / lats.length;
                    const portLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;

                    return (
                        <Marker
                            key={port.id}
                            position={[portLat, portLng]}
                            icon={createPortCountIcon(operatorCount)}
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
                                    <p className="text-xs mt-1 font-semibold">{operatorCount} Operators</p>
                                    <p className="text-xs mt-1 italic text-gray-500">Zoom in to see details</p>
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                {/* Operator Markers (Detail) */}
                {!showPorts && !showClusters && operators
                    .filter(operator => operator.latitude !== null && operator.longitude !== null && isValidCoordinates(operator.latitude!, operator.longitude!))
                    .map((operator) => {
                        const port = ports.find(p => p.id === operator.portId);
                        // Also show location markers if operator has multiple locations
                        const locations = operator.locations || [];
                        return (
                            <div key={operator.id}>
                                {/* Primary operator marker */}
                                <Marker
                                    position={[operator.latitude!, operator.longitude!]}
                                    icon={operatorIcon}
                                    eventHandlers={{
                                        click: () => onSelectOperator(operator.id),
                                    }}
                                >
                                    <Popup>
                                        <div className="p-1">
                                            <h3 className="font-bold text-sm">{operator.name}</h3>
                                            <p className="text-xs text-gray-600">{port?.name}, {port?.country}</p>
                                            <div className="mt-1 text-xs">
                                                <span className="font-semibold">Type:</span> {operator.operatorType === 'commercial' ? 'Commercial' : 'Captive'}
                                            </div>
                                            {operator.capacity && (
                                                <div className="mt-1 text-xs">
                                                    <span className="font-semibold">Capacity:</span> {operator.capacity}
                                                </div>
                                            )}
                                            {operator.parentCompanies && operator.parentCompanies.length > 0 && (
                                                <div className="mt-1 text-xs">
                                                    <span className="font-semibold">Parent:</span> {operator.parentCompanies.join(', ')}
                                                </div>
                                            )}
                                            {locations.length > 0 && (
                                                <div className="mt-1 text-xs text-gray-500">
                                                    {locations.length} location(s)
                                                </div>
                                            )}
                                        </div>
                                    </Popup>
                                </Marker>
                                {/* Additional location markers if operator has multiple locations */}
                                {locations.map((location, idx) => {
                                    if (!location.latitude || !location.longitude) return null;
                                    if (location.latitude === operator.latitude && location.longitude === operator.longitude) return null; // Skip if same as primary
                                    return (
                                        <Marker
                                            key={`${operator.id}-loc-${idx}`}
                                            position={[location.latitude, location.longitude]}
                                            icon={operatorIcon}
                                            eventHandlers={{
                                                click: () => onSelectOperator(operator.id),
                                            }}
                                        >
                                            <Popup>
                                                <div className="p-1">
                                                    <h3 className="font-bold text-sm">{location.name || operator.name}</h3>
                                                    <p className="text-xs text-gray-500">Location of {operator.name}</p>
                                                </div>
                                            </Popup>
                                        </Marker>
                                    );
                                })}
                            </div>
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
                    zoomToOperatorId={zoomToOperatorId}
                    ports={ports}
                    operators={operators}
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
                        title="Show all operators"
                    >
                        <span>✖ Clear Filter</span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default Map;
