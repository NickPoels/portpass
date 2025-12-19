import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { TerminalOperator, Cluster, Port, CargoType, OperatorType, ParentCompany } from "@/lib/types";
import { X, Save, AlertTriangle, Copy, Check, RotateCw, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import * as DBActions from "@/app/actions";

interface OperatorDetailProps {
    operator: TerminalOperator;
    clusters: Cluster[];
    ports: Port[];
    onClose: () => void;
    onUpdate: (updated: TerminalOperator) => void;
    onDelete: () => void;
}

const CARGO_OPTIONS: CargoType[] = [
    "Container", "RoRo", "Dry Bulk", "Liquid Bulk", "Break Bulk", "Multipurpose", "Passenger/Ferry"
];

const OPERATOR_TYPE_OPTIONS: OperatorType[] = ["commercial", "captive"];

interface ProposedChanges {
    [key: string]: { from: any; to: any };
}

interface ErrorInfo {
    category: string;
    message: string;
    originalError?: string;
    retryable: boolean;
}

export const OperatorDetail = ({ operator, clusters, ports, onClose, onUpdate, onDelete }: OperatorDetailProps) => {
    const router = useRouter();
    const [formData, setFormData] = useState<TerminalOperator>(operator);
    const [isDirty, setIsDirty] = useState(false);
    const [isResearching, setIsResearching] = useState(false);
    const [researchStatus, setResearchStatus] = useState("");
    const [proposedChanges, setProposedChanges] = useState<ProposedChanges | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const [fullReport, setFullReport] = useState<string | null>(null);
    const [showFullReport, setShowFullReport] = useState(false);
    const [lastError, setLastError] = useState<ErrorInfo | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const [portChangeSuggestion, setPortChangeSuggestion] = useState<{ from: string; to: string; country: string } | null>(null);
    const [dataToUpdate, setDataToUpdate] = useState<any>(null);
    const [activityLog, setActivityLog] = useState<Array<{message: string, step: string, progress: number, timestamp: Date, completed: boolean}>>([]);
    const [currentProgress, setCurrentProgress] = useState(0);
    const [fieldProposals, setFieldProposals] = useState<Array<any>>([]);
    const [approvedFields, setApprovedFields] = useState<Set<string>>(new Set());
    const [notesProposal, setNotesProposal] = useState<{currentNotes: string, newFindings: string, combinedNotes: string} | null>(null);
    const [parentCompanies, setParentCompanies] = useState<ParentCompany[]>([]);
    const [newParentCompanyName, setNewParentCompanyName] = useState("");

    // Load parent companies for dropdown
    useEffect(() => {
        DBActions.getParentCompanies().then(setParentCompanies).catch(console.error);
    }, []);

    // Sync state when operator prop changes
    useEffect(() => {
        setFormData(operator);
        setIsDirty(false);
        
        // Load stored full research report from operator prop
        if (operator.lastDeepResearchReport && !fullReport) {
            setFullReport(operator.lastDeepResearchReport);
        }
    }, [operator]);

    const handleChange = (field: keyof TerminalOperator, value: TerminalOperator[keyof TerminalOperator]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setIsDirty(true);
    };

    const handleSave = () => {
        onUpdate(formData);
        setIsDirty(false);
    };

    const handleDelete = () => {
        if (window.confirm("Are you sure you want to delete this terminal operator? This action cannot be undone.")) {
            onDelete();
        }
    };

    const startDeepResearch = async (isRetry = false) => {
        if (!isRetry) {
            setRetryCount(0);
            setLastError(null);
        }
        
        setIsResearching(true);
        setResearchStatus("Starting research job...");
        setProposedChanges(null);
        setShowPreview(false);
        setFullReport(null);
        setPortChangeSuggestion(null);

        // Clear any existing polling
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }

        try {
            // Start a background research job
            const startResponse = await fetch(`/api/terminal-operators/${operator.id}/deep-research/start`, {
                method: "POST",
            });

            if (!startResponse.ok) {
                const errorData = await startResponse.json();
                throw new Error(errorData.message || errorData.error || 'Failed to start research job');
            }

            const startData = await startResponse.json();
            const jobId = startData.jobId;
            setCurrentJobId(jobId);
            setResearchStatus("Research job started. Processing in background...");
            setCurrentProgress(0);

            // Poll for job status
            const pollJobStatus = async () => {
                try {
                    const statusResponse = await fetch(`/api/research/jobs/${jobId}`);
                    if (!statusResponse.ok) {
                        throw new Error('Failed to get job status');
                    }

                    const job = await statusResponse.json();
                    setCurrentProgress(job.progress || 0);

                    if (job.status === 'completed') {
                        setIsResearching(false);
                        setResearchStatus("Research complete - Review changes");
                        
                        if (pollingIntervalRef.current) {
                            clearInterval(pollingIntervalRef.current);
                            pollingIntervalRef.current = null;
                        }
                        
                        router.refresh();
                        
                        setTimeout(() => {
                            setFullReport(null);
                        }, 500);
                        
                        toast.success('Research completed! Review the changes below.');
                        return;
                    } else if (job.status === 'failed') {
                        setIsResearching(false);
                        setResearchStatus("Research failed");
                        const errorInfo: ErrorInfo = {
                            category: 'JOB_ERROR',
                            message: job.error || 'Research job failed',
                            retryable: true
                        };
                        setLastError(errorInfo);
                        toast.error(job.error || 'Research job failed');
                        
                        if (pollingIntervalRef.current) {
                            clearInterval(pollingIntervalRef.current);
                            pollingIntervalRef.current = null;
                        }
                        return;
                    } else if (job.status === 'running' || job.status === 'pending') {
                        const progress = job.progress || 0;
                        setCurrentProgress(progress);
                        if (progress > 0) {
                            setResearchStatus(`Researching... (${progress}%)`);
                        } else {
                            setResearchStatus(job.status === 'pending' ? 'Job queued, waiting to start...' : 'Researching...');
                        }
                    }
                } catch (error) {
                    console.error('Error polling job status:', error);
                }
            };

            pollingIntervalRef.current = setInterval(pollJobStatus, 2000);
            pollJobStatus();

        } catch (e) {
            setIsResearching(false);
            setResearchStatus("Failed to start research");
            const errorInfo: ErrorInfo = {
                category: 'NETWORK_ERROR',
                message: e instanceof Error ? e.message : 'Failed to start research job',
                originalError: e instanceof Error ? e.message : String(e),
                retryable: true
            };
            setLastError(errorInfo);
            toast.error(errorInfo.message);
        }
    };

    const cancelResearch = () => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
        setIsResearching(false);
        setResearchStatus("Cancelled");
        setCurrentJobId(null);
        toast.success('Research monitoring stopped (job continues in background)');
    };
    
    useEffect(() => {
        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, []);

    const applyChanges = async () => {
        if (approvedFields.size === 0 && !notesProposal) {
            toast.error('Please approve at least one field to apply changes');
            return;
        }

        try {
            const updateData: any = {
                lastDeepResearchAt: new Date(),
                lastDeepResearchSummary: dataToUpdate?.lastDeepResearchSummary || '',
            };

            fieldProposals.forEach(proposal => {
                if (approvedFields.has(proposal.field)) {
                    if (proposal.field === 'coordinates' && typeof proposal.proposedValue === 'object' && proposal.proposedValue !== null) {
                        updateData.latitude = proposal.proposedValue.lat;
                        updateData.longitude = proposal.proposedValue.lon;
                    } else if (proposal.field === 'cargoTypes' && Array.isArray(proposal.proposedValue)) {
                        updateData.cargoTypes = JSON.stringify(proposal.proposedValue);
                    } else if (proposal.field === 'operatorType' && proposal.proposedValue !== null && proposal.proposedValue !== undefined) {
                        updateData.operatorType = proposal.proposedValue;
                    } else if (proposal.field === 'parentCompanies' && Array.isArray(proposal.proposedValue)) {
                        updateData.parentCompanies = JSON.stringify(proposal.proposedValue);
                    } else if (proposal.field === 'capacity' && proposal.proposedValue !== null && proposal.proposedValue !== undefined) {
                        updateData.capacity = proposal.proposedValue;
                    } else if (proposal.field === 'portId' && proposal.proposedValue !== null && proposal.proposedValue !== undefined) {
                        if (typeof proposal.proposedValue === 'string' && proposal.proposedValue !== operator.portId) {
                            const port = ports.find(p => p.name === proposal.proposedValue || p.id === proposal.proposedValue);
                            if (port) {
                                updateData.portId = port.id;
                            }
                        }
                    } else if (proposal.field === 'strategicNotes' && proposal.proposedValue !== null && proposal.proposedValue !== undefined) {
                        updateData.strategicNotes = proposal.proposedValue;
                    }
                }
            });

            if (approvedFields.has('strategicNotes') && notesProposal) {
                updateData.strategicNotes = notesProposal.combinedNotes;
            }

            const response = await fetch(`/api/terminal-operators/${operator.id}/deep-research/apply`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    data_to_update: updateData,
                    approved_fields: Array.from(approvedFields)
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to apply changes');
            }

            const result = await response.json();
            const raw = result.operator;
            const parsedOperator: TerminalOperator = {
                ...raw,
                cargoTypes: typeof raw.cargoTypes === 'string' ? JSON.parse(raw.cargoTypes) : raw.cargoTypes,
                parentCompanies: raw.parentCompanies ? JSON.parse(raw.parentCompanies) : null,
                locations: raw.locations ? JSON.parse(raw.locations) : null,
                lastDeepResearchAt: raw.lastDeepResearchAt
            };

            onUpdate(parsedOperator);
            setFormData(parsedOperator);
            setShowPreview(false);
            setProposedChanges(null);
            setDataToUpdate(null);
            setFieldProposals([]);
            setApprovedFields(new Set());
            setNotesProposal(null);
            setActivityLog([]);
            toast.success('Changes applied successfully');
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to apply changes';
            toast.error(message);
        }
    };

    const toggleFieldApproval = (field: string) => {
        setApprovedFields(prev => {
            const newSet = new Set(prev);
            if (newSet.has(field)) {
                newSet.delete(field);
            } else {
                newSet.add(field);
            }
            return newSet;
        });
    };

    const approveAllHighConfidence = () => {
        const highConfFields = fieldProposals
            .filter(p => p.confidence > 0.80)
            .map(p => p.field);
        setApprovedFields(prev => new Set([...prev, ...highConfFields]));
    };

    const approveAllMediumConfidence = () => {
        const mediumConfFields = fieldProposals
            .filter(p => p.confidence >= 0.50 && p.confidence <= 0.80)
            .map(p => p.field);
        setApprovedFields(prev => new Set([...prev, ...mediumConfFields]));
    };

    const rejectAllLowConfidence = () => {
        const lowConfFields = fieldProposals
            .filter(p => p.confidence < 0.50)
            .map(p => p.field);
        setApprovedFields(prev => {
            const newSet = new Set(prev);
            lowConfFields.forEach(f => newSet.delete(f));
            return newSet;
        });
    };

    const discardChanges = () => {
        setShowPreview(false);
        setProposedChanges(null);
        setDataToUpdate(null);
        setPortChangeSuggestion(null);
        setFieldProposals([]);
        setApprovedFields(new Set());
        setNotesProposal(null);
        setActivityLog([]);
        setCurrentProgress(0);
        toast.success('Changes discarded');
    };

    const retryResearch = async () => {
        if (retryCount >= 3) {
            toast.error('Maximum retry attempts reached');
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
        setRetryCount(prev => prev + 1);
        await startDeepResearch(true);
    };

    const copyFullReport = () => {
        const reportToCopy = fullReport || operator.lastDeepResearchReport;
        if (reportToCopy) {
            navigator.clipboard.writeText(reportToCopy);
            toast.success('Report copied to clipboard');
        }
    };

    const addParentCompany = async () => {
        const trimmed = newParentCompanyName.trim();
        if (!trimmed) return;

        // Check if already in list
        if (formData.parentCompanies?.includes(trimmed)) {
            toast.error('Parent company already in list');
            setNewParentCompanyName("");
            return;
        }

        // Add to form data
        const updated = formData.parentCompanies ? [...formData.parentCompanies, trimmed] : [trimmed];
        handleChange("parentCompanies", updated);
        setNewParentCompanyName("");

        // Optionally create in master list if it doesn't exist
        const exists = parentCompanies.find(pc => pc.name.toLowerCase() === trimmed.toLowerCase());
        if (!exists) {
            try {
                const newId = `pc-${Date.now()}`;
                await DBActions.createParentCompany({
                    id: newId,
                    name: trimmed,
                    description: null,
                    website: null
                });
                setParentCompanies(prev => [...prev, { id: newId, name: trimmed, description: null, website: null }]);
            } catch (error) {
                console.error('Failed to create parent company:', error);
            }
        }
    };

    const removeParentCompany = (companyName: string) => {
        const updated = formData.parentCompanies?.filter(pc => pc !== companyName) || null;
        handleChange("parentCompanies", updated && updated.length > 0 ? updated : null);
    };

    const activePort = ports.find(p => p.id === formData.portId);
    const activeCluster = activePort ? clusters.find(c => c.id === activePort.clusterId) : null;

    return (
        <div className="flex flex-col h-full bg-white shadow-xl">
            {/* Header */}
            <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50 sticky top-0 z-10">
                <h2 className="text-lg font-bold text-gray-900 truncate pr-4">
                    {isDirty ? "Editing..." : "Terminal Operator Details"}
                </h2>
                <div className="flex items-center space-x-2">
                    <button
                        onClick={onClose}
                        className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {/* Identity Section */}
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Operator Name</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => handleChange("name", e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {/* Hierarchy Selectors */}
                    <div className="bg-gray-50 p-3 rounded-md border border-gray-100 space-y-3">
                        <div>
                            <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">Parent Port</label>
                            <select
                                value={formData.portId}
                                onChange={(e) => handleChange("portId", e.target.value)}
                                className="block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            >
                                {ports.map(p => (
                                    <option key={p.id} value={p.id}>{p.name} ({p.country})</option>
                                ))}
                            </select>
                        </div>

                        {activeCluster && (
                            <div className="flex items-center justify-between text-xs text-gray-500">
                                <span>Cluster: </span>
                                <span className="font-medium text-gray-800">{activeCluster.name}</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="border-t border-gray-100 pt-4 grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Operator Type</label>
                        <select
                            value={formData.operatorType}
                            onChange={(e) => handleChange("operatorType", e.target.value as OperatorType)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                        >
                            {OPERATOR_TYPE_OPTIONS.map(type => (
                                <option key={type} value={type}>
                                    {type === 'commercial' ? 'Commercial' : 'Captive'}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Capacity</label>
                        <input
                            type="text"
                            value={formData.capacity || ""}
                            onChange={(e) => handleChange("capacity", e.target.value || null)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            placeholder="e.g. 1.2M TEU"
                        />
                    </div>
                </div>

                {/* Parent Companies */}
                <div className="border-t border-gray-100 pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Parent Companies</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                        {formData.parentCompanies?.map(company => (
                            <span key={company} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                {company}
                                <button
                                    type="button"
                                    onClick={() => removeParentCompany(company)}
                                    className="ml-1.5 inline-flex items-center justify-center text-green-400 hover:text-green-600 focus:outline-none"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <select
                            value={newParentCompanyName}
                            onChange={(e) => setNewParentCompanyName(e.target.value)}
                            className="flex-1 min-w-0 block w-full px-3 py-1.5 rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500 sm:text-sm border"
                        >
                            <option value="">Select or type new...</option>
                            {parentCompanies
                                .filter(pc => !formData.parentCompanies?.includes(pc.name))
                                .map(pc => (
                                    <option key={pc.id} value={pc.name}>{pc.name}</option>
                                ))}
                        </select>
                        <input
                            type="text"
                            placeholder="Or type new company name..."
                            value={newParentCompanyName}
                            onChange={(e) => setNewParentCompanyName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addParentCompany();
                                }
                            }}
                            className="flex-1 min-w-0 block w-full px-3 py-1.5 rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500 sm:text-sm border"
                        />
                        <button
                            onClick={addParentCompany}
                            disabled={!newParentCompanyName.trim()}
                            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                            Add
                        </button>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">Select from list or type new company name and press Enter</p>
                </div>

                {/* Cargo Types */}
                <div className="border-t border-gray-100 pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Cargo Types</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                        {formData.cargoTypes?.map(type => (
                            <span key={type} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                {type}
                                <button
                                    type="button"
                                    onClick={() => handleChange("cargoTypes", formData.cargoTypes.filter(t => t !== type))}
                                    className="ml-1.5 inline-flex items-center justify-center text-blue-400 hover:text-blue-600 focus:outline-none"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <select
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val && !formData.cargoTypes.includes(val as CargoType)) {
                                    handleChange("cargoTypes", [...formData.cargoTypes, val as CargoType]);
                                }
                                e.target.value = "";
                            }}
                            className="flex-1 min-w-0 block w-full px-3 py-1.5 rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500 sm:text-sm border"
                        >
                            <option value="">Select cargo type...</option>
                            {CARGO_OPTIONS
                                .filter(opt => !formData.cargoTypes.includes(opt))
                                .map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                        </select>
                    </div>
                </div>

                {/* Primary Location */}
                <div className="border-t border-gray-100 pt-4 grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Primary Latitude</label>
                        <input
                            type="number"
                            step="any"
                            value={formData.latitude || ""}
                            onChange={(e) => handleChange("latitude", e.target.value ? parseFloat(e.target.value) : null)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            placeholder="e.g. 51.5"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Primary Longitude</label>
                        <input
                            type="number"
                            step="any"
                            value={formData.longitude || ""}
                            onChange={(e) => handleChange("longitude", e.target.value ? parseFloat(e.target.value) : null)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            placeholder="e.g. 4.0"
                        />
                    </div>
                </div>

                {/* Strategic Notes */}
                <div className="border-t border-gray-100 pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Strategic Notes</label>
                    <textarea
                        rows={4}
                        value={formData.strategicNotes || ""}
                        onChange={(e) => handleChange("strategicNotes", e.target.value || null)}
                        placeholder="Add strategic notes or local intelligence..."
                        className="block w-full border border-gray-300 rounded-md shadow-sm p-3 text-sm focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>

                {/* Deep Research Agent */}
                <div className="mt-8 bg-purple-50 rounded-lg p-4 border border-purple-100">
                    <div className="flex items-center mb-2">
                        <AlertTriangle className="h-4 w-4 text-purple-600 mr-2" />
                        <h4 className="text-sm font-bold text-purple-900">Deep Research Agent</h4>
                    </div>

                    {formData.lastDeepResearchAt && !isResearching && !showPreview && (
                        <div className="mb-3 text-xs text-purple-800">
                            <p className="font-semibold">Last researched: {new Date(formData.lastDeepResearchAt).toLocaleString()}</p>
                            {formData.lastDeepResearchSummary && (
                                <div className="mt-2 p-2 bg-white rounded border border-purple-100 max-h-40 overflow-y-auto">
                                    <p className="whitespace-pre-wrap">{formData.lastDeepResearchSummary}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Error Display */}
                    {lastError && !isResearching && (
                        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center space-x-2 mb-1">
                                        <AlertCircle className="h-4 w-4 text-red-600" />
                                        <span className="text-sm font-semibold text-red-900">{lastError.message}</span>
                                    </div>
                                    {lastError.originalError && (
                                        <details className="mt-2">
                                            <summary className="text-xs text-red-700 cursor-pointer hover:text-red-900">
                                                Technical details
                                            </summary>
                                            <pre className="mt-1 text-xs text-red-600 bg-red-100 p-2 rounded overflow-auto">
                                                {lastError.originalError}
                                            </pre>
                                        </details>
                                    )}
                                </div>
                                <button
                                    onClick={() => setLastError(null)}
                                    className="ml-2 text-red-400 hover:text-red-600"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            {lastError.retryable && retryCount < 3 && (
                                <button
                                    onClick={retryResearch}
                                    className="mt-2 w-full py-1.5 px-3 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 flex items-center justify-center space-x-1"
                                >
                                    <RotateCw className="h-3 w-3" />
                                    <span>Retry {retryCount > 0 && `(Attempt ${retryCount + 1}/3)`}</span>
                                </button>
                            )}
                        </div>
                    )}

                    {/* Research Status */}
                    {isResearching && (
                        <div className="space-y-3 mb-3">
                            <div className="flex items-center justify-between text-sm text-purple-700">
                                <div className="flex items-center space-x-2">
                                    <span className="animate-spin">⏳</span>
                                    <span className="font-medium">{researchStatus}</span>
                                    <span className="text-xs text-purple-500">({currentProgress}%)</span>
                                </div>
                                <button
                                    onClick={cancelResearch}
                                    className="px-2 py-1 text-xs bg-white border border-purple-300 text-purple-700 rounded hover:bg-purple-100 transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                            <div className="h-2 bg-purple-200 rounded-full overflow-hidden">
                                <div 
                                    className={`h-full transition-all duration-300 ${
                                        currentProgress < 50 ? 'bg-blue-500' : 
                                        currentProgress < 90 ? 'bg-yellow-500' : 
                                        'bg-green-500'
                                    }`}
                                    style={{ width: `${currentProgress}%` }}
                                ></div>
                            </div>
                        </div>
                    )}

                    {/* Full Report Display */}
                    {(fullReport || operator.lastDeepResearchReport) && (
                        <div className="mb-3">
                            <button
                                onClick={() => setShowFullReport(!showFullReport)}
                                className="w-full py-2 px-3 bg-white border border-purple-300 text-purple-700 text-xs font-medium rounded hover:bg-purple-100 transition-colors flex items-center justify-between"
                            >
                                <span>{showFullReport ? 'Hide' : 'View'} Full Research Report</span>
                                {showFullReport ? <X className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                            </button>
                            {showFullReport && (
                                <div className="mt-2 p-3 bg-white border border-purple-200 rounded max-h-96 overflow-y-auto">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-semibold text-purple-900">Full Report</span>
                                        <button
                                            onClick={copyFullReport}
                                            className="flex items-center space-x-1 px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                                        >
                                            <Copy className="h-3 w-3" />
                                            <span>Copy</span>
                                        </button>
                                    </div>
                                    <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
                                        {fullReport || operator.lastDeepResearchReport}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Start Research Button */}
                    {!isResearching && !showPreview && (
                        <button
                            onClick={() => startDeepResearch(false)}
                            className="w-full py-2 bg-white border border-purple-300 text-purple-700 text-sm font-medium rounded hover:bg-purple-100 transition-colors flex items-center justify-center shadow-sm"
                        >
                            Start Deep Research
                        </button>
                    )}
                </div>
            </div>

            {/* Footer with Delete and Save buttons */}
            <div className="px-5 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-3">
                <button
                    onClick={handleDelete}
                    className="px-4 py-2 bg-red-50 text-red-700 rounded-md text-sm font-medium hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
                >
                    Delete
                </button>
                <button
                    onClick={handleSave}
                    disabled={!isDirty}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        isDirty
                            ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                >
                    <Save className="w-4 h-4" />
                    <span>Save</span>
                </button>
            </div>
        </div>
    );
};
