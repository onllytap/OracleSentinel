import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2, CheckCircle, Calendar, ChevronDown, ChevronUp, X } from 'lucide-react';

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

export function LeadForm({ onSubmit }: LeadFormProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);

    const { register, handleSubmit, formState: { errors } } = useForm<LeadFormData>();

    const onFormSubmit = async (data: LeadFormData) => {
        setIsSubmitting(true);
        try {
            await onSubmit(data);
            setIsSuccess(true);
        } catch (error) {
            console.error('Submission failed', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isSuccess) {
        return (
            <div className="bg-green-50/50 border border-green-100 rounded-2xl p-6 text-center animate-fade-in shadow-sm">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckCircle className="w-6 h-6 text-green-600" />
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
            >
                <Calendar className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-gray-700">Reprendre ma demande de visite</span>
                <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />
            </button>
        );
    }

    return (
        <div className="bg-white/80 backdrop-blur-sm border border-gray-100 rounded-2xl p-5 shadow-sm w-full max-w-sm animate-slide-up relative group">
            {/* Header with Cancel/Collapse Action */}
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                        <Calendar className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                        <h3 className="font-medium text-gray-900 text-sm">Organiser une visite</h3>
                        <p className="text-xs text-gray-500">Remplissez ce formulaire pour être rappelé.</p>
                    </div>
                </div>
                <button
                    onClick={() => setIsCollapsed(true)}
                    className="p-1 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-600"
                    title="Masquer le formulaire"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <input
                            {...register('prenom', { required: true })}
                            placeholder="Prénom"
                            className={`w-full px-3 py-2 bg-white border ${errors.prenom ? 'border-red-300' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all placeholder:text-gray-400`}
                        />
                        {errors.prenom && <span className="text-[10px] text-red-500 ml-1 block mt-0.5">Requis</span>}
                    </div>
                    <div>
                        <input
                            {...register('nom', { required: true })}
                            placeholder="Nom"
                            className={`w-full px-3 py-2 bg-white border ${errors.nom ? 'border-red-300' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all placeholder:text-gray-400`}
                        />
                        {errors.nom && <span className="text-[10px] text-red-500 ml-1 block mt-0.5">Requis</span>}
                    </div>
                </div>

                <div>
                    <input
                        {...register('telephone', {
                            required: true,
                            pattern: /^(?:(?:\+|00)33|0)\s*[1-9](?:[\s.-]*\d{2}){4}$/
                        })}
                        placeholder="Téléphone (06...)"
                        type="tel"
                        className={`w-full px-3 py-2 bg-white border ${errors.telephone ? 'border-red-300' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all placeholder:text-gray-400`}
                    />
                    {errors.telephone && <span className="text-[10px] text-red-500 ml-1 block mt-0.5">Numéro invalide (ex: 06 12 34 56 78)</span>}
                </div>

                <div>
                    <select
                        {...register('projet')}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
                    >
                        <option value="Achat">Je veux acheter</option>
                        <option value="Location">Je cherche une location</option>
                        <option value="Vente">Je vends un bien</option>
                        <option value="Autre">Autre demande</option>
                    </select>
                </div>

                <div>
                    <textarea
                        {...register('details')}
                        placeholder="Précisez votre recherche (Budget, secteur, critères...)"
                        rows={3}
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
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Envoi...
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
