"use client";

import { useState, useEffect } from "react";
import { X, Check, XCircle, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

interface OperatorProposal {
    id: string;
    name: string;
    portId: string;
    operatorType: string | null;
    parentCompanies: string | null;
    latitude: number | null;
    longitude: number | null;
    capacity: string | null;
    cargoTypes: string | null;
    status: string;
    port: {
        id: string;
        name: string;
        clusterId: string;
    };
}

interface OperatorProposalPanelProps {
    clusterId?: string;
    portId?: string;
    onClose: () => void;
    onProposalsApproved?: () => void;
}

export const OperatorProposalPanel = ({ 
    clusterId, 
    portId, 
    onClose, 
    onProposalsApproved 
}: OperatorProposalPanelProps) => {
    const [proposals, setProposals] = useState<OperatorProposal[]>([]);
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

            const response = await fetch(`/api/operator-proposals?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to load proposals');
            
            const data = await response.json();
            setProposals(data);
        } catch (error) {
            console.error('Error loading proposals:', error);
            toast.error('Failed to load operator proposals');
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
            const response = await fetch('/api/operator-proposals/batch-approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proposalIds: Array.from(selectedIds),
                    action
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to process proposals');
            }

            const result = await response.json();
            
            if (action === 'approve') {
                toast.success(`Approved ${result.approvedCount} operator(s). Created ${result.createdOperators.length} operator(s).`);
            } else {
                toast.success(`Rejected ${result.rejectedCount} operator(s).`);
            }

            setSelectedIds(new Set());
            await loadProposals();
            
            if (onProposalsApproved) {
                onProposalsApproved();
            }
        } catch (error) {
            toast.error(`Failed to ${action} proposals: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsProcessing(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col h-full bg-white shadow-xl">
                <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-900">Operator Proposals</h2>
                    <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white shadow-xl">
            <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
                <h2 className="text-lg font-bold text-gray-900">Operator Proposals</h2>
                <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200">
                    <X className="h-5 w-5" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {proposals.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <p>No pending operator proposals</p>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">
                                {proposals.length} proposal(s)
                            </span>
                            <div className="flex items-center space-x-2">
                                <button
                                    onClick={handleSelectAll}
                                    className="text-xs text-blue-600 hover:text-blue-800"
                                >
                                    {selectedIds.size === proposals.length ? 'Deselect All' : 'Select All'}
                                </button>
                            </div>
                        </div>

                        {selectedIds.size > 0 && (
                            <div className="flex space-x-2">
                                <button
                                    onClick={() => handleBatchAction('approve')}
                                    disabled={isProcessing}
                                    className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                                >
                                    <Check className="w-4 h-4" />
                                    <span>Approve ({selectedIds.size})</span>
                                </button>
                                <button
                                    onClick={() => handleBatchAction('reject')}
                                    disabled={isProcessing}
                                    className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                                >
                                    <XCircle className="w-4 h-4" />
                                    <span>Reject ({selectedIds.size})</span>
                                </button>
                            </div>
                        )}

                        <div className="space-y-2">
                            {proposals.map((proposal) => {
                                const parentCompanies = proposal.parentCompanies ? JSON.parse(proposal.parentCompanies) : null;
                                const cargoTypes = proposal.cargoTypes ? JSON.parse(proposal.cargoTypes) : null;
                                
                                return (
                                    <div
                                        key={proposal.id}
                                        className={`border rounded-lg p-3 cursor-pointer transition-all ${
                                            selectedIds.has(proposal.id)
                                                ? 'border-blue-500 bg-blue-50'
                                                : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                        onClick={() => handleToggleSelect(proposal.id)}
                                    >
                                        <div className="flex items-start space-x-3">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(proposal.id)}
                                                onChange={() => handleToggleSelect(proposal.id)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center space-x-2">
                                                    <h4 className="font-semibold text-gray-900">{proposal.name}</h4>
                                                    {proposal.operatorType && (
                                                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                                                            proposal.operatorType === 'commercial' 
                                                                ? 'bg-blue-100 text-blue-800' 
                                                                : 'bg-green-100 text-green-800'
                                                        }`}>
                                                            {proposal.operatorType === 'commercial' ? 'Commercial' : 'Captive'}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-gray-600 mt-1">{proposal.port.name}</p>
                                                {parentCompanies && parentCompanies.length > 0 && (
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Parent: {parentCompanies.join(', ')}
                                                    </p>
                                                )}
                                                {proposal.capacity && (
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Capacity: {proposal.capacity}
                                                    </p>
                                                )}
                                                {cargoTypes && cargoTypes.length > 0 && (
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Cargo: {cargoTypes.join(', ')}
                                                    </p>
                                                )}
                                                {(proposal.latitude && proposal.longitude) ? (
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Location: {proposal.latitude.toFixed(4)}, {proposal.longitude.toFixed(4)}
                                                    </p>
                                                ) : (
                                                    <p className="text-xs text-gray-400 mt-1">Location unknown</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
