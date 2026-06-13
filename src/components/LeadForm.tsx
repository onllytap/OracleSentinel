import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2, CheckCircle, Calendar, ChevronDown, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

type LeadFormData = {
    prenom: string;
    nom: string;
    telephone: string;
    email?: string;
    projet: 'Achat' | 'Vente' | 'Location' | 'Autre';
    details?: string;
    disponibilite?: string;
};

interface LeadFormProps {
    onSubmit: (data: LeadFormData) => Promise<void>;
}

const STORAGE_KEY = 'leadForm:v1';
const DEBOUNCE_MS = 500;

function loadFormData(): Partial<LeadFormData> | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

function saveFormData(data: Partial<LeadFormData>): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
}

function clearFormData(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {}
}

export function LeadForm({ onSubmit }: LeadFormProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);
    const firstInputRef = useRef<HTMLInputElement>(null);
    const { showError } = useToast();

    const savedData = loadFormData();
    const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<LeadFormData>({
        defaultValues: {
            prenom: savedData?.prenom || '',
            nom: savedData?.nom || '',
            telephone: savedData?.telephone || '',
            email: savedData?.email || '',
            projet: savedData?.projet || 'Achat',
            details: savedData?.details || '',
        }
    });

    const formValues = watch();
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
            saveFormData(formValues);
        }, DEBOUNCE_MS);

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [formValues]);

    useEffect(() => {
        if (!isCollapsed && firstInputRef.current) {
            firstInputRef.current.focus();
        }
    }, [isCollapsed]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setIsCollapsed(true);
        }
    }, []);

    const onFormSubmit = async (data: LeadFormData) => {
        setIsSubmitting(true);
        try {
            await onSubmit(data);
            clearFormData();
            setIsSuccess(true);
        } catch (error) {
            console.error('Submission failed', error);
            const status = (error as any)?.status;
            const code = (error as any)?.code;

            if (code === 'DUPLICATE_PHONE' || status === 409) {
                const message = error instanceof Error && error.message
                    ? error.message
                    : "Ce numéro de téléphone a déjà été utilisé récemment. Merci d'en saisir un autre.";
                showError(message);
            } else {
                showError('Erreur de connexion, réessayez.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isSuccess) {
        return (
            <div 
                role="alert" 
                aria-live="polite"
                className="bg-green-50/50 border border-green-100 rounded-2xl p-6 text-center animate-fade-in shadow-sm"
            >
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckCircle className="w-6 h-6 text-green-600" aria-hidden="true" />
                </div>
                <h3 className="font-semibold text-green-900 mb-1">Demande reçue !</h3>
                <p className="text-sm text-green-700">
                    Un conseiller Buchy Immobilier vous recontactera très rapidement.
                </p>
            </div>
        );
    }

    if (isCollapsed) {
        return (
            <button
                onClick={() => setIsCollapsed(false)}
                className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm hover:bg-gray-50 transition-colors w-full sm:w-auto animate-fade-in"
                aria-label="Reprendre le formulaire de demande de visite"
            >
                <Calendar className="w-4 h-4 text-blue-600" aria-hidden="true" />
                <span className="text-sm font-medium text-gray-700">Reprendre ma demande de visite</span>
                <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" aria-hidden="true" />
            </button>
        );
    }

    const prenomRegister = register('prenom', { required: 'Le prénom est requis' });
    const { ref: prenomFormRef, ...prenomField } = prenomRegister;

    return (
        <div 
            className="bg-white/80 backdrop-blur-sm border border-gray-100 rounded-2xl p-5 shadow-sm w-full max-w-sm animate-slide-up relative group"
            role="dialog"
            aria-labelledby="form-title"
            aria-describedby="form-description"
            onKeyDown={handleKeyDown}
        >
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                        <Calendar className="w-4 h-4 text-blue-600" aria-hidden="true" />
                    </div>
                    <div>
                        <h3 id="form-title" className="font-medium text-gray-900 text-sm">Organiser une visite</h3>
                        <p id="form-description" className="text-xs text-gray-500">Remplissez ce formulaire pour être rappelé.</p>
                    </div>
                </div>
                <button
                    onClick={() => setIsCollapsed(true)}
                    className="p-1 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-600"
                    aria-label="Masquer le formulaire"
                    type="button"
                >
                    <X className="w-4 h-4" aria-hidden="true" />
                </button>
            </div>

            <form 
                ref={formRef}
                onSubmit={handleSubmit(onFormSubmit)} 
                className="space-y-3"
                noValidate
            >
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label htmlFor="prenom" className="sr-only">Prénom</label>
                        <input
                            {...prenomField}
                            id="prenom"
                            ref={(el) => {
                                prenomFormRef(el);
                                firstInputRef.current = el;
                            }}
                            placeholder="Prénom"
                            autoComplete="given-name"
                            aria-required="true"
                            aria-invalid={errors.prenom ? 'true' : 'false'}
                            aria-describedby={errors.prenom ? 'prenom-error' : undefined}
                            className={`w-full px-3 py-2 bg-white border ${errors.prenom ? 'border-red-300' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all placeholder:text-gray-400`}
                        />
                        {errors.prenom && (
                            <span id="prenom-error" role="alert" className="text-[10px] text-red-500 ml-1 block mt-0.5">
                                Requis
                            </span>
                        )}
                    </div>
                    <div>
                        <label htmlFor="nom" className="sr-only">Nom</label>
                        <input
                            {...register('nom', { required: 'Le nom est requis' })}
                            id="nom"
                            placeholder="Nom"
                            autoComplete="family-name"
                            aria-required="true"
                            aria-invalid={errors.nom ? 'true' : 'false'}
                            aria-describedby={errors.nom ? 'nom-error' : undefined}
                            className={`w-full px-3 py-2 bg-white border ${errors.nom ? 'border-red-300' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all placeholder:text-gray-400`}
                        />
                        {errors.nom && (
                            <span id="nom-error" role="alert" className="text-[10px] text-red-500 ml-1 block mt-0.5">
                                Requis
                            </span>
                        )}
                    </div>
                </div>

                <div>
                    <label htmlFor="telephone" className="sr-only">Téléphone</label>
                    <input
                        {...register('telephone', {
                            required: 'Le numéro de téléphone est requis',
                            pattern: {
                                value: /^(?:(?:\+|00)33|0)\s*[1-9](?:[\s.-]*\d{2}){4}$/,
                                message: 'Numéro invalide (ex: 06 12 34 56 78)'
                            }
                        })}
                        id="telephone"
                        placeholder="Téléphone (06...)"
                        type="tel"
                        autoComplete="tel"
                        aria-required="true"
                        aria-invalid={errors.telephone ? 'true' : 'false'}
                        aria-describedby={errors.telephone ? 'telephone-error' : undefined}
                        className={`w-full px-3 py-2 bg-white border ${errors.telephone ? 'border-red-300' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all placeholder:text-gray-400`}
                    />
                    {errors.telephone && (
                        <span id="telephone-error" role="alert" className="text-[10px] text-red-500 ml-1 block mt-0.5">
                            {errors.telephone.message}
                        </span>
                    )}
                </div>

                <div>
                    <label htmlFor="projet" className="sr-only">Type de projet</label>
                    <select
                        {...register('projet')}
                        id="projet"
                        aria-label="Type de projet immobilier"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
                    >
                        <option value="Achat">Je veux acheter</option>
                        <option value="Location">Je cherche une location</option>
                        <option value="Vente">Je vends un bien</option>
                        <option value="Autre">Autre demande</option>
                    </select>
                </div>

                <div>
                    <label htmlFor="details" className="sr-only">Détails de votre recherche</label>
                    <textarea
                        {...register('details')}
                        id="details"
                        placeholder="Précisez votre recherche (Budget, secteur, critères...)"
                        rows={3}
                        aria-label="Détails de votre recherche immobilière"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all placeholder:text-gray-400 resize-none"
                    />
                </div>

                <div className="flex gap-2 pt-1">
                    <button
                        type="button"
                        onClick={() => setIsCollapsed(true)}
                        className="flex-shrink-0 px-4 py-2 bg-white border border-gray-200 text-gray-600 font-medium rounded-xl text-sm hover:bg-gray-50 transition-all"
                    >
                        Annuler
                    </button>
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        style={{ backgroundColor: '#000000', color: '#ffffff' }}
                        className="flex-1 font-medium py-2 rounded-xl text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-gray-200 hover:opacity-90"
                        aria-busy={isSubmitting}
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                <span>Envoi...</span>
                            </>
                        ) : (
                            'Valider'
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}
