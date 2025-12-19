"use client";

import React, { useState, useRef, useEffect } from "react";
import { PlusCircle, ChevronDown, FileText, ShieldCheck } from "lucide-react";

interface ActionPanelProps {
    onAddCluster: () => void;
    onAddPort: () => void;
    onAddTerminal: () => void;
    onViewProposals?: () => void;
    onDataQualityCheck?: () => void;
}

export const ActionPanel = ({ onAddCluster, onAddPort, onAddTerminal, onViewProposals, onDataQualityCheck }: ActionPanelProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    const handleAction = (action: () => void) => {
        action();
        setIsOpen(false);
    };

    return (
        <div className="p-4 bg-white border-t border-gray-200" ref={dropdownRef}>
            <div className="relative">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full flex items-center justify-center space-x-2 px-3 py-2.5 text-sm text-brand-dark bg-brand-primary hover:bg-opacity-90 border border-brand-primary rounded-md transition-colors font-medium shadow-sm"
                    title="Add new item"
                >
                    <PlusCircle className="w-4 h-4" />
                    <span>Add</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <div className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-gray-200 rounded-md shadow-lg z-30 overflow-hidden">
                        <button
                            onClick={() => handleAction(onAddCluster)}
                            className="w-full flex items-center space-x-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                        >
                            <PlusCircle className="w-4 h-4 text-gray-500" />
                            <span>Add Cluster</span>
                        </button>
                        <button
                            onClick={() => handleAction(onAddPort)}
                            className="w-full flex items-center space-x-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left border-t border-gray-100"
                        >
                            <PlusCircle className="w-4 h-4 text-gray-500" />
                            <span>Add Port</span>
                        </button>
                        <button
                            onClick={() => handleAction(onAddTerminal)}
                            className="w-full flex items-center space-x-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left border-t border-gray-100"
                        >
                            <PlusCircle className="w-4 h-4 text-gray-500" />
                            <span>Add Terminal Operator</span>
                        </button>
                        {onViewProposals && (
                            <button
                                onClick={() => handleAction(onViewProposals)}
                                className="w-full flex items-center space-x-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left border-t border-gray-100"
                            >
                                <FileText className="w-4 h-4 text-gray-500" />
                                <span>View Operator Proposals</span>
                            </button>
                        )}
                        {onDataQualityCheck && (
                            <button
                                onClick={() => handleAction(onDataQualityCheck)}
                                className="w-full flex items-center space-x-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left border-t border-gray-100"
                            >
                                <ShieldCheck className="w-4 h-4 text-gray-500" />
                                <span>Data Quality Check</span>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
