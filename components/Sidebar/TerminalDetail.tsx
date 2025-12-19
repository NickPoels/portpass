import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Terminal, Cluster, Port, CargoType } from "@/lib/types";
import { X, Save, AlertTriangle, Copy, Check, RotateCw, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";

interface TerminalDetailProps {
    terminal: Terminal;
    clusters: Cluster[];
    ports: Port[];
    onClose: () => void;
    onUpdate: (updated: Terminal) => void;
    onDelete: () => void;
}

const CARGO_OPTIONS: CargoType[] = [
    "Container", "RoRo", "Dry Bulk", "Liquid Bulk", "Break Bulk", "Multipurpose", "Passenger/Ferry"
];

interface ProposedChanges {
    [key: string]: { from: any; to: any };
}

interface ErrorInfo {
    category: string;
    message: string;
    originalError?: string;
    retryable: boolean;
}

export const TerminalDetail = ({ terminal, clusters, ports, onClose, onUpdate, onDelete }: TerminalDetailProps) => {
    const router = useRouter();
    const [formData, setFormData] = useState<Terminal>(terminal);
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

    // Sync state when terminal prop changes
    useEffect(() => {
        setFormData(terminal);
        setIsDirty(false);
        
        // Load stored full research report from terminal prop
        // Only load if we don't already have a report in state (from current research session)
        // This ensures stored reports are available after page refresh
        if (terminal.lastDeepResearchReport && !fullReport) {
            setFullReport(terminal.lastDeepResearchReport);
        }
    }, [terminal]); // Only depend on terminal, not fullReport (avoids circular updates)

    const handleChange = (field: keyof Terminal, value: Terminal[keyof Terminal]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setIsDirty(true);
    };

    const handleSave = () => {
        onUpdate(formData);
        setIsDirty(false);
    };

    const handleDelete = () => {
        if (window.confirm("Are you sure you want to delete this terminal? This action cannot be undone.")) {
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
            const startResponse = await fetch(`/api/terminals/${terminal.id}/deep-research/start`, {
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
                        // Job completed, refresh terminal data to get results
                        setIsResearching(false);
                        setResearchStatus("Research complete - Review changes");
                        
                        // Clear polling
                        if (pollingIntervalRef.current) {
                            clearInterval(pollingIntervalRef.current);
                            pollingIntervalRef.current = null;
                        }
                        
                        // Force refresh: Use router to refresh server-side data
                        router.refresh();
                        
                        // Also clear and reload report state after a short delay to allow data to refresh
                        setTimeout(() => {
                            setFullReport(null);
                            // The useEffect will reload the report when terminal prop updates
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
                        
                        // Clear polling
                        if (pollingIntervalRef.current) {
                            clearInterval(pollingIntervalRef.current);
                            pollingIntervalRef.current = null;
                        }
                        return;
                    } else if (job.status === 'running' || job.status === 'pending') {
                        // Update progress display
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

            // Poll every 2 seconds
            pollingIntervalRef.current = setInterval(pollJobStatus, 2000);
            // Initial poll
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
            
            // Clear polling if it was set
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        }
    };

    const cancelResearch = () => {
        // Clear polling
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
        setIsResearching(false);
        setResearchStatus("Cancelled");
        setCurrentJobId(null);
        toast.success('Research monitoring stopped (job continues in background)');
    };
    
    // Cleanup polling on unmount
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
            // Build update data from approved fields
            const updateData: any = {
                lastDeepResearchAt: new Date(),
                lastDeepResearchSummary: dataToUpdate?.lastDeepResearchSummary || '',
            };

            // Apply only approved fields
            fieldProposals.forEach(proposal => {
                if (approvedFields.has(proposal.field)) {
                    if (proposal.field === 'coordinates' && typeof proposal.proposedValue === 'object' && proposal.proposedValue !== null) {
                        updateData.latitude = proposal.proposedValue.lat;
                        updateData.longitude = proposal.proposedValue.lon;
                    } else if (proposal.field === 'cargoTypes' && Array.isArray(proposal.proposedValue)) {
                        updateData.cargoTypes = JSON.stringify(proposal.proposedValue);
                    } else if (proposal.field === 'operatorGroup' && proposal.proposedValue !== null && proposal.proposedValue !== undefined) {
                        updateData.operatorGroup = proposal.proposedValue;
                    } else if (proposal.field === 'capacity' && proposal.proposedValue !== null && proposal.proposedValue !== undefined) {
                        updateData.capacity = proposal.proposedValue;
                    } else if (proposal.field === 'portId' && proposal.proposedValue !== null && proposal.proposedValue !== undefined) {
                        // Port ID needs to be resolved to actual port ID, not name
                        // This should already be handled in the API route, but we'll pass it through
                        if (typeof proposal.proposedValue === 'string' && proposal.proposedValue !== terminal.portId) {
                            // Find port by name if needed
                            const port = ports.find(p => p.name === proposal.proposedValue || p.id === proposal.proposedValue);
                            if (port) {
                                updateData.portId = port.id;
                            }
                        }
                    }
                }
            });

            // Handle notes separately
            if (approvedFields.has('notes') && notesProposal) {
                updateData.notes = notesProposal.combinedNotes;
            }

            const response = await fetch(`/api/terminals/${terminal.id}/deep-research/apply`, {
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
            const raw = result.terminal;
            const parsedTerminal: Terminal = {
                ...raw,
                cargoTypes: typeof raw.cargoTypes === 'string' ? JSON.parse(raw.cargoTypes) : raw.cargoTypes,
                lastDeepResearchAt: raw.lastDeepResearchAt
            };

            onUpdate(parsedTerminal);
            setFormData(parsedTerminal);
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

        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10s
        await new Promise(resolve => setTimeout(resolve, delay));
        setRetryCount(prev => prev + 1);
        await startDeepResearch(true);
    };

    const copyFullReport = () => {
        const reportToCopy = fullReport || terminal.lastDeepResearchReport;
        if (reportToCopy) {
            navigator.clipboard.writeText(reportToCopy);
            toast.success('Report copied to clipboard');
        }
    };

    const activePort = ports.find(p => p.id === formData.portId);
    const activeCluster = activePort ? clusters.find(c => c.id === activePort.clusterId) : null;

    return (
        <div className="flex flex-col h-full bg-white shadow-xl">
            {/* Header */}
            <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50 sticky top-0 z-10">
                <h2 className="text-lg font-bold text-gray-900 truncate pr-4">
                    {isDirty ? "Editing..." : "Terminal Details"}
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
                        <label className="block text-sm font-medium text-gray-700">Terminal Name</label>
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
                        <label className="block text-sm font-medium text-gray-700">Operator Group</label>
                        <input
                            type="text"
                            value={formData.operatorGroup || ""}
                            onChange={(e) => handleChange("operatorGroup", e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            placeholder="e.g. DP World, PSA"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Capacity</label>
                        <input
                            type="text"
                            value={formData.capacity}
                            onChange={(e) => handleChange("capacity", e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            placeholder="e.g. 1.2M TEU"
                        />
                    </div>
                </div>

                {/* Cargo Types (Dynamic) */}
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
                        <input
                            type="text"
                            placeholder="Add tag..."
                            className="flex-1 min-w-0 block w-full px-3 py-1.5 rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500 sm:text-sm border"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const val = e.currentTarget.value.trim();
                                    if (val && !formData.cargoTypes.includes(val)) {
                                        handleChange("cargoTypes", [...formData.cargoTypes, val]);
                                        e.currentTarget.value = "";
                                    }
                                }
                            }}
                        />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">Press Enter to add tags</p>
                </div>

                {/* Notes */}
                <div className="border-t border-gray-100 pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Intel</label>
                    <textarea
                        rows={4}
                        value={formData.notes || ""}
                        onChange={(e) => handleChange("notes", e.target.value)}
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

                    {/* Research Status with Activity Log */}
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
                            {activityLog.length > 0 && (
                                <details className="text-xs">
                                    <summary className="cursor-pointer text-purple-600 hover:text-purple-800">
                                        Activity Log ({activityLog.length} steps)
                                    </summary>
                                    <div className="mt-2 space-y-1 max-h-40 overflow-y-auto bg-white p-2 rounded border border-purple-100">
                                        {activityLog.map((entry, idx) => (
                                            <div key={idx} className={`flex items-center space-x-2 ${entry.completed ? 'text-gray-500' : 'text-purple-700 font-medium'}`}>
                                                <span>{entry.completed ? '✓' : '⏳'}</span>
                                                <span className="flex-1">{entry.message}</span>
                                                <span className="text-gray-400">({entry.progress}%)</span>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )}
                        </div>
                    )}

                    {/* Enhanced Preview Section with Field Proposals */}
                    {showPreview && fieldProposals.length > 0 && (
                        <div className="mb-3 p-3 bg-white border border-purple-200 rounded">
                            <h5 className="text-sm font-semibold text-purple-900 mb-3">Review Proposed Changes</h5>
                            
                            {/* Bulk Actions */}
                            <div className="mb-3 flex flex-wrap gap-2">
                                <button
                                    onClick={approveAllHighConfidence}
                                    className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                                >
                                    Accept All High ({'>'}80%)
                                </button>
                                <button
                                    onClick={approveAllMediumConfidence}
                                    className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
                                >
                                    Accept All Medium (50-80%)
                                </button>
                                <button
                                    onClick={rejectAllLowConfidence}
                                    className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                                >
                                    Reject All Low ({'<'}50%)
                                </button>
                            </div>

                            {/* Field Proposals */}
                            <div className="space-y-3 max-h-96 overflow-y-auto text-xs">
                                {/* High Priority Fields */}
                                {fieldProposals
                                    .filter(p => ['coordinates', 'capacity', 'operatorGroup'].includes(p.field))
                                    .map((proposal) => {
                                        const isApproved = approvedFields.has(proposal.field);
                                        const confidenceColor = proposal.confidence > 0.80 ? 'green' : proposal.confidence >= 0.50 ? 'yellow' : 'red';
                                        const isHighPriority = ['coordinates', 'capacity', 'operatorGroup'].includes(proposal.field);
                                        
                                        return (
                                            <div key={proposal.field} className={`p-3 rounded border-2 ${isHighPriority ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-100'}`}>
                                                <div className="flex items-start justify-between mb-2">
                                                    <div className="flex-1">
                                                        <div className="flex items-center space-x-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={isApproved}
                                                                onChange={() => toggleFieldApproval(proposal.field)}
                                                                disabled={proposal.confidence < 0.50}
                                                                className="rounded"
                                                            />
                                                            <span className="font-semibold text-purple-900">
                                                                {proposal.field === 'operatorGroup' ? 'Operator Group' :
                                                                 proposal.field === 'coordinates' ? 'Coordinates' :
                                                                 proposal.field === 'capacity' ? 'Capacity' :
                                                                 proposal.field}
                                                            </span>
                                                            {isHighPriority && (
                                                                <span className="px-1.5 py-0.5 bg-blue-200 text-blue-800 text-xs rounded">High Priority</span>
                                                            )}
                                                            <span className={`px-1.5 py-0.5 text-xs rounded ${
                                                                proposal.updatePriority === 'high' ? 'bg-red-100 text-red-700' :
                                                                proposal.updatePriority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                                'bg-gray-100 text-gray-700'
                                                            }`}>
                                                                {proposal.updatePriority} priority
                                                            </span>
                                                        </div>
                                                        <div className="mt-1 flex items-center space-x-2">
                                                            <div className="flex-1">
                                                                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                                                    <div 
                                                                        className={`h-full ${
                                                                            confidenceColor === 'green' ? 'bg-green-500' :
                                                                            confidenceColor === 'yellow' ? 'bg-yellow-500' :
                                                                            'bg-red-500'
                                                                        }`}
                                                                        style={{ width: `${proposal.confidence * 100}%` }}
                                                                    ></div>
                                                                </div>
                                                            </div>
                                                            <span className={`text-xs font-medium ${
                                                                confidenceColor === 'green' ? 'text-green-700' :
                                                                confidenceColor === 'yellow' ? 'text-yellow-700' :
                                                                'text-red-700'
                                                            }`}>
                                                                {Math.round(proposal.confidence * 100)}% confidence
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 mt-2">
                                                    <div>
                                                        <div className="text-gray-500 text-xs mb-1">Current:</div>
                                                        <div className="text-gray-700 text-xs">
                                                            {typeof proposal.currentValue === 'object' ? JSON.stringify(proposal.currentValue) : String(proposal.currentValue || '—')}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="text-purple-600 text-xs mb-1">Proposed:</div>
                                                        <div className="text-purple-900 font-medium text-xs">
                                                            {typeof proposal.proposedValue === 'object' ? JSON.stringify(proposal.proposedValue) : String(proposal.proposedValue || '—')}
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                {/* Validation Warnings */}
                                                {proposal.validationWarnings && proposal.validationWarnings.length > 0 && (
                                                    <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                                                        <div className="font-semibold text-yellow-800 mb-1">Validation Warnings:</div>
                                                        <ul className="list-disc list-inside text-yellow-700 space-y-0.5">
                                                            {proposal.validationWarnings.map((warning: string, idx: number) => (
                                                                <li key={idx}>{warning}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                                
                                                {/* Validation Errors */}
                                                {proposal.validationErrors && proposal.validationErrors.length > 0 && (
                                                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
                                                        <div className="font-semibold text-red-800 mb-1">Validation Errors:</div>
                                                        <ul className="list-disc list-inside text-red-700 space-y-0.5">
                                                            {proposal.validationErrors.map((error: string, idx: number) => (
                                                                <li key={idx}>{error}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                                
                                                {/* Conflicts */}
                                                {proposal.hasConflict && proposal.conflicts && proposal.conflicts.length > 0 && (
                                                    <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                                                        <div className="font-semibold text-orange-800 mb-1">⚠️ Conflicting Values Found:</div>
                                                        <div className="space-y-2">
                                                            {proposal.conflicts.map((conflict: any, idx: number) => (
                                                                <div key={idx} className="border-l-2 border-orange-300 pl-2">
                                                                    <div className="font-medium text-orange-900">
                                                                        Alternative from {conflict.sourceQuery}:
                                                                    </div>
                                                                    <div className="text-orange-700 mt-0.5">
                                                                        {typeof conflict.conflictingValue === 'object' 
                                                                            ? JSON.stringify(conflict.conflictingValue) 
                                                                            : String(conflict.conflictingValue)}
                                                                    </div>
                                                                    <div className="text-orange-600 text-xs mt-0.5">
                                                                        Confidence: {Math.round(conflict.confidence * 100)}%
                                                                    </div>
                                                                    {conflict.evidence && (
                                                                        <div className="text-orange-600 text-xs mt-0.5 italic">
                                                                            "{conflict.evidence.substring(0, 100)}..."
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                
                                                {/* Quality indicator */}
                                                {proposal.llmQuality && (
                                                    <div className="mt-1 text-xs text-gray-500">
                                                        Quality: <span className="font-medium">
                                                            {proposal.llmQuality === 'explicit' ? '✓ Explicitly stated' :
                                                             proposal.llmQuality === 'inferred' ? '~ Inferred' :
                                                             '? Partial/Uncertain'}
                                                        </span>
                                                    </div>
                                                )}
                                                
                                                <details className="mt-2">
                                                    <summary className="cursor-pointer text-purple-600 hover:text-purple-800 text-xs">
                                                        Reasoning & Sources
                                                    </summary>
                                                    <div className="mt-1 p-2 bg-white rounded border border-purple-100 text-xs">
                                                        <div className="mb-1"><strong>Reasoning:</strong> {proposal.reasoning}</div>
                                                        {proposal.sources && proposal.sources.length > 0 && (
                                                            <div><strong>Sources:</strong> {proposal.sources.join(', ')}</div>
                                                        )}
                                                    </div>
                                                </details>
                                            </div>
                                        );
                                    })}
                                
                                {/* Other Fields */}
                                {fieldProposals
                                    .filter(p => !['coordinates', 'capacity', 'operatorGroup', 'notes'].includes(p.field))
                                    .map((proposal) => {
                                        const isApproved = approvedFields.has(proposal.field);
                                        const confidenceColor = proposal.confidence > 0.80 ? 'green' : proposal.confidence >= 0.50 ? 'yellow' : 'red';
                                        
                                        return (
                                            <div key={proposal.field} className="p-3 bg-purple-50 rounded border border-purple-100">
                                                <div className="flex items-start justify-between mb-2">
                                                    <div className="flex-1">
                                                        <div className="flex items-center space-x-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={isApproved}
                                                                onChange={() => toggleFieldApproval(proposal.field)}
                                                                disabled={proposal.confidence < 0.50}
                                                                className="rounded"
                                                            />
                                                            <span className="font-semibold text-purple-900">
                                                                {proposal.field === 'cargoTypes' ? 'Cargo Types' :
                                                                 proposal.field === 'portId' ? 'Port' :
                                                                 proposal.field}
                                                            </span>
                                                        </div>
                                                        <div className="mt-1 flex items-center space-x-2">
                                                            <div className="flex-1">
                                                                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                                                    <div 
                                                                        className={`h-full ${
                                                                            confidenceColor === 'green' ? 'bg-green-500' :
                                                                            confidenceColor === 'yellow' ? 'bg-yellow-500' :
                                                                            'bg-red-500'
                                                                        }`}
                                                                        style={{ width: `${proposal.confidence * 100}%` }}
                                                                    ></div>
                                                                </div>
                                                            </div>
                                                            <span className={`text-xs font-medium ${
                                                                confidenceColor === 'green' ? 'text-green-700' :
                                                                confidenceColor === 'yellow' ? 'text-yellow-700' :
                                                                'text-red-700'
                                                            }`}>
                                                                {Math.round(proposal.confidence * 100)}% confidence
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 mt-2">
                                                    <div>
                                                        <div className="text-gray-500 text-xs mb-1">Current:</div>
                                                        <div className="text-gray-700 text-xs">
                                                            {typeof proposal.currentValue === 'object' ? JSON.stringify(proposal.currentValue) : String(proposal.currentValue || '—')}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="text-purple-600 text-xs mb-1">Proposed:</div>
                                                        <div className="text-purple-900 font-medium text-xs">
                                                            {typeof proposal.proposedValue === 'object' ? JSON.stringify(proposal.proposedValue) : String(proposal.proposedValue || '—')}
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                {/* Validation Warnings */}
                                                {proposal.validationWarnings && proposal.validationWarnings.length > 0 && (
                                                    <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                                                        <div className="font-semibold text-yellow-800 mb-1">Validation Warnings:</div>
                                                        <ul className="list-disc list-inside text-yellow-700 space-y-0.5">
                                                            {proposal.validationWarnings.map((warning: string, idx: number) => (
                                                                <li key={idx}>{warning}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                                
                                                {/* Validation Errors */}
                                                {proposal.validationErrors && proposal.validationErrors.length > 0 && (
                                                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
                                                        <div className="font-semibold text-red-800 mb-1">Validation Errors:</div>
                                                        <ul className="list-disc list-inside text-red-700 space-y-0.5">
                                                            {proposal.validationErrors.map((error: string, idx: number) => (
                                                                <li key={idx}>{error}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                                
                                                {/* Conflicts */}
                                                {proposal.hasConflict && proposal.conflicts && proposal.conflicts.length > 0 && (
                                                    <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                                                        <div className="font-semibold text-orange-800 mb-1">⚠️ Conflicting Values Found:</div>
                                                        <div className="space-y-2">
                                                            {proposal.conflicts.map((conflict: any, idx: number) => (
                                                                <div key={idx} className="border-l-2 border-orange-300 pl-2">
                                                                    <div className="font-medium text-orange-900">
                                                                        Alternative from {conflict.sourceQuery}:
                                                                    </div>
                                                                    <div className="text-orange-700 mt-0.5">
                                                                        {typeof conflict.conflictingValue === 'object' 
                                                                            ? JSON.stringify(conflict.conflictingValue) 
                                                                            : String(conflict.conflictingValue)}
                                                                    </div>
                                                                    <div className="text-orange-600 text-xs mt-0.5">
                                                                        Confidence: {Math.round(conflict.confidence * 100)}%
                                                                    </div>
                                                                    {conflict.evidence && (
                                                                        <div className="text-orange-600 text-xs mt-0.5 italic">
                                                                            "{conflict.evidence.substring(0, 100)}..."
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                
                                                {/* Quality indicator */}
                                                {proposal.llmQuality && (
                                                    <div className="mt-1 text-xs text-gray-500">
                                                        Quality: <span className="font-medium">
                                                            {proposal.llmQuality === 'explicit' ? '✓ Explicitly stated' :
                                                             proposal.llmQuality === 'inferred' ? '~ Inferred' :
                                                             '? Partial/Uncertain'}
                                                        </span>
                                                    </div>
                                                )}
                                                
                                                <details className="mt-2">
                                                    <summary className="cursor-pointer text-purple-600 hover:text-purple-800 text-xs">
                                                        Reasoning & Sources
                                                    </summary>
                                                    <div className="mt-1 p-2 bg-white rounded border border-purple-100 text-xs">
                                                        <div className="mb-1"><strong>Reasoning:</strong> {proposal.reasoning}</div>
                                                        {proposal.sources && proposal.sources.length > 0 && (
                                                            <div><strong>Sources:</strong> {proposal.sources.join(', ')}</div>
                                                        )}
                                                    </div>
                                                </details>
                                            </div>
                                        );
                                    })}
                                
                                {/* Notes/Intel (Always at bottom, always editable) */}
                                {notesProposal && (
                                    <div className="p-3 bg-gray-50 rounded border border-gray-200">
                                        <div className="flex items-center space-x-2 mb-2">
                                            <input
                                                type="checkbox"
                                                checked={approvedFields.has('notes')}
                                                onChange={() => toggleFieldApproval('notes')}
                                                className="rounded"
                                            />
                                            <span className="font-semibold text-gray-900">Notes/Intel</span>
                                            <span className="px-1.5 py-0.5 bg-gray-200 text-gray-700 text-xs rounded">Sandbox</span>
                                        </div>
                                        <div className="text-xs text-gray-600 mb-2">
                                            New findings will be appended to existing notes
                                        </div>
                                        <textarea
                                            value={notesProposal.combinedNotes}
                                            onChange={(e) => setNotesProposal({ ...notesProposal, combinedNotes: e.target.value })}
                                            className="w-full p-2 text-xs border border-gray-300 rounded bg-white"
                                            rows={4}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Summary and Actions */}
                            <div className="mt-3 pt-3 border-t border-purple-200">
                                <div className="text-xs text-gray-600 mb-2">
                                    {approvedFields.size} field(s) approved, {fieldProposals.length - approvedFields.size} pending
                                </div>
                                <div className="flex space-x-2">
                                    <button
                                        onClick={applyChanges}
                                        disabled={approvedFields.size === 0 && !approvedFields.has('notes')}
                                        className="flex-1 py-2 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                                    >
                                        Apply Changes ({approvedFields.size})
                                    </button>
                                    <button
                                        onClick={discardChanges}
                                        className="flex-1 py-2 bg-gray-200 text-gray-700 text-xs font-medium rounded hover:bg-gray-300 transition-colors"
                                    >
                                        Discard
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Full Report Display - Show even when preview is visible */}
                    {(fullReport || terminal.lastDeepResearchReport) && (
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
                                        {fullReport || terminal.lastDeepResearchReport}
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
