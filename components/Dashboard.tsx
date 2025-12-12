"use client";

import { useState, useMemo, useEffect } from "react";
import * as DBActions from "@/app/actions";
import { Terminal, Cluster, Port, ClusterId } from "@/lib/types";
import dynamic from "next/dynamic";
import toast from "react-hot-toast";
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
    // #region agent log
    if (typeof window !== 'undefined') {
      console.log('[Dashboard] Rendering with:', {
        terminalsCount: initialTerminals.length,
        portsCount: ports.length,
        clustersCount: clusters.length,
        firstPortKeys: ports[0] ? Object.keys(ports[0]) : [],
        firstTerminalKeys: initialTerminals[0] ? Object.keys(initialTerminals[0]) : []
      });
    }
    // #endregion
    const [terminals, setTerminals] = useState<Terminal[]>(initialTerminals);
    const [userPorts, setUserPorts] = useState<Port[]>(ports);
    const [userClusters, setUserClusters] = useState<Cluster[]>(clusters);

    const [selection, setSelection] = useState<Selection>(null);

    // Filter State
    const [selectedClusterId, setSelectedClusterId] = useState<ClusterId | "ALL">("ALL");
    const [searchQuery, setSearchQuery] = useState("");

    // Zoom State (separate from selection - only zooms, doesn't open details)
    const [zoomToClusterId, setZoomToClusterId] = useState<string | undefined>(undefined);
    const [zoomToPortId, setZoomToPortId] = useState<string | undefined>(undefined);
    const [zoomToTerminalId, setZoomToTerminalId] = useState<string | undefined>(undefined);


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
            toast.error("No ports available to create a terminal in.");
            return;
        }

        // Calculate default coordinates from port's terminals, or use Europe center
        const portTerminals = filteredTerminals.filter(t => t.portId === defaultPort.id);
        let defaultLat = 48.0; // Europe center
        let defaultLng = 10.0;
        
        if (portTerminals.length > 0) {
            const lats = portTerminals.map(t => t.latitude);
            const lngs = portTerminals.map(t => t.longitude);
            defaultLat = lats.reduce((a, b) => a + b, 0) / lats.length;
            defaultLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
        }

        const newTerminal: Terminal = {
            id: newId,
            name: "New Terminal",
            portId: defaultPort.id,
            latitude: defaultLat,
            longitude: defaultLng,
            cargoTypes: [],
            capacity: "Unknown",
            ispsRiskLevel: "Low",
            notes: ""
        };
        setTerminals(prev => [...prev, newTerminal]);
        setSelection({ type: "terminal", id: newId });

        try {
            await DBActions.createTerminal(newTerminal);
            toast.success('Terminal created successfully');
        } catch (error) {
            toast.error(`Failed to create terminal: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setTerminals(prev => prev.filter(t => t.id !== newId));
            setSelection(null);
        }
    };

    const handleCreateNewPort = async () => {
        const newId = `p-${Date.now()}`;
        const defaultCluster = userClusters[0];

        if (!defaultCluster) {
            toast.error("No clusters available.");
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

        try {
            await DBActions.createPort(newPort);
            toast.success('Port created successfully');
        } catch (error) {
            toast.error(`Failed to create port: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setUserPorts(prev => prev.filter(p => p.id !== newId));
            setSelection(null);
        }
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

        try {
            await DBActions.createCluster(newCluster);
            toast.success('Cluster created successfully');
        } catch (error) {
            toast.error(`Failed to create cluster: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setUserClusters(prev => prev.filter(c => c.id !== newCluster.id));
            setSelection(null);
        }
    };

    // Deletion Handlers
    const handleDeleteTerminal = async (id: string) => {
        const terminal = terminals.find(t => t.id === id);
        setTerminals(prev => prev.filter(t => t.id !== id));
        setSelection(null);
        
        try {
            await DBActions.deleteTerminal(id);
            toast.success('Terminal deleted successfully');
        } catch (error) {
            toast.error(`Failed to delete terminal: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (terminal) {
                setTerminals(prev => [...prev, terminal]);
            }
        }
    };

    const handleDeletePort = async (id: string) => {
        const portId = id;
        const port = userPorts.find(p => p.id === portId);
        const terminalsToRestore = terminals.filter(t => t.portId === portId);
        
        // Cascade: Delete terminals in this port
        setTerminals(prev => prev.filter(t => t.portId !== portId));
        // Delete the port
        setUserPorts(prev => prev.filter(p => p.id !== portId));
        setSelection(null);

        try {
            await DBActions.deletePort(portId);
            toast.success('Port deleted successfully');
        } catch (error) {
            toast.error(`Failed to delete port: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (port) {
                setUserPorts(prev => [...prev, port]);
            }
            setTerminals(prev => [...prev, ...terminalsToRestore]);
        }
    };

    const handleDeleteCluster = async (id: string) => {
        const cluster = userClusters.find(c => c.id === id);
        const portsInCluster = userPorts.filter(p => p.clusterId === id);
        const portIds = portsInCluster.map(p => p.id);
        const terminalsToRestore = terminals.filter(t => portIds.includes(t.portId));
        
        setTerminals(prev => prev.filter(t => !portIds.includes(t.portId)));
        setUserPorts(prev => prev.filter(p => p.clusterId !== id));
        setUserClusters(prev => prev.filter(c => c.id !== id));
        setSelection(null);

        try {
            await DBActions.deleteCluster(id);
            toast.success('Cluster deleted successfully');
        } catch (error) {
            toast.error(`Failed to delete cluster: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (cluster) {
                setUserClusters(prev => [...prev, cluster]);
            }
            setUserPorts(prev => [...prev, ...portsInCluster]);
            setTerminals(prev => [...prev, ...terminalsToRestore]);
        }
    };

    // Update Handlers
    const handleUpdateTerminal = async (updated: Terminal) => {
        const previous = terminals.find(t => t.id === updated.id);
        setTerminals(prev => prev.map(t => t.id === updated.id ? updated : t));
        
        try {
            await DBActions.updateTerminal(updated);
            toast.success('Terminal updated successfully');
        } catch (error) {
            toast.error(`Failed to update terminal: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (previous) {
                setTerminals(prev => prev.map(t => t.id === updated.id ? previous : t));
            }
        }
    };

    const handleUpdatePort = async (updated: Port) => {
        const previous = userPorts.find(p => p.id === updated.id);
        setUserPorts(prev => prev.map(p => p.id === updated.id ? updated : p));
        
        try {
            await DBActions.updatePort(updated);
            toast.success('Port updated successfully');
        } catch (error) {
            toast.error(`Failed to update port: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (previous) {
                setUserPorts(prev => prev.map(p => p.id === updated.id ? previous : p));
            }
        }
    }

    const handleUpdateCluster = async (updated: Cluster) => {
        const previous = userClusters.find(c => c.id === updated.id);
        setUserClusters(prev => prev.map(c => c.id === updated.id ? updated : c));
        
        try {
            await DBActions.updateCluster(updated);
            toast.success('Cluster updated successfully');
        } catch (error) {
            toast.error(`Failed to update cluster: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (previous) {
                setUserClusters(prev => prev.map(c => c.id === updated.id ? previous : c));
            }
        }
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

    // Zoom Handlers (only zoom, don't open details)
    const handleZoomToCluster = (id: string) => {
        setZoomToClusterId(id);
        // Clear port/terminal zoom when zooming to cluster
        setZoomToPortId(undefined);
        setZoomToTerminalId(undefined);
    };

    const handleZoomToPort = (id: string) => {
        setZoomToPortId(id);
        // Clear cluster/terminal zoom when zooming to port
        setZoomToClusterId(undefined);
        setZoomToTerminalId(undefined);
    };

    const handleZoomToTerminal = (id: string) => {
        setZoomToTerminalId(id);
        // Clear cluster/port zoom when zooming to terminal
        setZoomToClusterId(undefined);
        setZoomToPortId(undefined);
    };

    return (
        <div className="flex h-screen w-full overflow-hidden bg-white">
            {/* Left Sidebar: Lean Action Bar */}
            <div className="w-60 flex-shrink-0 flex flex-col border-r border-gray-200 bg-gray-50 z-20 shadow-sm">
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
                    zoomToClusterId={zoomToClusterId}
                    zoomToPortId={zoomToPortId}
                    zoomToTerminalId={zoomToTerminalId}
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
                                onZoomToTerminal={handleZoomToTerminal}
                                onZoomToPort={handleZoomToPort}
                                onZoomToCluster={handleZoomToCluster}
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
