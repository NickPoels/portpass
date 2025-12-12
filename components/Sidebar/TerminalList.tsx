"use client";

import { Cluster, Port, Terminal } from "@/lib/types";
import { ChevronRight, ChevronDown, Box, Pencil } from "lucide-react";
import { useState } from "react";

// Intermediate type for the tree structure props
interface TreeCluster extends Cluster {
    ports: (Port & { terminals: Terminal[] })[];
}

interface TerminalListProps {
    treeData: TreeCluster[];
    selectedTerminalId: string | null;
    onSelectTerminal: (id: string) => void;
    onSelectCluster: (id: string) => void;
    onSelectPort: (id: string) => void;
    onZoomToTerminal: (id: string) => void;
    onZoomToPort: (id: string) => void;
    onZoomToCluster: (id: string) => void;
}

const ClusterGroup = ({ cluster, onSelect, onZoom, children }: { cluster: TreeCluster, onSelect: () => void, onZoom: () => void, children: React.ReactNode }) => {
    const [isOpen, setIsOpen] = useState(true);
    const [isHovered, setIsHovered] = useState(false);
    return (
        <div className="border-b border-gray-100 last:border-0">
            <div 
                className="flex w-full items-center bg-gray-100 group"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="px-2 py-2 hover:bg-gray-200 transition-colors"
                >
                    {isOpen ? <ChevronDown className="h-3 w-3 text-gray-500" /> : <ChevronRight className="h-3 w-3 text-gray-500" />}
                </button>
                <button
                    onClick={onZoom}
                    className="flex-1 text-left py-2 pr-2 text-xs font-bold text-gray-600 uppercase tracking-wider hover:text-blue-600"
                >
                    {cluster.name}
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect();
                    }}
                    className={`px-2 py-2 text-gray-400 hover:text-blue-600 hover:bg-gray-200 rounded transition-all ${
                        isHovered ? 'opacity-100' : 'opacity-0'
                    }`}
                    title="Edit cluster"
                >
                    <Pencil className="h-3 w-3" />
                </button>
            </div>
            {isOpen && <div>{children}</div>}
        </div>
    );
}

const TerminalItem = ({ terminal, isSelected, onSelect, onZoom }: { terminal: Terminal, isSelected: boolean, onSelect: () => void, onZoom: () => void }) => {
    const [isHovered, setIsHovered] = useState(false);
    
    return (
        <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={onZoom}
            className={`cursor-pointer group flex items-start px-3 py-2 text-sm border-l-2 ml-2 transition-colors ${isSelected
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-600"
                }`}
        >
            <img
                src="/terminal-icon.svg"
                alt="Terminal"
                className={`mt-0.5 mr-2 flex-shrink-0 object-contain ${isSelected ? "opacity-100" : "opacity-70 grayscale"}`}
                style={{ width: '16px', height: '16px' }}
            />
            <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{terminal.name}</p>
                <p className="text-[10px] text-gray-500">{terminal.cargoTypes[0] || '—'} • {terminal.ispsRiskLevel}</p>
            </div>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect();
                }}
                className={`ml-2 px-1.5 py-1 text-gray-400 hover:text-blue-600 hover:bg-gray-200 rounded transition-all ${
                    isHovered ? 'opacity-100' : 'opacity-0'
                }`}
                title="Edit terminal"
            >
                <Pencil className="h-3 w-3" />
            </button>
        </div>
    );
};

const PortGroup = ({ port, onSelect, onZoom, children }: { port: Port, onSelect: () => void, onZoom: () => void, children: React.ReactNode }) => {
    const [isOpen, setIsOpen] = useState(true);
    const [isHovered, setIsHovered] = useState(false);
    return (
        <div className="pl-2">
            <div 
                className="flex w-full items-center hover:bg-gray-50 group"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="px-2 py-1.5"
                >
                    <Box className="h-3.5 w-3.5 text-gray-400" />
                </button>
                <button
                    onClick={onZoom}
                    className="flex-1 text-left py-1.5 pr-2 text-sm font-semibold text-gray-800 hover:text-blue-600"
                >
                    {port.name}
                    <span className="ml-auto text-[10px] text-gray-400 font-normal pl-2">{port.country}</span>
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect();
                    }}
                    className={`px-2 py-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-200 rounded transition-all ${
                        isHovered ? 'opacity-100' : 'opacity-0'
                    }`}
                    title="Edit port"
                >
                    <Pencil className="h-3 w-3" />
                </button>
            </div>
            {isOpen && <div className="pl-4">{children}</div>}
        </div>
    )
}

export const TerminalList = ({
    treeData,
    selectedTerminalId,
    onSelectTerminal,
    onSelectCluster,
    onSelectPort,
    onZoomToTerminal,
    onZoomToPort,
    onZoomToCluster,
}: TerminalListProps) => {
    if (treeData.length === 0) {
        return (
            <div className="p-8 text-center text-gray-500 text-sm">
                No results found.
            </div>
        );
    }

    return (
        <div className="pb-4">
            {treeData.map((cluster) => (
                <ClusterGroup 
                    key={cluster.id} 
                    cluster={cluster} 
                    onSelect={() => onSelectCluster(cluster.id)}
                    onZoom={() => onZoomToCluster(cluster.id)}
                >
                    {cluster.ports.map(port => (
                        <PortGroup 
                            key={port.id} 
                            port={port} 
                            onSelect={() => onSelectPort(port.id)}
                            onZoom={() => onZoomToPort(port.id)}
                        >
                            {port.terminals.map(terminal => (
                                <TerminalItem
                                    key={terminal.id}
                                    terminal={terminal}
                                    isSelected={selectedTerminalId === terminal.id}
                                    onSelect={() => onSelectTerminal(terminal.id)}
                                    onZoom={() => onZoomToTerminal(terminal.id)}
                                />
                            ))}
                            {port.terminals.length === 0 && (
                                <div className="pl-8 py-1 text-xs text-gray-400 italic">No terminals filtered</div>
                            )}
                        </PortGroup>
                    ))}
                </ClusterGroup>
            ))}
        </div>
    );
};
