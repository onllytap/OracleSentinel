import { z } from 'zod';

export const ChatMessageSchema = z.object({
    session_id: z.string()
        .min(1, 'session_id est requis')
        .max(100, 'session_id trop long')
        .regex(/^[a-zA-Z0-9_-]+$/, 'session_id invalide'),
    message: z.string()
        .min(1, 'Le message est requis')
        .max(5000, 'Message trop long (max 5000 caractères)'),
    context: z.object({
        stage: z.string().optional(),
        view: z.string().optional(),
    }).optional(),
});

export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;

export const LeadFormSchema = z.object({
    prenom: z.string()
        .min(1, 'Le prénom est requis')
        .max(100, 'Prénom trop long')
        .regex(/^[a-zA-ZÀ-ÿ\s'-]+$/, 'Prénom invalide'),
    nom: z.string()
        .min(1, 'Le nom est requis')
        .max(100, 'Nom trop long')
        .regex(/^[a-zA-ZÀ-ÿ\s'-]+$/, 'Nom invalide'),
    telephone: z.string()
        .min(1, 'Le téléphone est requis')
        .regex(/^(?:(?:\+|00)33|0)\s*[1-9](?:[\s.-]*\d{2}){4}$/, 'Numéro de téléphone invalide'),
    email: z.string()
        .email('Email invalide')
        .optional()
        .or(z.literal('')),
    projet: z.enum(['Achat', 'Vente', 'Location', 'Autre']),
    details: z.string()
        .max(2000, 'Détails trop longs')
        .optional(),
});

export type LeadFormInput = z.infer<typeof LeadFormSchema>;

export function sanitizeInput(input: string): string {
    return input
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .trim();
}

export function validateChatMessage(data: unknown): { success: true; data: ChatMessageInput } | { success: false; error: string } {
    const result = ChatMessageSchema.safeParse(data);
    if (!result.success) {
        const firstError = result.error.issues[0];
        return { 
            success: false, 
            error: firstError?.message || 'Données invalides' 
        };
    }
    return { 
        success: true, 
        data: {
            ...result.data,
            message: sanitizeInput(result.data.message),
        }
    };
}

export function validateLeadForm(data: unknown): { success: true; data: LeadFormInput } | { success: false; error: string } {
    const result = LeadFormSchema.safeParse(data);
    if (!result.success) {
        const firstError = result.error.issues[0];
        return { 
            success: false, 
            error: firstError?.message || 'Données invalides' 
        };
    }
    return { 
        success: true, 
        data: {
            ...result.data,
            prenom: sanitizeInput(result.data.prenom),
            nom: sanitizeInput(result.data.nom),
            telephone: result.data.telephone.replace(/[^\d+]/g, ''),
            details: result.data.details ? sanitizeInput(result.data.details) : undefined,
        }
    };
}
