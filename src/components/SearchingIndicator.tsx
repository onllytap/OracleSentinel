import React from 'react';
import { Search } from 'lucide-react';

interface SearchingIndicatorProps {
    searchText?: string;
}

/**
 * Premium Shadcn-style "Searching..." indicator with animated shimmer text.
 * Minimal, elegant, non-intrusive design.
 */
export function SearchingIndicator({ searchText = "Recherche sur le site" }: SearchingIndicatorProps) {
    return (
        <div className="flex items-center gap-3 py-2 animate-fade-in">
            {/* Pulsing search icon */}
            <div className="relative">
                <Search className="w-4 h-4 text-blue-500 animate-pulse" />
                <div className="absolute inset-0 w-4 h-4 bg-blue-400/30 rounded-full animate-ping" />
            </div>

            {/* Shimmer text */}
            <span className="text-sm font-medium shimmer-text">
                {searchText}
                <span className="shimmer-dots">...</span>
            </span>
        </div>
    );
}
