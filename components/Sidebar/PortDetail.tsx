import { useState, useEffect, useRef } from "react";
import { Port, Cluster, ISPSRiskLevel, ISPSEnforcementStrength } from "@/lib/types";
import { X, Save, AlertTriangle, Copy, RotateCw, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";

interface ErrorInfo {
    category: string;
    message: string;
    originalError?: string;
    retryable: boolean;
}

interface PortDetailProps {
    port: Port;
    clusters: Cluster[];
    onClose: () => void;
    onUpdate: (updated: Port) => void;
    onDelete: () => void;
}

export const PortDetail = ({ port, clusters, onClose, onUpdate, onDelete }: PortDetailProps) => {
    const [formData, setFormData] = useState<Port>(port);
    const [isDirty, setIsDirty] = useState(false);
    const [isResearching, setIsResearching] = useState(false);
    const [researchStatus, setResearchStatus] = useState("");
    const [showPreview, setShowPreview] = useState(false);
    const [fullReport, setFullReport] = useState<string | null>(null);
    const [showFullReport, setShowFullReport] = useState(false);
    const [lastError, setLastError] = useState<ErrorInfo | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [dataToUpdate, setDataToUpdate] = useState<any>(null);
    const [activityLog, setActivityLog] = useState<Array<{message: string, step: string, progress: number, timestamp: Date, completed: boolean}>>([]);
    const [currentProgress, setCurrentProgress] = useState(0);
    const [fieldProposals, setFieldProposals] = useState<Array<any>>([]);
    const [approvedFields, setApprovedFields] = useState<Set<string>>(new Set());
    const [notesProposal, setNotesProposal] = useState<{currentNotes: string, newFindings: string, combinedNotes: string} | null>(null);

    useEffect(() => {
        setFormData(port);
        setIsDirty(false);
        
        // Load stored full research report from port prop
        if (port.lastDeepResearchReport && !fullReport) {
            setFullReport(port.lastDeepResearchReport);
        }
    }, [port]);

    const handleChange = (field: keyof Port, value: Port[keyof Port]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setIsDirty(true);
    };

    const handleArrayChange = (field: "identityCompetitors" | "dominantTOSSystems" | "dominantACSSystems", value: string) => {
        // Parse comma-separated string into array, trim whitespace, filter empty
        const array = value.split(",").map(s => s.trim()).filter(s => s.length > 0);
        setFormData(prev => ({ ...prev, [field]: array.length > 0 ? array : undefined }));
        setIsDirty(true);
    };

    const formatArrayForInput = (arr: string[] | undefined): string => {
        return arr ? arr.join(", ") : "";
    };

    const handleSave = () => {
        onUpdate(formData);
        setIsDirty(false);
    };

    const handleDelete = () => {
        if (window.confirm(`Are you sure you want to delete ${port.name}? This will also delete ALL terminals in this port.`)) {
            onDelete();
        }
    };

    const startDeepResearch = async (isRetry = false) => {
        if (!isRetry) {
            setRetryCount(0);
            setLastError(null);
        }
        
        setIsResearching(true);
        setResearchStatus("Initializing...");
        setShowPreview(false);
        setFullReport(null);

        abortControllerRef.current = new AbortController();
        const abortController = abortControllerRef.current;

        try {
            const response = await fetch(`/api/ports/${port.id}/deep-research`, {
                method: "POST",
                signal: abortController.signal,
            });

            if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
                const errorData = await response.json();
                const errorInfo: ErrorInfo = {
                    category: errorData.category || 'UNKNOWN_ERROR',
                    message: errorData.message || errorData.error || 'An error occurred',
                    originalError: errorData.error,
                    retryable: errorData.retryable !== false
                };
                setLastError(errorInfo);
                setIsResearching(false);
                toast.error(errorInfo.message);
                return;
            }

            if (!response.body) {
                throw new Error("No response body");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                const events = buffer.split("\n\n");
                buffer = events.pop() || "";

                for (const eventBlock of events) {
                    const lines = eventBlock.split("\n");
                    const eventLine = lines.find(l => l.startsWith("event: "));
                    const dataLine = lines.find(l => l.startsWith("data: "));

                    if (eventLine && dataLine) {
                        const eventType = eventLine.replace("event: ", "").trim();
                        const data = JSON.parse(dataLine.replace("data: ", ""));

                        if (eventType === "status") {
                            setResearchStatus(data.message);
                            setCurrentProgress(data.progress || 0);
                            
                            setActivityLog(prev => {
                                const updated = prev.map(entry => 
                                    entry.step === data.step ? { ...entry, completed: true } : entry
                                );
                                
                                if (!updated.find(e => e.step === data.step && !e.completed)) {
                                    updated.push({
                                        message: data.message,
                                        step: data.step,
                                        progress: data.progress || 0,
                                        timestamp: new Date(),
                                        completed: false
                                    });
                                }
                                
                                return updated;
                            });
                        } else if (eventType === "preview") {
                            setFieldProposals(data.field_proposals || []);
                            setFullReport(data.full_report || null);
                            setDataToUpdate(data.data_to_update);
                            setNotesProposal(data.notes_proposal || null);
                            
                            const autoApproved = new Set(
                                (data.field_proposals || [])
                                    .filter((p: any) => p.autoApproved && p.confidence > 0.80)
                                    .map((p: any) => p.field)
                            );
                            setApprovedFields(autoApproved);
                            
                            setShowPreview(true);
                            setResearchStatus("Research complete - Review changes");
                            setIsResearching(false);
                            
                            setActivityLog(prev => prev.map(entry => 
                                entry.step === 'complete' ? { ...entry, completed: true } : entry
                            ));
                        } else if (eventType === "error") {
                            const errorInfo: ErrorInfo = {
                                category: data.category || 'UNKNOWN_ERROR',
                                message: data.message || 'An unexpected error occurred.',
                                originalError: data.originalError,
                                retryable: data.retryable !== false
                            };
                            setLastError(errorInfo);
                            setIsResearching(false);
                            
                            if (errorInfo.category === 'NETWORK_ERROR' && errorInfo.message.includes('cancelled')) {
                                toast.success('Research cancelled');
                            } else {
                                toast.error(errorInfo.message);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            if (e instanceof Error && (e.name === 'AbortError' || e.message.includes('aborted'))) {
                setIsResearching(false);
                setResearchStatus("Cancelled");
                toast.success('Research cancelled');
                return;
            }
            
            const errorInfo: ErrorInfo = {
                category: 'NETWORK_ERROR',
                message: 'Network error occurred. Please check your connection and try again.',
                originalError: e instanceof Error ? e.message : String(e),
                retryable: true
            };
            setLastError(errorInfo);
            setIsResearching(false);
            toast.error(errorInfo.message);
        }
    };

    const cancelResearch = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsResearching(false);
        setResearchStatus("Cancelling...");
    };

    const applyChanges = async () => {
        if (approvedFields.size === 0 && !notesProposal) {
            toast.error('Please approve at least one field to apply changes');
            return;
        }

        try {
            const response = await fetch(`/api/ports/${port.id}/deep-research/apply`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    data_to_update: dataToUpdate,
                    approved_fields: Array.from(approvedFields)
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to apply changes');
            }

            const result = await response.json();
            
            // Refresh port data - the API returns success, but we need to refetch
            // For now, update formData with the changes we know were applied
            const updatedPort: Port = {
                ...formData,
                lastDeepResearchAt: dataToUpdate?.lastDeepResearchAt ? new Date(dataToUpdate.lastDeepResearchAt).toISOString() : null,
                lastDeepResearchSummary: dataToUpdate?.lastDeepResearchSummary || null,
            };

            // Apply approved field changes
            fieldProposals.forEach(proposal => {
                if (approvedFields.has(proposal.field)) {
                    if (proposal.field === 'identityCompetitors' && Array.isArray(proposal.proposedValue)) {
                        updatedPort.identityCompetitors = proposal.proposedValue;
                    } else if (proposal.field === 'dominantTOSSystems' && Array.isArray(proposal.proposedValue)) {
                        updatedPort.dominantTOSSystems = proposal.proposedValue;
                    } else if (proposal.field === 'dominantACSSystems' && Array.isArray(proposal.proposedValue)) {
                        updatedPort.dominantACSSystems = proposal.proposedValue;
                    } else if (proposal.field === 'strategicNotes' && proposal.proposedValue) {
                        updatedPort.strategicNotes = proposal.proposedValue;
                    } else if (proposal.proposedValue !== null && proposal.proposedValue !== undefined) {
                        (updatedPort as any)[proposal.field] = proposal.proposedValue;
                    }
                }
            });

            if (approvedFields.has('strategicNotes') && notesProposal) {
                updatedPort.strategicNotes = notesProposal.combinedNotes;
            }

            onUpdate(updatedPort);
            setFormData(updatedPort);
            setShowPreview(false);
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
        setDataToUpdate(null);
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
        const reportToCopy = fullReport || port.lastDeepResearchReport;
        if (reportToCopy) {
            navigator.clipboard.writeText(reportToCopy);
            toast.success('Report copied to clipboard');
        }
    };

    return (
        <div className="flex flex-col h-full bg-white shadow-xl">
            <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50 sticky top-0 z-10">
                <h2 className="text-lg font-bold text-gray-900 truncate pr-4">
                    Port Details
                </h2>
                <div className="flex items-center space-x-2">
                    <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200">
                        <X className="h-5 w-5" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Port Name</label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => handleChange("name", e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    />
                </div>


                <div>
                    <label className="block text-sm font-medium text-gray-700">Country</label>
                    <input
                        type="text"
                        value={formData.country}
                        onChange={(e) => handleChange("country", e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Parent Cluster</label>
                    <select
                        value={formData.clusterId}
                        onChange={(e) => handleChange("clusterId", e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                        {clusters.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <textarea
                        rows={3}
                        value={formData.description || ""}
                        onChange={(e) => handleChange("description", e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    />
                </div>

                {/* Governance Section */}
                <div className="pt-6 border-t border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4">Governance</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Port Authority</label>
                            <input
                                type="text"
                                value={formData.portAuthority || ""}
                                onChange={(e) => handleChange("portAuthority", e.target.value || null)}
                                placeholder="e.g., Port of Antwerp Authority"
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Customs Authority</label>
                            <input
                                type="text"
                                value={formData.customsAuthority || ""}
                                onChange={(e) => handleChange("customsAuthority", e.target.value || null)}
                                placeholder="e.g., Belgian Customs"
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            />
                        </div>
                    </div>
                </div>

                {/* Identity System Section */}
                <div className="pt-6 border-t border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4">Identity Systems</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Port-Wide Identity System</label>
                            <input
                                type="text"
                                value={formData.portWideIdentitySystem || ""}
                                onChange={(e) => handleChange("portWideIdentitySystem", e.target.value || null)}
                                placeholder="e.g., AlfaPass, CargoCard, Local Badge System"
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Identity Competitors</label>
                            <input
                                type="text"
                                value={formatArrayForInput(formData.identityCompetitors)}
                                onChange={(e) => handleArrayChange("identityCompetitors", e.target.value)}
                                placeholder="Comma-separated: e.g., AlfaPass, CargoCard, Local System"
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            />
                            <p className="mt-1 text-xs text-gray-500">Enter competitor names separated by commas</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Identity Adoption Rate</label>
                            <input
                                type="text"
                                value={formData.identityAdoptionRate || ""}
                                onChange={(e) => handleChange("identityAdoptionRate", e.target.value || null)}
                                placeholder="e.g., High, Medium, Low, None, or 60%"
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            />
                        </div>
                    </div>
                </div>

                {/* ISPS Risk Section */}
                <div className="pt-6 border-t border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4">ISPS Risk & Enforcement</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Port-Level ISPS Risk</label>
                            <select
                                value={formData.portLevelISPSRisk || ""}
                                onChange={(e) => handleChange("portLevelISPSRisk", (e.target.value || null) as ISPSRiskLevel | null)}
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            >
                                <option value="">Not Set</option>
                                <option value="Low">Low</option>
                                <option value="Medium">Medium</option>
                                <option value="High">High</option>
                                <option value="Very High">Very High</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">ISPS Enforcement Strength</label>
                            <select
                                value={formData.ispsEnforcementStrength || ""}
                                onChange={(e) => handleChange("ispsEnforcementStrength", (e.target.value || null) as ISPSEnforcementStrength | null)}
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            >
                                <option value="">Not Set</option>
                                <option value="Weak">Weak</option>
                                <option value="Moderate">Moderate</option>
                                <option value="Strong">Strong</option>
                                <option value="Very Strong">Very Strong</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* System Landscape Section */}
                <div className="pt-6 border-t border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4">System Landscape</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Dominant TOS Systems</label>
                            <input
                                type="text"
                                value={formatArrayForInput(formData.dominantTOSSystems)}
                                onChange={(e) => handleArrayChange("dominantTOSSystems", e.target.value)}
                                placeholder="Comma-separated: e.g., Navis N4, TOS, COSMOS"
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            />
                            <p className="mt-1 text-xs text-gray-500">Enter TOS system names separated by commas</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Dominant ACS Systems</label>
                            <input
                                type="text"
                                value={formatArrayForInput(formData.dominantACSSystems)}
                                onChange={(e) => handleArrayChange("dominantACSSystems", e.target.value)}
                                placeholder="Comma-separated: e.g., Nedap, HID, Local ACS"
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            />
                            <p className="mt-1 text-xs text-gray-500">Enter ACS system names separated by commas</p>
                        </div>
                    </div>
                </div>

                {/* Strategic Notes Section */}
                <div className="pt-6 border-t border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4">Strategic Notes</h3>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Research Insights & Strategic Notes</label>
                        <textarea
                            rows={6}
                            value={formData.strategicNotes || ""}
                            onChange={(e) => handleChange("strategicNotes", e.target.value || null)}
                            placeholder="Enter strategic insights, research findings, expansion opportunities, network effects, governance dynamics, etc."
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                        />
                    </div>
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
                                {fieldProposals
                                    .filter(p => p.field !== 'strategicNotes')
                                    .map((proposal) => {
                                        const isApproved = approvedFields.has(proposal.field);
                                        const confidenceColor = proposal.confidence > 0.80 ? 'green' : proposal.confidence >= 0.50 ? 'yellow' : 'red';
                                        const isHighPriority = ['portAuthority', 'portWideIdentitySystem'].includes(proposal.field);
                                        
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
                                                                {proposal.field === 'portAuthority' ? 'Port Authority' :
                                                                 proposal.field === 'customsAuthority' ? 'Customs Authority' :
                                                                 proposal.field === 'portWideIdentitySystem' ? 'Port-Wide Identity System' :
                                                                 proposal.field === 'identityCompetitors' ? 'Identity Competitors' :
                                                                 proposal.field === 'identityAdoptionRate' ? 'Identity Adoption Rate' :
                                                                 proposal.field === 'portLevelISPSRisk' ? 'Port-Level ISPS Risk' :
                                                                 proposal.field === 'ispsEnforcementStrength' ? 'ISPS Enforcement Strength' :
                                                                 proposal.field === 'dominantTOSSystems' ? 'Dominant TOS Systems' :
                                                                 proposal.field === 'dominantACSSystems' ? 'Dominant ACS Systems' :
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
                                
                                {/* Strategic Notes (Always at bottom, always editable) */}
                                {notesProposal && (
                                    <div className="p-3 bg-gray-50 rounded border border-gray-200">
                                        <div className="flex items-center space-x-2 mb-2">
                                            <input
                                                type="checkbox"
                                                checked={approvedFields.has('strategicNotes')}
                                                onChange={() => toggleFieldApproval('strategicNotes')}
                                                className="rounded"
                                            />
                                            <span className="font-semibold text-gray-900">Strategic Notes</span>
                                            <span className="px-1.5 py-0.5 bg-gray-200 text-gray-700 text-xs rounded">Editable</span>
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
                                        disabled={approvedFields.size === 0 && !approvedFields.has('strategicNotes')}
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

                    {/* Full Report Display */}
                    {(fullReport || port.lastDeepResearchReport) && (
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
                                        {fullReport || port.lastDeepResearchReport}
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
