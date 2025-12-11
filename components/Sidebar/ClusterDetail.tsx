import { useState, useEffect } from "react";
import { Cluster, PriorityTier } from "@/lib/types";
import { X, Save } from "lucide-react";

interface ClusterDetailProps {
    cluster: Cluster;
    onClose: () => void;
    onUpdate: (updated: Cluster) => void;
    onDelete: () => void;
}

export const ClusterDetail = ({ cluster, onClose, onUpdate, onDelete }: ClusterDetailProps) => {
    const [formData, setFormData] = useState<Cluster>(cluster);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        setFormData(cluster);
        setIsDirty(false);
    }, [cluster]);

    const handleChange = (field: keyof Cluster, value: Cluster[keyof Cluster]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setIsDirty(true);
    };

    const handleSave = () => {
        onUpdate(formData);
        setIsDirty(false);
    };

    const handleDelete = () => {
        if (window.confirm(`Are you sure you want to delete ${cluster.name}? This will delete ALL ports and terminals in this cluster.`)) {
            onDelete();
        }
    };

    return (
        <div className="flex flex-col h-full bg-white shadow-xl">
            <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50 sticky top-0 z-10">
                <h2 className="text-lg font-bold text-gray-900 truncate pr-4">
                    Cluster Details
                </h2>
                <div className="flex items-center space-x-2">
                    {isDirty && (
                        <button onClick={handleSave} className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center text-xs font-semibold px-3">
                            <Save className="h-4 w-4 mr-1.5" /> Save
                        </button>
                    )}
                    <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200">
                        <X className="h-5 w-5" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                <div>
                    <button
                        onClick={handleSave}
                        disabled={!isDirty}
                        className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${isDirty
                            ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        <Save className="w-4 h-4" />
                        <span>Save Changes</span>
                    </button>
                </div>

                <div className="pt-6 border-t border-gray-100 flex justify-between">
                    <button
                        onClick={handleDelete}
                        className="px-4 py-2 bg-red-50 text-red-700 rounded-md text-sm font-medium hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                    >
                        Delete Cluster
                    </button>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Cluster Name</label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => handleChange("name", e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <textarea
                        rows={3}
                        value={formData.description}
                        onChange={(e) => handleChange("description", e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Priority Tier</label>
                    <select
                        value={formData.priorityTier}
                        onChange={(e) => handleChange("priorityTier", parseInt(e.target.value) as PriorityTier)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    >
                        <option value={1}>Tier 1 (Critical)</option>
                        <option value={2}>Tier 2 (Strategic)</option>
                        <option value={3}>Tier 3 (Emerging)</option>
                    </select>
                </div>
            </div>
        </div>
    );
};
