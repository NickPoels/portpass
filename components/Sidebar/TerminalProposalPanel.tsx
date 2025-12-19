"use client";

import { useState, useEffect } from "react";
import { X, Check, XCircle, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

interface TerminalProposal {
    id: string;
    name: string;
    portId: string;
    latitude: number | null;
    longitude: number | null;
    cargoTypes: string;
    operatorGroup: string | null;
    capacity: string | null;
    confidence: number;
    source: string;
    status: string;
    port: {
        id: string;
        name: string;
        clusterId: string;
    };
}

interface TerminalProposalPanelProps {
    clusterId?: string;
    portId?: string;
    onClose: () => void;
    onProposalsApproved?: () => void;
}

export const TerminalProposalPanel = ({ 
    clusterId, 
    portId, 
    onClose, 
    onProposalsApproved 
}: TerminalProposalPanelProps) => {
    const [proposals, setProposals] = useState<TerminalProposal[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        loadProposals();
        // Poll for new proposals every 5 seconds
        const interval = setInterval(loadProposals, 5000);
        return () => clearInterval(interval);
    }, [clusterId, portId]);

    const loadProposals = async () => {
        try {
            const params = new URLSearchParams();
            if (clusterId) params.append('clusterId', clusterId);
            if (portId) params.append('portId', portId);
            params.append('status', 'pending');

            const response = await fetch(`/api/terminal-proposals?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to load proposals');
            
            const data = await response.json();
            setProposals(data);
        } catch (error) {
            console.error('Error loading proposals:', error);
            toast.error('Failed to load terminal proposals');
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleSelectAll = () => {
        if (selectedIds.size === proposals.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(proposals.map(p => p.id)));
        }
    };

    const handleBatchAction = async (action: 'approve' | 'reject') => {
        if (selectedIds.size === 0) {
            toast.error('Please select at least one proposal');
            return;
        }

        setIsProcessing(true);
        try {
            const response = await fetch('/api/terminal-proposals/batch-approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proposalIds: Array.from(selectedIds),
                    action
                })
            });

            if (!response.ok) throw new Error('Failed to process proposals');

            const result = await response.json();
            toast.success(
                action === 'approve' 
                    ? `Approved ${result.approvedCount} proposal(s). Created ${result.createdTerminals.length} terminal(s).`
                    : `Rejected ${result.rejectedCount} proposal(s).`
            );

            setSelectedIds(new Set());
            await loadProposals();
            onProposalsApproved?.();
        } catch (error) {
            toast.error(`Failed to ${action} proposals: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const parseCargoTypes = (cargoTypesStr: string): string[] => {
        try {
            return JSON.parse(cargoTypesStr);
        } catch {
            return [];
        }
    };

    const confidenceColor = (confidence: number) => {
        if (confidence >= 0.8) return 'text-green-600 bg-green-50';
        if (confidence >= 0.6) return 'text-yellow-600 bg-yellow-50';
        return 'text-red-600 bg-red-50';
    };

    if (isLoading) {
        return (
            <div className="flex flex-col h-full bg-white shadow-xl">
                <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-900">Terminal Proposals</h2>
                    <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white shadow-xl">
            <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50 sticky top-0 z-10">
                <h2 className="text-lg font-bold text-gray-900">
                    Terminal Proposals ({proposals.length})
                </h2>
                <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200">
                    <X className="h-5 w-5" />
                </button>
            </div>

            {proposals.length === 0 ? (
                <div className="flex-1 flex items-center justify-center p-8">
                    <div className="text-center">
                        <p className="text-gray-500 text-sm">No pending terminal proposals</p>
                        <p className="text-gray-400 text-xs mt-2">Start a research pipeline to discover terminals</p>
                    </div>
                </div>
            ) : (
                <>
                    <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={selectedIds.size === proposals.length && proposals.length > 0}
                                onChange={handleSelectAll}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">
                                Select All ({selectedIds.size} selected)
                            </span>
                        </label>
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={() => handleBatchAction('approve')}
                                disabled={selectedIds.size === 0 || isProcessing}
                                className="flex items-center space-x-1 px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Check className="w-4 h-4" />
                                <span>Approve ({selectedIds.size})</span>
                            </button>
                            <button
                                onClick={() => handleBatchAction('reject')}
                                disabled={selectedIds.size === 0 || isProcessing}
                                className="flex items-center space-x-1 px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <XCircle className="w-4 h-4" />
                                <span>Reject ({selectedIds.size})</span>
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {proposals.map((proposal) => (
                            <div
                                key={proposal.id}
                                className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                                    selectedIds.has(proposal.id)
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-200 hover:border-gray-300'
                                }`}
                                onClick={() => handleToggleSelect(proposal.id)}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start space-x-3 flex-1">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(proposal.id)}
                                            onChange={() => handleToggleSelect(proposal.id)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center space-x-2">
                                                <h3 className="font-semibold text-gray-900">{proposal.name}</h3>
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${confidenceColor(proposal.confidence)}`}>
                                                    {(proposal.confidence * 100).toFixed(0)}% confidence
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 mt-1">
                                                Port: {proposal.port.name}
                                            </p>
                                            {proposal.operatorGroup && (
                                                <p className="text-sm text-gray-600">Operator: {proposal.operatorGroup}</p>
                                            )}
                                            {parseCargoTypes(proposal.cargoTypes).length > 0 && (
                                                <p className="text-sm text-gray-600">
                                                    Cargo: {parseCargoTypes(proposal.cargoTypes).join(', ')}
                                                </p>
                                            )}
                                            {proposal.capacity && (
                                                <p className="text-sm text-gray-600">Capacity: {proposal.capacity}</p>
                                            )}
                                            {(proposal.latitude && proposal.longitude) && (
                                                <p className="text-xs text-gray-500">
                                                    Location: {proposal.latitude.toFixed(4)}, {proposal.longitude.toFixed(4)}
                                                </p>
                                            )}
                                            <p className="text-xs text-gray-400 mt-1">
                                                Source: {proposal.source === 'port_research' ? 'Port Research' : 'Manual'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};



