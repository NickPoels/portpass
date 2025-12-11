import React from "react";
import { PlusCircle } from "lucide-react";

interface ActionPanelProps {
    onAddCluster: () => void;
    onAddPort: () => void;
    onAddTerminal: () => void;
}

export const ActionPanel = ({ onAddCluster, onAddPort, onAddTerminal }: ActionPanelProps) => {
    return (
        <div className="p-4 space-y-3 bg-white border-t border-gray-200">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Actions</h3>

            <button
                onClick={onAddCluster}
                className="w-full flex items-center justify-start space-x-2 px-3 py-2 text-sm text-brand-dark bg-brand-primary hover:bg-opacity-90 border border-brand-primary rounded-md transition-colors font-medium"
                title="Create New Cluster"
            >
                <PlusCircle className="w-4 h-4 text-brand-dark" />
                <span>Add Cluster</span>
            </button>

            <button
                onClick={onAddPort}
                className="w-full flex items-center justify-start space-x-2 px-3 py-2 text-sm text-brand-dark bg-brand-primary hover:bg-opacity-90 border border-brand-primary rounded-md transition-colors font-medium"
                title="Create New Port"
            >
                <PlusCircle className="w-4 h-4 text-brand-dark" />
                <span>Add Port</span>
            </button>

            <button
                onClick={onAddTerminal}
                className="w-full flex items-center justify-start space-x-2 px-3 py-2 text-sm text-brand-dark bg-brand-primary hover:bg-opacity-90 border border-brand-primary rounded-md transition-colors shadow-sm font-medium"
                title="Create New Terminal"
            >
                <PlusCircle className="w-4 h-4" />
                <span>Add Terminal</span>
            </button>
        </div>
    );
};
