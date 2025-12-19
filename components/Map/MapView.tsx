"use client";

import dynamic from "next/dynamic";
import { TerminalOperator, Port, Cluster, TerminalOperatorProposal } from "@/lib/types";

const Map = dynamic(() => import("./Map"), {
    ssr: false,
    loading: () => (
        <div className="h-full w-full flex items-center justify-center bg-gray-100 text-gray-500">
            Loading Map...
        </div>
    ),
});

interface MapViewProps {
    operators: TerminalOperator[];
    ports: Port[];
    clusters: Cluster[];
    proposals?: TerminalOperatorProposal[];
    selectedClusterId?: string;
    zoomToClusterId?: string;
    zoomToPortId?: string;
    zoomToOperatorId?: string;
    onSelectOperator?: (id: string) => void;
    onSelectProposal?: (id: string) => void;
    onClearSelection?: () => void;
    hasActiveFilter?: boolean;
}

export default function MapView(props: MapViewProps) {
    // onSelectOperator is optional here to prevent crash if not passed, but Map expects it. 
    // We can default it to no-op if undefined.
    return <Map {...props} onSelectOperator={props.onSelectOperator || (() => { })} />;
}
