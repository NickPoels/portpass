"use client";

import { useState, useMemo, useEffect } from "react";
import * as DBActions from "@/app/actions";
import { TerminalOperator, Cluster, Port, ClusterId, TerminalOperatorProposal } from "@/lib/types";
import dynamic from "next/dynamic";
import toast from "react-hot-toast";
import { FilterPanel } from "./Sidebar/FilterPanel";
import { ActionPanel } from "./Sidebar/ActionPanel";
import { OperatorList } from "./Sidebar/OperatorList";
import { OperatorDetail } from "./Sidebar/OperatorDetail";
import { ClusterDetail } from "./Sidebar/ClusterDetail";
import { PortDetail } from "./Sidebar/PortDetail";
import { DataQualityPanel } from "./Sidebar/DataQualityPanel";

// Dynamic import for Map to avoid SSR
const MapView = dynamic(() => import("./Map/MapView"), { ssr: false });

interface DashboardProps {
    initialOperators: TerminalOperator[];
    ports: Port[];
    clusters: Cluster[];
}

type Selection =
    | { type: "operator", id: string }
    | { type: "port", id: string }
    | { type: "cluster", id: string }
    | { type: "proposals", clusterId?: string, portId?: string }
    | { type: "data-quality" }
    | null;

export default function Dashboard({ initialOperators, ports, clusters }: DashboardProps) {
    const [operators, setOperators] = useState<TerminalOperator[]>(initialOperators);
    const [userPorts, setUserPorts] = useState<Port[]>(ports);
    const [userClusters, setUserClusters] = useState<Cluster[]>(clusters);
    const [proposalsForMap, setProposalsForMap] = useState<TerminalOperatorProposal[]>([]);
    const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);

    const [selection, setSelection] = useState<Selection>(null);

    // Filter State
    const [selectedClusterId, setSelectedClusterId] = useState<ClusterId | "ALL">("ALL");
    const [searchQuery, setSearchQuery] = useState("");

    // Zoom State (separate from selection - only zooms, doesn't open details)
    const [zoomToClusterId, setZoomToClusterId] = useState<string | undefined>(undefined);
    const [zoomToPortId, setZoomToPortId] = useState<string | undefined>(undefined);
    const [zoomToOperatorId, setZoomToOperatorId] = useState<string | undefined>(undefined);


    // Sync state when props change (e.g. after server revalidation)
    useEffect(() => {
        setOperators(initialOperators);
    }, [initialOperators]);

    useEffect(() => {
        setUserPorts(ports);
    }, [ports]);

    useEffect(() => {
        setUserClusters(clusters);
    }, [clusters]);

    // Helper to resolve port for an operator
    const getPort = useMemo(() => {
        return (operator: TerminalOperator) => userPorts.find(p => p.id === operator.portId);
    }, [userPorts]);

    // Derived State
    const filteredOperators = useMemo(() => {
        return operators.filter(o => {
            const port = getPort(o);
            if (!port) return false;

            const matchesCluster = selectedClusterId === "ALL" || port.clusterId === selectedClusterId;
            const matchesSearch = o.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                port.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                port.country.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesCluster && matchesSearch;
        });
    }, [operators, selectedClusterId, searchQuery, getPort]);

    // Derived Tree Data for Sidebar (Cluster -> Port -> Operators)
    const treeData = useMemo(() => {
        const filteredPorts = userPorts.filter(p =>
            selectedClusterId === "ALL" || p.clusterId === selectedClusterId
        );

        const clusterGroups = userClusters
            .filter(c => selectedClusterId === "ALL" || c.id === selectedClusterId)
            .map(cluster => {
                const clusterPorts = filteredPorts.filter(p => p.clusterId === cluster.id);

                const portsWithOperators = clusterPorts.map(port => ({
                    ...port,
                    operators: filteredOperators.filter(o => o.portId === port.id)
                })).filter(p => p.operators.length > 0 || searchQuery === "");

                return {
                    ...cluster,
                    ports: portsWithOperators
                };
            }).filter(c => c.ports.length > 0 || searchQuery === "");

        return clusterGroups;
    }, [userClusters, userPorts, filteredOperators, selectedClusterId, searchQuery]);

    // Creation Handlers
    const handleCreateNewOperator = async () => {
        const newId = `op-${Date.now()}`;
        const defaultPort = userPorts[0];

        if (!defaultPort) {
            toast.error("No ports available to create an operator in.");
            return;
        }

        // Calculate default coordinates from port's operators, or use port coordinates, or use Europe center
        const portOperators = filteredOperators.filter(o => o.portId === defaultPort.id);
        let defaultLat = defaultPort.latitude || 48.0; // Use port coordinates or Europe center
        let defaultLng = defaultPort.longitude || 10.0;
        
        if (portOperators.length > 0 && portOperators[0].latitude && portOperators[0].longitude) {
            const lats = portOperators.filter(o => o.latitude).map(o => o.latitude!);
            const lngs = portOperators.filter(o => o.longitude).map(o => o.longitude!);
            if (lats.length > 0 && lngs.length > 0) {
                defaultLat = lats.reduce((a, b) => a + b, 0) / lats.length;
                defaultLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
            }
        }

        const newOperator: TerminalOperator = {
            id: newId,
            name: "New Terminal Operator",
            portId: defaultPort.id,
            capacity: null,
            cargoTypes: [],
            operatorType: "commercial",
            parentCompanies: null,
            strategicNotes: null,
            latitude: defaultLat,
            longitude: defaultLng,
            locations: null,
            lastDeepResearchAt: null,
            lastDeepResearchSummary: null,
            lastDeepResearchReport: null
        };
        setOperators(prev => [...prev, newOperator]);
        setSelection({ type: "operator", id: newId });

        try {
            await DBActions.createTerminalOperator(newOperator);
            toast.success('Terminal operator created successfully');
        } catch (error) {
            toast.error(`Failed to create operator: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setOperators(prev => prev.filter(o => o.id !== newId));
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
    const handleDeleteOperator = async (id: string) => {
        const operator = operators.find(o => o.id === id);
        setOperators(prev => prev.filter(o => o.id !== id));
        setSelection(null);
        
        try {
            await DBActions.deleteTerminalOperator(id);
            toast.success('Terminal operator deleted successfully');
        } catch (error) {
            toast.error(`Failed to delete operator: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (operator) {
                setOperators(prev => [...prev, operator]);
            }
        }
    };

    const handleDeletePort = async (id: string) => {
        const portId = id;
        const port = userPorts.find(p => p.id === portId);
        const operatorsToRestore = operators.filter(o => o.portId === portId);
        
        // Cascade: Delete operators in this port
        setOperators(prev => prev.filter(o => o.portId !== portId));
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
            setOperators(prev => [...prev, ...operatorsToRestore]);
        }
    };

    const handleDeleteCluster = async (id: string) => {
        const cluster = userClusters.find(c => c.id === id);
        const portsInCluster = userPorts.filter(p => p.clusterId === id);
        const portIds = portsInCluster.map(p => p.id);
        const operatorsToRestore = operators.filter(o => portIds.includes(o.portId));
        
        setOperators(prev => prev.filter(o => !portIds.includes(o.portId)));
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
            setOperators(prev => [...prev, ...operatorsToRestore]);
        }
    };

    // Update Handlers
    const handleUpdateOperator = async (updated: TerminalOperator) => {
        const previous = operators.find(o => o.id === updated.id);
        setOperators(prev => prev.map(o => o.id === updated.id ? updated : o));
        
        try {
            await DBActions.updateTerminalOperator(updated);
            toast.success('Terminal operator updated successfully');
        } catch (error) {
            toast.error(`Failed to update operator: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (previous) {
                setOperators(prev => prev.map(o => o.id === updated.id ? previous : o));
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
    const selectedOperator = selection?.type === "operator" ? operators.find(o => o.id === selection.id) : null;
    const selectedPort = selection?.type === "port" ? userPorts.find(p => p.id === selection.id) : null;
    const selectedCluster = selection?.type === "cluster" ? userClusters.find(c => c.id === selection.id) : null;

    // Filtered Operators for Map (depends on selection)
    const mapOperators = useMemo(() => {
        let base = filteredOperators;

        if (selection?.type === "port") {
            base = base.filter(o => o.portId === selection.id);
        } else if (selection?.type === "cluster") {
            // Get all ports in this cluster
            const clusterPorts = userPorts.filter(p => p.clusterId === selection.id);
            const portIds = clusterPorts.map(p => p.id);
            base = base.filter(o => portIds.includes(o.portId));
        }

        return base;
    }, [filteredOperators, selection, userPorts]);

    // Filtered Proposals for Map (only show proposals for selected port)
    const mapProposals = useMemo(() => {
        if (selection?.type === "port") {
            return proposalsForMap.filter(p => p.portId === selection.id);
        }
        return [];
    }, [proposalsForMap, selection]);

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

    const handleZoomToOperator = (id: string) => {
        setZoomToOperatorId(id);
        // Clear cluster/port zoom when zooming to operator
        setZoomToClusterId(undefined);
        setZoomToPortId(undefined);
    };

    return (
        <div className="flex h-screen w-full overflow-hidden bg-white">
            {/* Left Sidebar: Logo + All Functionality */}
            <div className="w-96 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white z-20 shadow-lg">
                {/* Logo Section */}
                <div className="p-4 border-b bg-white">
                    <img src="/brand/logo.png" alt="PortPass Logo" className="h-8 object-contain" />
                    <p className="text-xs text-slate-500 mt-1 font-clash">Identity Layer v1.2</p>
                </div>

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
                            <OperatorList
                                treeData={treeData}
                                selectedOperatorId={null} // No highlighting needed in master view initially
                                onSelectOperator={(id: string) => setSelection({ type: "operator", id })}
                                onSelectPort={(id: string) => setSelection({ type: "port", id })}
                                onSelectCluster={(id: string) => setSelection({ type: "cluster", id })}
                                onZoomToOperator={handleZoomToOperator}
                                onZoomToPort={handleZoomToPort}
                                onZoomToCluster={handleZoomToCluster}
                            />
                        </div>
                        <ActionPanel
                            onAddCluster={handleCreateNewCluster}
                            onAddPort={handleCreateNewPort}
                            onAddTerminal={handleCreateNewOperator}
                            onViewProposals={() => setSelection({ type: "proposals" })}
                            onDataQualityCheck={() => setSelection({ type: "data-quality" })}
                        />
                    </>
                ) : (
                    /* Detail Views */
                    <div className="flex-1 overflow-y-auto">
                        {selectedOperator && (
                            <OperatorDetail
                                operator={selectedOperator}
                                ports={userPorts}
                                clusters={userClusters}
                                onClose={() => setSelection(null)}
                                onUpdate={handleUpdateOperator}
                                onDelete={() => handleDeleteOperator(selectedOperator.id)}
                            />
                        )}

                        {selectedPort && (
                            <PortDetail
                                port={selectedPort}
                                clusters={userClusters}
                                onClose={() => setSelection(null)}
                                onUpdate={handleUpdatePort}
                                onDelete={() => handleDeletePort(selectedPort.id)}
                                onProposalsChange={setProposalsForMap}
                                selectedProposalId={selectedProposalId}
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

                        {selection?.type === "proposals" && (
                            <div className="flex flex-col h-full bg-white shadow-xl">
                                <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
                                    <h2 className="text-lg font-bold text-gray-900">Operator Proposals</h2>
                                    <button onClick={() => setSelection(null)} className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200">
                                        <span>×</span>
                                    </button>
                                </div>
                                <div className="flex-1 flex items-center justify-center p-8">
                                    <div className="text-center">
                                        <p className="text-gray-500 text-sm">Operator proposals are now managed at the port level.</p>
                                        <p className="text-gray-400 text-xs mt-2">Open a port to find and approve terminal operators.</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {selection?.type === "data-quality" && (
                            <DataQualityPanel onClose={() => setSelection(null)} />
                        )}
                    </div>
                )}
            </div>

            {/* Center: Map */}
            <div className="flex-1 relative">
                <MapView
                    operators={mapOperators}
                    ports={userPorts}
                    clusters={userClusters}
                    proposals={mapProposals}
                    selectedClusterId={selectedClusterId === "ALL" ? undefined : selectedClusterId}
                    zoomToClusterId={zoomToClusterId}
                    zoomToPortId={zoomToPortId}
                    zoomToOperatorId={zoomToOperatorId}
                    onSelectOperator={(id) => setSelection({ type: "operator", id })}
                    onSelectProposal={(id) => setSelectedProposalId(id)}
                    onClearSelection={handleClearSelection}
                    hasActiveFilter={selection?.type === "port" || selection?.type === "cluster"}
                />
            </div>
        </div>
    );
}
