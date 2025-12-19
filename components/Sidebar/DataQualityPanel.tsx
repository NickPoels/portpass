"use client";

import { useState, useEffect } from "react";
import { X, Check, XCircle, Loader2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import toast from "react-hot-toast";

interface ValidationResult {
    passed: boolean;
    errors: Array<{ id: string; name: string; message: string }>;
    warnings: Array<{ id: string; name: string; message: string }>;
}

interface PortClusterCheck extends ValidationResult {
    portsPerCluster: Array<{ clusterId: string; clusterName: string; portCount: number }>;
}

interface OperatorPortCheck extends ValidationResult {
    operatorsPerPort: Array<{ portId: string; portName: string; operatorCount: number }>;
}

interface DataQualityCheckResult {
    overallStatus: 'pass' | 'fail';
    statistics: {
        totalClusters: number;
        totalPorts: number;
        totalOperators: number;
    };
    portClusterCheck: PortClusterCheck;
    operatorPortCheck: OperatorPortCheck;
}

interface DataQualityPanelProps {
    onClose: () => void;
}

export const DataQualityPanel = ({ onClose }: DataQualityPanelProps) => {
    const [result, setResult] = useState<DataQualityCheckResult | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['summary', 'portCluster', 'operatorPort']));

    useEffect(() => {
        loadDataQualityCheck();
    }, []);

    const loadDataQualityCheck = async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/data-quality/check');
            if (!response.ok) throw new Error('Failed to run data quality check');
            
            const data = await response.json();
            setResult(data);
        } catch (error) {
            console.error('Error running data quality check:', error);
            toast.error('Failed to run data quality check');
        } finally {
            setIsLoading(false);
        }
    };

    const toggleSection = (section: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            if (next.has(section)) {
                next.delete(section);
            } else {
                next.add(section);
            }
            return next;
        });
    };

    if (isLoading) {
        return (
            <div className="flex flex-col h-full bg-white shadow-xl">
                <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-900">Data Quality Check</h2>
                    <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
            </div>
        );
    }

    if (!result) {
        return (
            <div className="flex flex-col h-full bg-white shadow-xl">
                <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-900">Data Quality Check</h2>
                    <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="flex-1 flex items-center justify-center p-8">
                    <div className="text-center">
                        <p className="text-gray-500 text-sm">Failed to load data quality check results</p>
                        <button
                            onClick={loadDataQualityCheck}
                            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white shadow-xl">
            <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50 sticky top-0 z-10">
                <div className="flex items-center space-x-2">
                    <h2 className="text-lg font-bold text-gray-900">Data Quality Check</h2>
                    {result.overallStatus === 'pass' ? (
                        <Check className="h-5 w-5 text-green-600" />
                    ) : (
                        <XCircle className="h-5 w-5 text-red-600" />
                    )}
                </div>
                <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200">
                    <X className="h-5 w-5" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Overall Status */}
                <div className={`p-4 rounded-lg border-2 ${
                    result.overallStatus === 'pass' 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-red-50 border-red-200'
                }`}>
                    <div className="flex items-center space-x-2">
                        {result.overallStatus === 'pass' ? (
                            <>
                                <Check className="h-5 w-5 text-green-600" />
                                <span className="font-semibold text-green-900">All checks passed</span>
                            </>
                        ) : (
                            <>
                                <XCircle className="h-5 w-5 text-red-600" />
                                <span className="font-semibold text-red-900">Some checks failed</span>
                            </>
                        )}
                    </div>
                </div>

                {/* Summary Statistics */}
                <div className="border border-gray-200 rounded-lg">
                    <button
                        onClick={() => toggleSection('summary')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                        <h3 className="font-semibold text-gray-900">Summary Statistics</h3>
                        {expandedSections.has('summary') ? (
                            <ChevronUp className="h-4 w-4 text-gray-500" />
                        ) : (
                            <ChevronDown className="h-4 w-4 text-gray-500" />
                        )}
                    </button>
                    {expandedSections.has('summary') && (
                        <div className="p-4 space-y-2">
                            <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Total Clusters:</span>
                                <span className="text-sm font-medium text-gray-900">{result.statistics.totalClusters}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Total Ports:</span>
                                <span className="text-sm font-medium text-gray-900">{result.statistics.totalPorts}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Total Operators:</span>
                                <span className="text-sm font-medium text-gray-900">{result.statistics.totalOperators}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* One Port Per Cluster Check */}
                <div className="border border-gray-200 rounded-lg">
                    <button
                        onClick={() => toggleSection('portCluster')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                        <div className="flex items-center space-x-2">
                            <h3 className="font-semibold text-gray-900">One Port Per Cluster</h3>
                            {result.portClusterCheck.passed ? (
                                <Check className="h-4 w-4 text-green-600" />
                            ) : (
                                <XCircle className="h-4 w-4 text-red-600" />
                            )}
                        </div>
                        {expandedSections.has('portCluster') ? (
                            <ChevronUp className="h-4 w-4 text-gray-500" />
                        ) : (
                            <ChevronDown className="h-4 w-4 text-gray-500" />
                        )}
                    </button>
                    {expandedSections.has('portCluster') && (
                        <div className="p-4 space-y-4">
                            {result.portClusterCheck.errors.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center space-x-2 text-red-600">
                                        <AlertTriangle className="h-4 w-4" />
                                        <span className="text-sm font-medium">Errors ({result.portClusterCheck.errors.length})</span>
                                    </div>
                                    <div className="space-y-1">
                                        {result.portClusterCheck.errors.map((error, idx) => (
                                            <div key={idx} className="text-xs text-red-700 bg-red-50 p-2 rounded">
                                                <span className="font-medium">{error.name}</span> ({error.id}): {error.message}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {result.portClusterCheck.warnings.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center space-x-2 text-yellow-600">
                                        <AlertTriangle className="h-4 w-4" />
                                        <span className="text-sm font-medium">Warnings ({result.portClusterCheck.warnings.length})</span>
                                    </div>
                                    <div className="space-y-1">
                                        {result.portClusterCheck.warnings.map((warning, idx) => (
                                            <div key={idx} className="text-xs text-yellow-700 bg-yellow-50 p-2 rounded">
                                                <span className="font-medium">{warning.name}</span> ({warning.id}): {warning.message}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {result.portClusterCheck.errors.length === 0 && result.portClusterCheck.warnings.length === 0 && (
                                <div className="text-sm text-green-700 bg-green-50 p-3 rounded">
                                    ✓ All ports are correctly assigned to clusters
                                </div>
                            )}
                            <div className="border-t pt-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-2">Ports Per Cluster</h4>
                                <div className="space-y-1 max-h-48 overflow-y-auto">
                                    {result.portClusterCheck.portsPerCluster.map((item, idx) => (
                                        <div key={idx} className="flex justify-between text-xs py-1">
                                            <span className="text-gray-600">{item.clusterName}</span>
                                            <span className="font-medium text-gray-900">{item.portCount} port(s)</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Operators Per Port Check */}
                <div className="border border-gray-200 rounded-lg">
                    <button
                        onClick={() => toggleSection('operatorPort')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                        <div className="flex items-center space-x-2">
                            <h3 className="font-semibold text-gray-900">Operators Per Port</h3>
                            {result.operatorPortCheck.passed ? (
                                <Check className="h-4 w-4 text-green-600" />
                            ) : (
                                <XCircle className="h-4 w-4 text-red-600" />
                            )}
                        </div>
                        {expandedSections.has('operatorPort') ? (
                            <ChevronUp className="h-4 w-4 text-gray-500" />
                        ) : (
                            <ChevronDown className="h-4 w-4 text-gray-500" />
                        )}
                    </button>
                    {expandedSections.has('operatorPort') && (
                        <div className="p-4 space-y-4">
                            {result.operatorPortCheck.errors.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center space-x-2 text-red-600">
                                        <AlertTriangle className="h-4 w-4" />
                                        <span className="text-sm font-medium">Errors ({result.operatorPortCheck.errors.length})</span>
                                    </div>
                                    <div className="space-y-1">
                                        {result.operatorPortCheck.errors.map((error, idx) => (
                                            <div key={idx} className="text-xs text-red-700 bg-red-50 p-2 rounded">
                                                <span className="font-medium">{error.name}</span> ({error.id}): {error.message}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {result.operatorPortCheck.warnings.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center space-x-2 text-yellow-600">
                                        <AlertTriangle className="h-4 w-4" />
                                        <span className="text-sm font-medium">Warnings ({result.operatorPortCheck.warnings.length})</span>
                                    </div>
                                    <div className="space-y-1">
                                        {result.operatorPortCheck.warnings.map((warning, idx) => (
                                            <div key={idx} className="text-xs text-yellow-700 bg-yellow-50 p-2 rounded">
                                                <span className="font-medium">{warning.name}</span> ({warning.id}): {warning.message}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {result.operatorPortCheck.errors.length === 0 && result.operatorPortCheck.warnings.length === 0 && (
                                <div className="text-sm text-green-700 bg-green-50 p-3 rounded">
                                    ✓ All operators are correctly assigned to ports
                                </div>
                            )}
                            <div className="border-t pt-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-2">Operators Per Port</h4>
                                <div className="space-y-1 max-h-48 overflow-y-auto">
                                    {result.operatorPortCheck.operatorsPerPort.length > 0 ? (
                                        result.operatorPortCheck.operatorsPerPort.map((item, idx) => (
                                            <div key={idx} className="flex justify-between text-xs py-1">
                                                <span className="text-gray-600">{item.portName}</span>
                                                <span className="font-medium text-gray-900">{item.operatorCount} operator(s)</span>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-xs text-gray-500">No operators found</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Refresh Button */}
                <button
                    onClick={loadDataQualityCheck}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                    Refresh Check
                </button>
            </div>
        </div>
    );
};

