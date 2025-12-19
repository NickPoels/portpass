import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Port, Cluster, ISPSRiskLevel, ISPSEnforcementStrength, TerminalOperatorProposal } from "@/lib/types";
import { X, Save, AlertTriangle, Copy, RotateCw, AlertCircle, Check, XCircle, MapPin, ChevronLeft, ChevronRight } from "lucide-react";
import toast from "react-hot-toast";
import ReactMarkdown from "react-markdown";

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
    onProposalsChange?: (proposals: TerminalOperatorProposal[]) => void;
    selectedProposalId?: string | null;
}

export const PortDetail = ({ port, clusters, onClose, onUpdate, onDelete, onProposalsChange, selectedProposalId }: PortDetailProps) => {
    const router = useRouter();
    const [formData, setFormData] = useState<Port>(port);
    const [isDirty, setIsDirty] = useState(false);
    const [isResearching, setIsResearching] = useState(false);
    const [researchStatus, setResearchStatus] = useState("");
    const [showPreview, setShowPreview] = useState(false);
    const [fullReport, setFullReport] = useState<string | null>(null);
    const [showFullReport, setShowFullReport] = useState(false);
    const [selectedReportIndex, setSelectedReportIndex] = useState<number | null>(null);
    const [availableReports, setAvailableReports] = useState<Array<{title: string, content: string}>>([]);
    const [lastError, setLastError] = useState<ErrorInfo | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const [dataToUpdate, setDataToUpdate] = useState<any>(null);
    const [activityLog, setActivityLog] = useState<Array<{message: string, step: string, progress: number, timestamp: Date, completed: boolean}>>([]);
    const [currentProgress, setCurrentProgress] = useState(0);
    const [fieldProposals, setFieldProposals] = useState<Array<any>>([]);
    const [approvedFields, setApprovedFields] = useState<Set<string>>(new Set());
    const [notesProposal, setNotesProposal] = useState<{currentNotes: string, newFindings: string, combinedNotes: string} | null>(null);
    
    // Operator discovery state
    const [isFindingOperators, setIsFindingOperators] = useState(false);
    const [operatorDiscoveryStatus, setOperatorDiscoveryStatus] = useState("");
    const [operatorDiscoveryProgress, setOperatorDiscoveryProgress] = useState(0);
    const [operatorProposals, setOperatorProposals] = useState<Array<{
        id: string;
        name: string;
        operatorType: string | null;
        latitude: number | null;
        longitude: number | null;
        status: string;
    }>>([]);
    const [selectedOperatorIds, setSelectedOperatorIds] = useState<Set<string>>(new Set());
    const [isProcessingOperators, setIsProcessingOperators] = useState(false);
    const [highlightedProposalId, setHighlightedProposalId] = useState<string | null>(null);
    const operatorAbortControllerRef = useRef<AbortController | null>(null);
    const proposalRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    // Extract research process (thinking tags) from content
    const extractResearchProcess = (content: string): { cleaned: string, process?: string } => {
        // Extract all <think>...</think> blocks
        const thinkPattern = /<think>([\s\S]*?)<\/think>/gi;
        const thinkBlocks: string[] = [];
        let cleaned = content;
        let match;
        
        while ((match = thinkPattern.exec(content)) !== null) {
            thinkBlocks.push(match[1].trim());
            cleaned = cleaned.replace(match[0], '').trim();
        }
        
        // Combine all thinking blocks
        const process = thinkBlocks.length > 0 
            ? thinkBlocks.join('\n\n---\n\n')
            : undefined;
        
        return { cleaned, process };
    };

    // Parse combined report into individual reports
    const parseReports = (combinedReport: string): Array<{title: string, content: string, researchProcess?: string}> => {
        const reports: Array<{title: string, content: string, researchProcess?: string}> = [];
        const fallbackTitles = [
            'Governance Report',
            'ISPS Risk & Enforcement Report',
            'Strategic Intelligence Report',
            'Verification Report'
        ];
        
        // Try to split by separator first
        const sections = combinedReport.split('\n\n---\n\n');
        
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i].trim();
            if (!section) continue;
            
            // Try multiple regex patterns for header extraction
            let title: string | null = null;
            let content = section;
            
            // Pattern 1: ## Title followed by \n\n
            const pattern1 = section.match(/^##\s+(.+?)\n\n/s);
            if (pattern1) {
                title = pattern1[1].trim();
                content = section.replace(/^##\s+.+?\n\n/s, '').trim();
            } else {
                // Pattern 2: ## Title followed by single \n
                const pattern2 = section.match(/^##\s+(.+?)\n/s);
                if (pattern2) {
                    title = pattern2[1].trim();
                    content = section.replace(/^##\s+.+?\n/s, '').trim();
                } else {
                    // Pattern 3: ## Title at start of line
                    const pattern3 = section.match(/^##\s+(.+?)$/m);
                    if (pattern3) {
                        title = pattern3[1].trim();
                        content = section.replace(/^##\s+.+?\n?/m, '').trim();
                    }
                }
            }
            
            // Use fallback title if extraction failed
            if (!title && i < fallbackTitles.length) {
                title = fallbackTitles[i];
            } else if (!title) {
                title = `Report ${i + 1}`;
            }
            
            // Extract research process and clean content
            const { cleaned, process } = extractResearchProcess(content);
            
            if (cleaned) {
                reports.push({ 
                    title, 
                    content: cleaned,
                    researchProcess: process
                });
            }
        }
        
        // Fallback: if no sections found, treat entire report as one
        if (reports.length === 0 && combinedReport.trim()) {
            const { cleaned, process } = extractResearchProcess(combinedReport.trim());
            reports.push({ 
                title: 'Full Research Report', 
                content: cleaned,
                researchProcess: process
            });
        }
        
        return reports;
    };

    useEffect(() => {
        setFormData(port);
        setIsDirty(false);
        
        // Load stored full research report from port prop
        if (port.lastDeepResearchReport && !fullReport) {
            setFullReport(port.lastDeepResearchReport);
            const parsed = parseReports(port.lastDeepResearchReport);
            setAvailableReports(parsed);
        }
        
        // Load operator proposals
        loadOperatorProposals();
    }, [port]);

    // Notify parent when proposals change
    useEffect(() => {
        if (onProposalsChange) {
            // Convert to TerminalOperatorProposal format
            const proposals: TerminalOperatorProposal[] = operatorProposals.map(p => ({
                id: p.id,
                portId: port.id,
                name: p.name,
                operatorType: (p.operatorType === 'commercial' || p.operatorType === 'captive') ? p.operatorType : null,
                parentCompanies: null, // Will be loaded from API
                capacity: null,
                cargoTypes: null,
                latitude: p.latitude,
                longitude: p.longitude,
                locations: null,
                status: (p.status || "pending") as "pending" | "approved" | "rejected",
                createdAt: new Date().toISOString(),
                approvedAt: null
            }));
            onProposalsChange(proposals);
        }
    }, [operatorProposals, port.id, onProposalsChange]);

    // Keyboard navigation for report view
    useEffect(() => {
        if (!showFullReport || selectedReportIndex === null) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't trigger if user is typing in an input/textarea
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                if (selectedReportIndex !== null && selectedReportIndex > 0) {
                    setSelectedReportIndex(selectedReportIndex - 1);
                }
            } else if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                if (selectedReportIndex !== null && selectedReportIndex < availableReports.length - 1) {
                    setSelectedReportIndex(selectedReportIndex + 1);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setSelectedReportIndex(null);
            } else if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !e.shiftKey) {
                // Only copy if not in input field (browser default handles input copying)
                if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
                    e.preventDefault();
                    const reportToCopy = selectedReportIndex !== null && selectedReportIndex !== -1 && availableReports[selectedReportIndex]
                        ? availableReports[selectedReportIndex].content
                        : fullReport || port.lastDeepResearchReport;
                    if (reportToCopy) {
                        navigator.clipboard.writeText(reportToCopy);
                        toast.success('Report copied to clipboard');
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showFullReport, selectedReportIndex, availableReports.length, availableReports, fullReport, port.lastDeepResearchReport]);

    const loadOperatorProposals = async () => {
        try {
            const response = await fetch(`/api/operator-proposals?portId=${port.id}&status=pending`);
            if (response.ok) {
                const data = await response.json();
                setOperatorProposals(data.map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    operatorType: p.operatorType,
                    latitude: p.latitude,
                    longitude: p.longitude,
                    status: p.status
                })));
            }
        } catch (error) {
            console.error('Failed to load operator proposals:', error);
        }
    };

    const handleChange = (field: keyof Port, value: Port[keyof Port]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setIsDirty(true);
    };

    const handleArrayChange = (field: "identityCompetitors", value: string) => {
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
        setResearchStatus("Starting research job...");
        setShowPreview(false);
        setFullReport(null);
        setAvailableReports([]);
        setSelectedReportIndex(null);

        // Clear any existing polling
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }

        try {
            // Start a background research job
            const startResponse = await fetch(`/api/ports/${port.id}/deep-research/start`, {
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
                        // Job completed, refresh port data to get results
                        setIsResearching(false);
                        setResearchStatus("Research complete - Review changes");
                        setCurrentProgress(100);
                        
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
                            setAvailableReports([]);
                            setSelectedReportIndex(null);
                            // The useEffect will reload the report when port prop updates
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

    const startFindOperators = async () => {
        setIsFindingOperators(true);
        setOperatorDiscoveryStatus("Initializing...");
        setOperatorDiscoveryProgress(0);

        operatorAbortControllerRef.current = new AbortController();
        const abortController = operatorAbortControllerRef.current;

        try {
            const response = await fetch(`/api/ports/${port.id}/find-operators`, {
                method: "POST",
                signal: abortController.signal,
            });

            if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
                const errorData = await response.json();
                toast.error(errorData.message || 'Failed to start operator discovery');
                setIsFindingOperators(false);
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
                            setOperatorDiscoveryStatus(data.message);
                            setOperatorDiscoveryProgress(data.progress || 0);
                        } else if (eventType === "preview") {
                            setOperatorProposals(data.proposals || []);
                            setOperatorDiscoveryStatus("Operator discovery complete");
                            setIsFindingOperators(false);
                            await loadOperatorProposals(); // Reload to get all proposals
                            toast.success(`Found ${data.new_proposals} new operator(s)`);
                        } else if (eventType === "error") {
                            const errorInfo: ErrorInfo = {
                                category: data.category || 'UNKNOWN_ERROR',
                                message: data.message || 'An unexpected error occurred.',
                                originalError: data.originalError,
                                retryable: data.retryable !== false
                            };
                            setIsFindingOperators(false);
                            toast.error(errorInfo.message);
                        }
                    }
                }
            }
        } catch (e) {
            if (e instanceof Error && (e.name === 'AbortError' || e.message.includes('aborted'))) {
                setIsFindingOperators(false);
                setOperatorDiscoveryStatus("Cancelled");
                toast.success('Operator discovery cancelled');
                return;
            }
            
            setIsFindingOperators(false);
            toast.error('Failed to discover operators. Please try again.');
        }
    };

    const cancelFindOperators = () => {
        if (operatorAbortControllerRef.current) {
            operatorAbortControllerRef.current.abort();
            operatorAbortControllerRef.current = null;
        }
        setIsFindingOperators(false);
        setOperatorDiscoveryStatus("Cancelling...");
    };

    const handleOperatorToggle = (id: string) => {
        setSelectedOperatorIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleSelectAllOperators = () => {
        if (selectedOperatorIds.size === operatorProposals.length) {
            setSelectedOperatorIds(new Set());
        } else {
            setSelectedOperatorIds(new Set(operatorProposals.map(p => p.id)));
        }
    };

    // Scroll to and highlight a proposal when selected from map
    const scrollToProposal = useCallback((proposalId: string) => {
        const proposalElement = proposalRefs.current.get(proposalId);
        if (proposalElement) {
            // Highlight the proposal
            setHighlightedProposalId(proposalId);
            
            // Scroll to the proposal
            proposalElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Remove highlight after 3 seconds
            setTimeout(() => {
                setHighlightedProposalId(null);
            }, 3000);
        }
    }, []);

    // Listen for proposal selection from map
    useEffect(() => {
        if (selectedProposalId) {
            scrollToProposal(selectedProposalId);
        }
    }, [selectedProposalId, scrollToProposal]);

    const handleApproveOperators = async (proposalIds: string[]) => {
        if (proposalIds.length === 0) {
            toast.error('Please select at least one operator');
            return;
        }

        setIsProcessingOperators(true);
        try {
            const response = await fetch('/api/operator-proposals/batch-approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proposalIds,
                    action: 'approve'
                })
            });

            if (!response.ok) throw new Error('Failed to approve operators');

            const result = await response.json();
            toast.success(`Approved ${result.approvedCount} operator(s). Created ${result.createdOperators.length} operator(s).`);
            
            setSelectedOperatorIds(new Set());
            await loadOperatorProposals();
            
            // Refresh the page data to show newly created operators
            router.refresh();
        } catch (error) {
            toast.error(`Failed to approve operators: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsProcessingOperators(false);
        }
    };

    const handleRejectOperators = async (proposalIds: string[]) => {
        if (proposalIds.length === 0) {
            toast.error('Please select at least one operator');
            return;
        }

        setIsProcessingOperators(true);
        try {
            const response = await fetch('/api/operator-proposals/batch-approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proposalIds,
                    action: 'reject'
                })
            });

            if (!response.ok) throw new Error('Failed to reject operators');

            const result = await response.json();
            toast.success(`Rejected ${result.rejectedCount} operator(s).`);
            
            setSelectedOperatorIds(new Set());
            await loadOperatorProposals();
        } catch (error) {
            toast.error(`Failed to reject operators: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsProcessingOperators(false);
        }
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
        if (selectedReportIndex !== null && availableReports[selectedReportIndex]) {
            navigator.clipboard.writeText(availableReports[selectedReportIndex].content);
            toast.success('Report copied to clipboard');
        } else {
            const reportToCopy = fullReport || port.lastDeepResearchReport;
            if (reportToCopy) {
                navigator.clipboard.writeText(reportToCopy);
                toast.success('Report copied to clipboard');
            }
        }
    };

    const handleReportSelect = (index: number) => {
        setSelectedReportIndex(index);
    };

    const handlePreviousReport = () => {
        if (selectedReportIndex !== null && selectedReportIndex > 0) {
            setSelectedReportIndex(selectedReportIndex - 1);
        }
    };

    const handleNextReport = () => {
        if (selectedReportIndex !== null && selectedReportIndex < availableReports.length - 1) {
            setSelectedReportIndex(selectedReportIndex + 1);
        }
    };

    const handleBackToSelection = () => {
        setSelectedReportIndex(null);
    };

    const reportContent = fullReport || port.lastDeepResearchReport;

    return (
        <div className="flex flex-col h-full bg-white shadow-xl">
            <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50 sticky top-0 z-10">
                <h2 className="text-lg font-bold text-gray-900 truncate pr-4">
                    {showFullReport 
                        ? (selectedReportIndex !== null && availableReports[selectedReportIndex]
                            ? availableReports[selectedReportIndex].title
                            : "Full Research Report")
                        : "Port Details"}
                </h2>
                <div className="flex items-center space-x-2">
                    {showFullReport ? (
                        <button 
                            onClick={() => {
                                setShowFullReport(false);
                                setSelectedReportIndex(null);
                            }} 
                            className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200"
                            title="Back to Port Details"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    ) : (
                        <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200">
                            <X className="h-5 w-5" />
                        </button>
                    )}
                </div>
            </div>

            {showFullReport && reportContent ? (
                selectedReportIndex === null ? (
                    // Report selection interface
                    <div className="flex-1 overflow-y-auto p-6">
                        <div className="max-w-none">
                            <div className="mb-6">
                                <h3 className="text-lg font-semibold text-gray-900 mb-2">Select a Report to View</h3>
                                <p className="text-sm text-gray-600">Choose one of the research reports below to view in detail.</p>
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                {availableReports.length > 0 ? (
                                    availableReports.map((report, index) => (
                                        <button
                                            key={index}
                                            onClick={() => handleReportSelect(index)}
                                            className="text-left p-4 border-2 border-gray-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-all"
                                        >
                                            <h4 className="font-semibold text-gray-900 mb-1">{report.title}</h4>
                                            <p className="text-xs text-gray-500 line-clamp-2">
                                                {report.content.substring(0, 150)}...
                                            </p>
                                        </button>
                                    ))
                                ) : (
                                    // Fallback: show combined report option if parsing failed
                                    <button
                                        onClick={() => setSelectedReportIndex(-1)}
                                        className="text-left p-4 border-2 border-gray-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-all"
                                    >
                                        <h4 className="font-semibold text-gray-900 mb-1">Full Research Report</h4>
                                        <p className="text-xs text-gray-500">View the complete research report</p>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    // Selected report view with navigation
                    <div className="flex-1 overflow-y-auto p-6">
                        <div className="max-w-none">
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-gray-200 bg-gray-50 -mx-6 px-4 sm:px-6 py-3 sticky top-0 z-10">
                                {/* Left Section: Back Navigation */}
                                <div className="flex items-center">
                                    <button
                                        onClick={handleBackToSelection}
                                        className="flex items-center space-x-1 px-3 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors font-medium min-h-[44px]"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        <span className="hidden sm:inline">Back to Selection</span>
                                        <span className="sm:hidden">Back</span>
                                    </button>
                                </div>

                                {/* Center Section: Report Navigation */}
                                {availableReports.length > 1 && (
                                    <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-3 px-2 sm:px-4 border-l border-r border-gray-200 flex-1 justify-center">
                                        <button
                                            onClick={handlePreviousReport}
                                            disabled={selectedReportIndex === 0 || selectedReportIndex === null || selectedReportIndex === -1}
                                            className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium min-h-[44px]"
                                            title="Previous Report (←)"
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                        </button>
                                        <div className="text-center min-w-[200px]">
                                            <div className="text-sm font-semibold text-gray-900">
                                                {selectedReportIndex !== null && selectedReportIndex !== -1 && availableReports[selectedReportIndex]
                                                    ? availableReports[selectedReportIndex].title
                                                    : 'Full Research Report'}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {selectedReportIndex !== null && selectedReportIndex !== -1
                                                    ? `${selectedReportIndex + 1} of ${availableReports.length}`
                                                    : '1 of 1'}
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleNextReport}
                                            disabled={selectedReportIndex === null || selectedReportIndex === availableReports.length - 1 || selectedReportIndex === -1}
                                            className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium min-h-[44px]"
                                            title="Next Report (→)"
                                        >
                                            <ChevronRight className="h-4 w-4" />
                                        </button>
                                    </div>
                                )}

                                {/* Right Section: Actions */}
                                <div className="flex items-center justify-end">
                                    <button
                                        onClick={copyFullReport}
                                        className="flex items-center space-x-1 px-4 py-2 text-sm bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors font-medium min-h-[44px]"
                                        title="Copy Report (Cmd/Ctrl+C)"
                                    >
                                        <Copy className="h-4 w-4" />
                                        <span>Copy</span>
                                    </button>
                                </div>
                            </div>
                            
                            {/* Research Process Section */}
                            {selectedReportIndex !== null && selectedReportIndex !== -1 && availableReports[selectedReportIndex]?.researchProcess && (
                                <details className="mb-6 border border-blue-200 rounded-lg bg-blue-50">
                                    <summary className="px-4 py-3 cursor-pointer flex items-center space-x-2 hover:bg-blue-100 transition-colors">
                                        <AlertCircle className="h-4 w-4 text-blue-600 flex-shrink-0" />
                                        <span className="font-semibold text-blue-900">Research Process</span>
                                        <span className="text-xs text-blue-600 ml-auto">Click to expand</span>
                                    </summary>
                                    <div className="px-4 pb-4 pt-2 border-t border-blue-200">
                                        <div className="bg-white rounded p-3 border border-blue-100">
                                            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono overflow-x-auto">
                                                {availableReports[selectedReportIndex].researchProcess}
                                            </pre>
                                        </div>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(availableReports[selectedReportIndex].researchProcess || '');
                                                toast.success('Research process copied to clipboard');
                                            }}
                                            className="mt-2 flex items-center space-x-1 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                                        >
                                            <Copy className="h-3 w-3" />
                                            <span>Copy</span>
                                        </button>
                                    </div>
                                </details>
                            )}
                            
                            <div className="markdown-content text-sm text-gray-700 leading-relaxed">
                                <ReactMarkdown
                                    components={{
                                        h1: ({node, ...props}) => <h1 className="text-2xl font-bold text-gray-900 mt-6 mb-4" {...props} />,
                                        h2: ({node, ...props}) => <h2 className="text-xl font-bold text-gray-900 mt-5 mb-3" {...props} />,
                                        h3: ({node, ...props}) => <h3 className="text-lg font-semibold text-gray-900 mt-4 mb-2" {...props} />,
                                        h4: ({node, ...props}) => <h4 className="text-base font-semibold text-gray-900 mt-3 mb-2" {...props} />,
                                        p: ({node, ...props}) => <p className="mb-4" {...props} />,
                                        ul: ({node, ...props}) => <ul className="list-disc list-inside mb-4 space-y-1 ml-4" {...props} />,
                                        ol: ({node, ...props}) => <ol className="list-decimal list-inside mb-4 space-y-1 ml-4" {...props} />,
                                        li: ({node, ...props}) => <li className="mb-1" {...props} />,
                                        strong: ({node, ...props}) => <strong className="font-semibold text-gray-900" {...props} />,
                                        em: ({node, ...props}) => <em className="italic" {...props} />,
                                        code: ({node, ...props}) => <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-xs font-mono" {...props} />,
                                        pre: ({node, ...props}) => <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto mb-4" {...props} />,
                                        a: ({node, ...props}) => <a className="text-blue-600 hover:text-blue-800 hover:underline" {...props} />,
                                        blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-gray-300 pl-4 italic my-4 text-gray-600" {...props} />,
                                        hr: ({node, ...props}) => <hr className="my-6 border-gray-300" {...props} />,
                                    }}
                                >
                                    {selectedReportIndex !== null && selectedReportIndex !== -1 && availableReports[selectedReportIndex]
                                        ? availableReports[selectedReportIndex].content
                                        : reportContent}
                                </ReactMarkdown>
                            </div>
                        </div>
                    </div>
                )
            ) : (
                // Port Details form view
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
                    </div>
                </div>

                {/* Identity System Section */}
                <div className="pt-6 border-t border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4">Identity Systems</h3>
                    <div className="space-y-4">
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

                {/* Operator Discovery Section */}
                <div className="pt-6 border-t border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4">Terminal Operator Discovery</h3>
                    
                    {/* Find Terminal Operators Button */}
                    {!isFindingOperators && (
                        <button
                            onClick={startFindOperators}
                            className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2 shadow-sm"
                        >
                            <MapPin className="h-4 w-4" />
                            <span>Find Terminal Operators</span>
                        </button>
                    )}

                    {/* Discovery Progress */}
                    {isFindingOperators && (
                        <div className="space-y-3 mb-4">
                            <div className="flex items-center justify-between text-sm text-blue-700">
                                <div className="flex items-center space-x-2">
                                    <span className="animate-spin">⏳</span>
                                    <span className="font-medium">{operatorDiscoveryStatus}</span>
                                    <span className="text-xs text-blue-500">({operatorDiscoveryProgress}%)</span>
                                </div>
                                <button
                                    onClick={cancelFindOperators}
                                    className="px-2 py-1 text-xs bg-white border border-blue-300 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                            <div className="h-2 bg-blue-200 rounded-full overflow-hidden">
                                <div 
                                    className={`h-full transition-all duration-300 ${
                                        operatorDiscoveryProgress < 50 ? 'bg-blue-500' : 
                                        operatorDiscoveryProgress < 90 ? 'bg-yellow-500' : 
                                        'bg-green-500'
                                    }`}
                                    style={{ width: `${operatorDiscoveryProgress}%` }}
                                ></div>
                            </div>
                        </div>
                    )}

                    {/* Operator Proposals List */}
                    {operatorProposals.length > 0 && !isFindingOperators && (
                        <div className="mt-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-gray-900">
                                    Operator Proposals ({operatorProposals.length})
                                </h4>
                                <div className="flex items-center space-x-2">
                                    <button
                                        onClick={handleSelectAllOperators}
                                        className="text-xs text-blue-600 hover:text-blue-800"
                                    >
                                        {selectedOperatorIds.size === operatorProposals.length ? 'Deselect All' : 'Select All'}
                                    </button>
                                </div>
                            </div>

                            {/* Batch Actions */}
                            {selectedOperatorIds.size > 0 && (
                                <div className="flex space-x-2">
                                    <button
                                        onClick={() => handleApproveOperators(Array.from(selectedOperatorIds))}
                                        disabled={isProcessingOperators}
                                        className="flex-1 flex items-center justify-center space-x-1 px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Check className="w-4 h-4" />
                                        <span>Approve ({selectedOperatorIds.size})</span>
                                    </button>
                                    <button
                                        onClick={() => handleRejectOperators(Array.from(selectedOperatorIds))}
                                        disabled={isProcessingOperators}
                                        className="flex-1 flex items-center justify-center space-x-1 px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <XCircle className="w-4 h-4" />
                                        <span>Reject ({selectedOperatorIds.size})</span>
                                    </button>
                                </div>
                            )}

                            {/* Proposals List */}
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {operatorProposals.map((proposal) => (
                                    <div
                                        key={proposal.id}
                                        ref={(el) => {
                                            if (el) {
                                                proposalRefs.current.set(proposal.id, el);
                                            } else {
                                                proposalRefs.current.delete(proposal.id);
                                            }
                                        }}
                                        className={`border rounded-lg p-3 cursor-pointer transition-all duration-300 ${
                                            highlightedProposalId === proposal.id
                                                ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-300 shadow-md'
                                                : selectedOperatorIds.has(proposal.id)
                                                ? 'border-blue-500 bg-blue-50'
                                                : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                        onClick={() => handleOperatorToggle(proposal.id)}
                                    >
                                        <div className="flex items-start space-x-3">
                                            <input
                                                type="checkbox"
                                                checked={selectedOperatorIds.has(proposal.id)}
                                                onChange={() => handleOperatorToggle(proposal.id)}
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
                                                {(proposal.latitude && proposal.longitude) ? (
                                                    <p className="text-xs text-gray-600 mt-1">
                                                        Location: {proposal.latitude.toFixed(4)}, {proposal.longitude.toFixed(4)}
                                                    </p>
                                                ) : (
                                                    <p className="text-xs text-gray-500 mt-1">Location unknown</p>
                                                )}
                                            </div>
                                            <div className="flex space-x-1">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleApproveOperators([proposal.id]);
                                                    }}
                                                    disabled={isProcessingOperators}
                                                    className="p-1.5 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                                                    title="Approve"
                                                >
                                                    <Check className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRejectOperators([proposal.id]);
                                                    }}
                                                    disabled={isProcessingOperators}
                                                    className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                                                    title="Reject"
                                                >
                                                    <XCircle className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {operatorProposals.length === 0 && !isFindingOperators && (
                        <p className="text-xs text-gray-500 mt-2">No pending operator proposals. Click "Find Terminal Operators" to discover operators for this port.</p>
                    )}
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
                                        const isHighPriority = ['portAuthority'].includes(proposal.field);
                                        
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
                                                                 proposal.field === 'identityCompetitors' ? 'Identity Competitors' :
                                                                 proposal.field === 'identityAdoptionRate' ? 'Identity Adoption Rate' :
                                                                 proposal.field === 'portLevelISPSRisk' ? 'Port-Level ISPS Risk' :
                                                                 proposal.field === 'ispsEnforcementStrength' ? 'ISPS Enforcement Strength' :
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

                    {/* Full Report Display Button */}
                    {reportContent && (
                        <div className="mb-3">
                            <button
                                onClick={() => {
                                    setShowFullReport(true);
                                    setSelectedReportIndex(null);
                                }}
                                className="w-full py-2 px-3 bg-white border border-purple-300 text-purple-700 text-xs font-medium rounded hover:bg-purple-100 transition-colors flex items-center justify-between"
                            >
                                <span>View Full Research Report</span>
                                <AlertTriangle className="h-3 w-3" />
                            </button>
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
            )}

            {/* Footer with Delete and Save buttons - only show when not viewing full report */}
            {!showFullReport && (
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
            )}
        </div>
    );
};
