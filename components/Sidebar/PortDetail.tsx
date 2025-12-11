import { useState, useEffect } from "react";
import { Port, Cluster } from "@/lib/types";
import { X, Save } from "lucide-react";

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

    useEffect(() => {
        setFormData(port);
        setIsDirty(false);
    }, [port]);

    const handleChange = (field: keyof Port, value: Port[keyof Port]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setIsDirty(true);
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

    return (
        <div className="flex flex-col h-full bg-white shadow-xl">
            <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50 sticky top-0 z-10">
                <h2 className="text-lg font-bold text-gray-900 truncate pr-4">
                    Port Details
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
                    <label className="block text-sm font-medium text-gray-700">Port Name</label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => handleChange("name", e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                    />
                </div>

                <div className="pt-6 border-t border-gray-100 flex justify-between">
                    <button
                        onClick={handleDelete}
                        className="px-4 py-2 bg-red-50 text-red-700 rounded-md text-sm font-medium hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                    >
                        Delete Port
                    </button>

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

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Latitude</label>
                        <input
                            type="number"
                            value={formData.latitude}
                            onChange={(e) => handleChange("latitude", parseFloat(e.target.value))}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Longitude</label>
                        <input
                            type="number"
                            value={formData.longitude}
                            onChange={(e) => handleChange("longitude", parseFloat(e.target.value))}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm"
                        />
                    </div>
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
            </div>
        </div>
    );
};
