"use client";

import dynamic from "next/dynamic";
import { Terminal, Port, Cluster } from "@/lib/types";

const Map = dynamic(() => import("./Map"), {
    ssr: false,
    loading: () => (
        <div className="h-full w-full flex items-center justify-center bg-gray-100 text-gray-500">
            Loading Map...
        </div>
    ),
});

interface MapViewProps {
    terminals: Terminal[];
    ports: Port[];
    clusters: Cluster[];
    selectedClusterId?: string;
    onSelectTerminal?: (id: string) => void;
    onClearSelection?: () => void;
    hasActiveFilter?: boolean;
}

export default function MapView(props: MapViewProps) {
    // onSelectTerminal is optional here to prevent crash if not passed, but Map expects it. 
    // We can default it to no-op if undefined.
    return <Map {...props} onSelectTerminal={props.onSelectTerminal || (() => { })} />;
}
