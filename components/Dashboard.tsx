"use client";

import { useState, useMemo, useEffect } from "react";
import * as DBActions from "@/app/actions";
import { Terminal, Cluster, Port, ClusterId } from "@/lib/types";
import dynamic from "next/dynamic";
import { FilterPanel } from "./Sidebar/FilterPanel";
import { ActionPanel } from "./Sidebar/ActionPanel";
import { TerminalList } from "./Sidebar/TerminalList";
import { TerminalDetail } from "./Sidebar/TerminalDetail";
import { ClusterDetail } from "./Sidebar/ClusterDetail";
import { PortDetail } from "./Sidebar/PortDetail";

// Dynamic import for Map to avoid SSR
const MapView = dynamic(() => import("./Map/MapView"), { ssr: false });

interface DashboardProps {
    initialTerminals: Terminal[];
    ports: Port[];
    clusters: Cluster[];
}

type Selection =
    | { type: "terminal", id: string }
    | { type: "port", id: string }
    | { type: "cluster", id: string }
    | null;

export default function Dashboard({ initialTerminals, ports, clusters }: DashboardProps) {
    const [terminals, setTerminals] = useState<Terminal[]>(initialTerminals);
    const [userPorts, setUserPorts] = useState<Port[]>(ports);
    const [userClusters, setUserClusters] = useState<Cluster[]>(clusters);

    const [selection, setSelection] = useState<Selection>(null);

    // Filter State
    const [selectedClusterId, setSelectedClusterId] = useState<ClusterId | "ALL">("ALL");
    const [searchQuery, setSearchQuery] = useState("");


    // Sync state when props change (e.g. after server revalidation)
    useEffect(() => {
        setTerminals(initialTerminals);
    }, [initialTerminals]);

    useEffect(() => {
        setUserPorts(ports);
    }, [ports]);

    useEffect(() => {
        setUserClusters(clusters);
    }, [clusters]);

    // Helper to resolve port for a terminal
    const getPort = useMemo(() => {
        return (terminal: Terminal) => userPorts.find(p => p.id === terminal.portId);
    }, [userPorts]);

    // Derived State
    const filteredTerminals = useMemo(() => {
        return terminals.filter(t => {
            const port = getPort(t);
            if (!port) return false;

            const matchesCluster = selectedClusterId === "ALL" || port.clusterId === selectedClusterId;
            const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                port.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                port.country.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesCluster && matchesSearch;
        });
    }, [terminals, selectedClusterId, searchQuery, getPort]);

    // Derived Tree Data for Sidebar (Cluster -> Port -> Terminals)
    const treeData = useMemo(() => {
        const filteredPorts = userPorts.filter(p =>
            selectedClusterId === "ALL" || p.clusterId === selectedClusterId
        );

        const clusterGroups = userClusters
            .filter(c => selectedClusterId === "ALL" || c.id === selectedClusterId)
            .map(cluster => {
                const clusterPorts = filteredPorts.filter(p => p.clusterId === cluster.id);

                const portsWithTerminals = clusterPorts.map(port => ({
                    ...port,
                    terminals: filteredTerminals.filter(t => t.portId === port.id)
                })).filter(p => p.terminals.length > 0 || searchQuery === "");

                return {
                    ...cluster,
                    ports: portsWithTerminals
                };
            }).filter(c => c.ports.length > 0 || searchQuery === "");

        return clusterGroups;
    }, [userClusters, userPorts, filteredTerminals, selectedClusterId, searchQuery]);

    // Creation Handlers
    const handleCreateNewTerminal = async () => {
        const newId = `t-${Date.now()}`;
        const defaultPort = userPorts[0];

        if (!defaultPort) {
            alert("No ports available to create a terminal in.");
            return;
        }

        const newTerminal: Terminal = {
            id: newId,
            name: "New Terminal",
            portId: defaultPort.id,
            latitude: defaultPort.latitude,
            longitude: defaultPort.longitude,
            cargoTypes: [],
            estAnnualVolume: "Unknown",
            ispsRiskLevel: "Low",
            notes: ""
        };
        setTerminals(prev => [...prev, newTerminal]);
        setSelection({ type: "terminal", id: newId });

        await DBActions.createTerminal(newTerminal);
    };

    const handleCreateNewPort = async () => {
        const newId = `p-${Date.now()}`;
        const defaultCluster = userClusters[0];

        if (!defaultCluster) {
            alert("No clusters available.");
            return;
        }

        const newPort: Port = {
            id: newId,
            name: "New Port",
            country: "Unknown",
            clusterId: defaultCluster.id,
            latitude: 0,
            longitude: 0,
            description: ""
        };
        setUserPorts(prev => [...prev, newPort]);
        setSelection({ type: "port", id: newId });

        await DBActions.createPort(newPort);
    };

    const handleCreateNewCluster = async () => {
        const newCluster: Cluster = {
            id: `c-${Date.now()}` as ClusterId,
            name: "New Cluster",
            description: "New Cluster Description",
            priorityTier: 2,
            countries: []
        };
        setUserClusters(prev => [...prev, newCluster]);
        setSelection({ type: "cluster", id: newCluster.id });

        await DBActions.createCluster(newCluster);
    };

    // Deletion Handlers
    const handleDeleteTerminal = async (id: string) => {
        setTerminals(prev => prev.filter(t => t.id !== id));
        setSelection(null);
        await DBActions.deleteTerminal(id);
    };

    const handleDeletePort = async (id: string) => {
        const portId = id;
        // Cascade: Delete terminals in this port
        const terminalsToDelete = terminals.filter(t => t.portId === portId);
        setTerminals(prev => prev.filter(t => t.portId !== portId));
        // Delete the port
        setUserPorts(prev => prev.filter(p => p.id !== portId));
        setSelection(null);

        // Delete from DB (The server action only deletes one item, we might need to handle cascade on server or here)
        // ideally DB cascade, but let's just delete the port which might fail if FK constraints exist
        // Prisma schema doesn't have explicit onDelete: Cascade in current view? 
        // Let's check schema.prisma later. For now, we call deletePort.
        await DBActions.deletePort(portId);
    };

    const handleDeleteCluster = async (id: string) => {
        setTerminals(prev => {
            // Logic is complex for cascade, for now just update local state
            const portsInCluster = userPorts.filter(p => p.clusterId === id);
            const portIds = portsInCluster.map(p => p.id);
            return prev.filter(t => !portIds.includes(t.portId));
        });

        setUserPorts(prev => prev.filter(p => p.clusterId !== id));
        setUserClusters(prev => prev.filter(c => c.id !== id));
        setSelection(null);

        await DBActions.deleteCluster(id);
    };

    // Update Handlers
    const handleUpdateTerminal = async (updated: Terminal) => {
        setTerminals(prev => prev.map(t => t.id === updated.id ? updated : t));
        await DBActions.updateTerminal(updated);
    };

    const handleUpdatePort = async (updated: Port) => {
        setUserPorts(prev => prev.map(p => p.id === updated.id ? updated : p));
        await DBActions.updatePort(updated);
    }

    const handleUpdateCluster = async (updated: Cluster) => {
        setUserClusters(prev => prev.map(c => c.id === updated.id ? updated : c));
        await DBActions.updateCluster(updated);
    }

    // Selection Resolution
    const selectedTerminal = selection?.type === "terminal" ? terminals.find(t => t.id === selection.id) : null;
    const selectedPort = selection?.type === "port" ? userPorts.find(p => p.id === selection.id) : null;
    const selectedCluster = selection?.type === "cluster" ? userClusters.find(c => c.id === selection.id) : null;

    // Filtered Terminals for Map (depends on selection)
    const mapTerminals = useMemo(() => {
        let base = filteredTerminals;

        if (selection?.type === "port") {
            base = base.filter(t => t.portId === selection.id);
        } else if (selection?.type === "cluster") {
            // Get all ports in this cluster
            const clusterPorts = userPorts.filter(p => p.clusterId === selection.id);
            const portIds = clusterPorts.map(p => p.id);
            base = base.filter(t => portIds.includes(t.portId));
        }

        return base;
    }, [filteredTerminals, selection, userPorts]);

    const handleClearSelection = () => {
        setSelection(null);
    };

    return (
        <div className="flex h-screen w-full overflow-hidden bg-white">
            {/* Left Sidebar: Lean Action Bar */}
            <div className="w-80 flex-shrink-0 flex flex-col border-r border-gray-200 bg-gray-50 z-20 shadow-sm">
                <div className="p-4 border-b bg-white">
                    {/* <h1 className="text-xl font-bold text-slate-800">PortPass</h1> */}
                    <img src="/brand/logo.png" alt="PortPass Logo" className="h-8 object-contain" />
                    <p className="text-xs text-slate-500 mt-1 font-clash">Identity Layer v1.2</p>
                </div>

                <div className="flex-1 w-full p-4">
                    <p className="text-sm text-gray-500 italic">Select an item from the tree on the right to view details.</p>
                </div>

                <ActionPanel
                    onAddCluster={handleCreateNewCluster}
                    onAddPort={handleCreateNewPort}
                    onAddTerminal={handleCreateNewTerminal}
                />
            </div>

            {/* Center: Map */}
            <div className="flex-1 relative">
                <MapView
                    terminals={mapTerminals}
                    ports={userPorts}
                    clusters={userClusters}
                    selectedClusterId={selectedClusterId === "ALL" ? undefined : selectedClusterId}
                    onSelectTerminal={(id) => setSelection({ type: "terminal", id })}
                    onClearSelection={handleClearSelection}
                    hasActiveFilter={selection?.type === "port" || selection?.type === "cluster"}
                />
            </div>

            {/* Right Sidebar: Master-Detail (Tree vs Details) */}
            <div className="w-96 flex-shrink-0 border-l border-gray-200 bg-white z-20 shadow-lg flex flex-col overflow-y-auto">
                {selection === null ? (
                    /* Master View: Filter & Tree */
                    <>
                        <FilterPanel
                            clusters={userClusters}
                            selectedClusterId={selectedClusterId}
                            onSelectCluster={setSelectedClusterId}
                            searchQuery={searchQuery}
                            onSearchChange={setSearchQuery}
                        />
                        <div className="flex-1 overflow-y-auto">
                            <TerminalList
                                treeData={treeData}
                                selectedTerminalId={null} // No highlighting needed in master view initially
                                onSelectTerminal={(id: string) => setSelection({ type: "terminal", id })}
                                onSelectPort={(id: string) => setSelection({ type: "port", id })}
                                onSelectCluster={(id: string) => setSelection({ type: "cluster", id })}
                            />
                        </div>
                    </>
                ) : (
                    /* Detail Views */
                    <>
                        {selectedTerminal && (
                            <TerminalDetail
                                terminal={selectedTerminal}
                                ports={userPorts}
                                clusters={userClusters}
                                onClose={() => setSelection(null)}
                                onUpdate={handleUpdateTerminal}
                                onDelete={() => handleDeleteTerminal(selectedTerminal.id)}
                            />
                        )}

                        {selectedPort && (
                            <PortDetail
                                port={selectedPort}
                                clusters={userClusters}
                                onClose={() => setSelection(null)}
                                onUpdate={handleUpdatePort}
                                onDelete={() => handleDeletePort(selectedPort.id)}
                            />
                        )}

                        {selectedCluster && (
                            <ClusterDetail
                                cluster={selectedCluster}
                                onClose={() => setSelection(null)}
                                onUpdate={handleUpdateCluster}
                                onDelete={() => handleDeleteCluster(selectedCluster.id)}
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
