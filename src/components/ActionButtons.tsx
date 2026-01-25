import React from 'react';
import { Calendar, Phone, ClipboardList, Home, MapPin, MessageCircle } from 'lucide-react';

// ============================================
// TYPES
// ============================================

export type ActionType =
    | 'schedule_visit'      // Planifier une visite
    | 'request_callback'    // Être rappelé
    | 'request_estimate'    // Demander une estimation
    | 'view_properties'     // Voir les biens
    | 'contact_agent'       // Contacter un agent
    | 'get_directions';     // Voir l'itinéraire

export interface ActionButton {
    type: ActionType;
    label: string;
    data?: Record<string, unknown>;
}

interface ActionButtonsProps {
    actions: ActionButton[];
    onAction: (action: ActionButton) => void;
    disabled?: boolean;
}

// ============================================
// ACTION ICONS
// ============================================

const actionIcons: Record<ActionType, React.ComponentType<{ className?: string }>> = {
    schedule_visit: Calendar,
    request_callback: Phone,
    request_estimate: ClipboardList,
    view_properties: Home,
    contact_agent: MessageCircle,
    get_directions: MapPin,
};

// ============================================
// ACTION COLORS (Gradient classes)
// ============================================

const actionStyles: Record<ActionType, { bg: string; hover: string; icon: string }> = {
    schedule_visit: {
        bg: 'bg-gradient-to-r from-violet-500 to-purple-600',
        hover: 'hover:from-violet-600 hover:to-purple-700',
        icon: 'text-violet-100'
    },
    request_callback: {
        bg: 'bg-gradient-to-r from-emerald-500 to-teal-600',
        hover: 'hover:from-emerald-600 hover:to-teal-700',
        icon: 'text-emerald-100'
    },
    request_estimate: {
        bg: 'bg-gradient-to-r from-blue-500 to-indigo-600',
        hover: 'hover:from-blue-600 hover:to-indigo-700',
        icon: 'text-blue-100'
    },
    view_properties: {
        bg: 'bg-gradient-to-r from-amber-500 to-orange-600',
        hover: 'hover:from-amber-600 hover:to-orange-700',
        icon: 'text-amber-100'
    },
    contact_agent: {
        bg: 'bg-gradient-to-r from-pink-500 to-rose-600',
        hover: 'hover:from-pink-600 hover:to-rose-700',
        icon: 'text-pink-100'
    },
    get_directions: {
        bg: 'bg-gradient-to-r from-cyan-500 to-sky-600',
        hover: 'hover:from-cyan-600 hover:to-sky-700',
        icon: 'text-cyan-100'
    }
};

// ============================================
// COMPONENT
// ============================================

export function ActionButtons({ actions, onAction, disabled = false }: ActionButtonsProps) {
    if (!actions || actions.length === 0) return null;

    return (
        <div className="grid grid-cols-2 gap-2 mt-3 animate-fade-in w-full">
            {actions.map((action, index) => {
                const Icon = actionIcons[action.type] || MessageCircle;
                const styles = actionStyles[action.type] || actionStyles.contact_agent;

                return (
                    <button
                        key={`${action.type}-${index}`}
                        onClick={() => onAction(action)}
                        disabled={disabled}
                        className={`
                            group relative flex items-center justify-center gap-2 
                            w-full px-3 py-2.5 rounded-xl
                            ${styles.bg} ${styles.hover}
                            text-white font-medium text-sm
                            shadow-md
                            transform transition-all duration-200
                            hover:scale-[1.02] hover:shadow-lg
                            active:scale-[0.98]
                            disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                            backdrop-blur-sm
                        `}
                        style={{
                            animationDelay: `${index * 100}ms`
                        }}
                    >
                        {/* Shine effect on hover */}
                        <span className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent 
                                           translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                        </span>

                        <Icon className={`w-4 h-4 ${styles.icon} relative z-10 flex-shrink-0`} />
                        <span className="relative z-10 truncate">{action.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

// ============================================
// HELPER: Generate default actions based on context
// ============================================

export function getDefaultActions(context: 'property' | 'general' | 'qualified'): ActionButton[] {
    switch (context) {
        case 'property':
            return [
                { type: 'schedule_visit', label: '📅 Visiter' },
                { type: 'request_callback', label: '📞 Rappel' },
            ];
        case 'qualified':
            return [
                { type: 'schedule_visit', label: '📅 Visite' },
                { type: 'request_callback', label: '📞 Rappel' },
                { type: 'request_estimate', label: '📋 Estimation' },
            ];
        case 'general':
        default:
            return [
                { type: 'view_properties', label: '🏠 Voir biens' },
                { type: 'contact_agent', label: '💬 Contacter' },
            ];
    }
}
