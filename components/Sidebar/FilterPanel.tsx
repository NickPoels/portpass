import { Cluster, ClusterId } from "@/lib/types";
import { Search } from "lucide-react";

interface FilterPanelProps {
    clusters: Cluster[];
    selectedClusterId: ClusterId | "ALL";
    onSelectCluster: (id: ClusterId | "ALL") => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
}

export const FilterPanel = ({
    clusters,
    selectedClusterId,
    onSelectCluster,
    searchQuery,
    onSearchChange,
}: FilterPanelProps) => {
    return (
        <div className="p-4 border-b border-gray-200 bg-white space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-gray-700">Terminals</h2>
            </div>

            {/* Search */}
            <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400" />
                </div>
                <input
                    type="text"
                    placeholder="Search terminals..."
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 sm:text-sm"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
            </div>

            {/* Cluster Filter */}
            <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wider">
                    Strategic Cluster
                </label>
                <select
                    value={selectedClusterId}
                    onChange={(e) => onSelectCluster(e.target.value as ClusterId | "ALL")}
                    className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                >
                    <option value="ALL">All Clusters</option>
                    {clusters.map((cluster) => (
                        <option key={cluster.id} value={cluster.id}>
                            {cluster.name}
                        </option>
                    ))}
                </select>
                {selectedClusterId !== "ALL" && (
                    <div className="mt-2 text-xs text-gray-500 bg-gray-50 p-2 rounded border border-gray-100 italic">
                        {clusters.find(c => c.id === selectedClusterId)?.description}
                    </div>
                )}
            </div>
        </div>
    );
};
