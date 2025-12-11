import { useState, useEffect } from "react";
import { Terminal, Cluster, Port, CargoType, ISPSRiskLevel } from "@/lib/types";
import { X, Save, AlertTriangle } from "lucide-react";

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

const RISK_OPTIONS: ISPSRiskLevel[] = ["Low", "Medium", "High", "Very High"];

export const TerminalDetail = ({ terminal, clusters, ports, onClose, onUpdate, onDelete }: TerminalDetailProps) => {
    const [formData, setFormData] = useState<Terminal>(terminal);
    const [isDirty, setIsDirty] = useState(false);
    const [isResearching, setIsResearching] = useState(false);
    const [researchStatus, setResearchStatus] = useState("");

    // Sync state when terminal prop changes
    useEffect(() => {
        setFormData(terminal);
        setIsDirty(false);
    }, [terminal]);

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

    const startDeepResearch = async () => {
        console.log("Deep Research button clicked");
        setIsResearching(true);
        setResearchStatus("Initializing...");

        try {
            console.log(`Fetching from /api/terminals/${terminal.id}/deep-research...`);
            const response = await fetch(`/api/terminals/${terminal.id}/deep-research`, {
                method: "POST",
            });
            console.log("Response status:", response.status);

            if (!response.body) {
                console.error("No response body received");
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
                // Keep the last partial event in the buffer
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
                        } else if (eventType === "complete") {
                            // The API returns raw DB fields (strings), so we must parse them
                            const raw = data.terminal;
                            const parsedTerminal: Terminal = {
                                ...raw,
                                cargoTypes: typeof raw.cargoTypes === 'string' ? JSON.parse(raw.cargoTypes) : raw.cargoTypes,
                                leadership: raw.leadership && typeof raw.leadership === 'string' ? JSON.parse(raw.leadership) : raw.leadership,
                                cargoSpecializations: raw.cargoSpecializations && typeof raw.cargoSpecializations === 'string' ? JSON.parse(raw.cargoSpecializations) : raw.cargoSpecializations,
                                lastDeepResearchAt: raw.lastDeepResearchAt // already string or Date
                            };

                            onUpdate(parsedTerminal);
                            setFormData(parsedTerminal);
                            setResearchStatus("Completed");
                        } else if (eventType === "error") {
                            alert(`Error: ${data.message}`);
                        }
                    }
                }
            }
        } catch (e) {
            console.error(e);
            alert("Deep research failed to start");
        } finally {
            setIsResearching(false);
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
                    {isDirty && (
                        <button
                            onClick={handleSave}
                            className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center text-xs font-semibold px-3 transition-colors"
                        >
                            <Save className="h-4 w-4 mr-1.5" />
                            Save
                        </button>
                    )}
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
                        <label className="block text-sm font-medium text-gray-700">Official Name</label>
                        <input
                            type="text"
                            value={formData.officialName || ""}
                            onChange={(e) => handleChange("officialName", e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            placeholder="Registered entity name"
                        />
                    </div>
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
                </div>

                <div className="border-t border-gray-100 pt-4 grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Volume</label>
                        <input
                            type="text"
                            value={formData.estAnnualVolume}
                            onChange={(e) => handleChange("estAnnualVolume", e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                            placeholder="e.g. 1.2M TEU"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">ISPS Risk</label>
                        <select
                            value={formData.ispsRiskLevel}
                            onChange={(e) => handleChange("ispsRiskLevel", e.target.value as ISPSRiskLevel)}
                            className={`mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm font-medium ${formData.ispsRiskLevel === "High" || formData.ispsRiskLevel === "Very High" ? "text-red-600 bg-red-50" : ""
                                }`}
                        >
                            {RISK_OPTIONS.map(r => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-span-2">
                        <label className="block text-xs text-gray-500 mb-1">ISPS/Security Reason</label>
                        <textarea
                            rows={2}
                            value={formData.ispsComplianceReason || ""}
                            onChange={(e) => handleChange("ispsComplianceReason", e.target.value)}
                            className="block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm bg-gray-50"
                            placeholder="Reasoning for security level..."
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

                {/* Deep Research Details */}
                <div className="border-t border-gray-100 pt-4 space-y-3">
                    <h4 className="text-sm font-medium text-gray-900">Infrastructure & Operations</h4>

                    <div>
                        <label className="block text-xs font-medium text-gray-500">Infrastructure</label>
                        <textarea
                            rows={3}
                            value={formData.infrastructure || ""}
                            onChange={(e) => handleChange("infrastructure", e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-xs"
                            placeholder="Berths, cranes, draft..."
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-500">Digital / Security Systems</label>
                        <input
                            type="text"
                            value={formData.digitalizationSecurity || ""}
                            onChange={(e) => handleChange("digitalizationSecurity", e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-xs"
                        />
                    </div>
                </div>

                {/* Notes */}
                <div className="border-t border-gray-100 pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Intel</label>
                    <textarea
                        rows={4}
                        value={formData.notes || ""}
                        onChange={(e) => handleChange("notes", e.target.value)}
                        placeholder="Add strategic notes, ownership details, or local intelligence..."
                        className="block w-full border border-gray-300 rounded-md shadow-sm p-3 text-sm focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>

                {/* Deletion Area */}
                <div className="pt-6 border-t border-gray-100 flex justify-between">
                    <button
                        onClick={handleDelete}
                        className="px-4 py-2 bg-red-50 text-red-700 rounded-md text-sm font-medium hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                    >
                        Delete Terminal
                    </button>
                </div>

                {/* Deep Research Agent */}
                <div className="mt-8 bg-purple-50 rounded-lg p-4 border border-purple-100">
                    <div className="flex items-center mb-2">
                        <AlertTriangle className="h-4 w-4 text-purple-600 mr-2" />
                        <h4 className="text-sm font-bold text-purple-900">Deep Research Agent</h4>
                    </div>

                    {formData.lastDeepResearchAt && !isResearching && (
                        <div className="mb-3 text-xs text-purple-800">
                            <p className="font-semibold">Last researched: {new Date(formData.lastDeepResearchAt).toLocaleString()}</p>
                            {formData.lastDeepResearchSummary && (
                                <div className="mt-2 p-2 bg-white rounded border border-purple-100 max-h-40 overflow-y-auto">
                                    <p className="whitespace-pre-wrap">{formData.lastDeepResearchSummary}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {isResearching ? (
                        <div className="space-y-2">
                            <div className="flex items-center space-x-2 text-sm text-purple-700">
                                <span className="animate-spin">⏳</span>
                                <span className="font-medium">{researchStatus}</span>
                            </div>
                            <div className="h-1 bg-purple-200 rounded-full overflow-hidden">
                                <div className="h-full bg-purple-600 animate-pulse w-full"></div>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={startDeepResearch}
                            className="w-full py-2 bg-white border border-purple-300 text-purple-700 text-sm font-medium rounded hover:bg-purple-100 transition-colors flex items-center justify-center shadow-sm"
                        >
                            Start Deep Research
                        </button>
                    )}
                </div>

            </div>
        </div>
    );
};
