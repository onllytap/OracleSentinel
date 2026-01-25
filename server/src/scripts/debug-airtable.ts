import { AirtableService } from '../services/airtable.service';
import dotenv from 'dotenv';
import path from 'path';

// Force load env
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function debugAirtable() {
    console.log('🐞 STARTING AIRTABLE DEBUG...');
    console.log('URL:', process.env.AIRTABLE_WEBHOOK_URL);

    // Create a dummy lead
    const testLead = {
        prenom: 'Jean',
        nom: 'Dupont',
        nom_complet: 'Jean Dupont',
        numero_telephone: '0612345678',
        type: 'Achat',
        besoin: 'Test Debug',
        adresse: 'Paris',
        qualification: 99,
        details: 'Debug Script Test',
        notes: 'Debug Script Test'
    };

    try {
        console.log('📤 Sending POST request...');
        const response = await fetch(process.env.AIRTABLE_WEBHOOK_URL!, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(testLead)
        });

        console.log(`📥 Response Status: ${response.status} ${response.statusText}`);

        const text = await response.text();
        console.log('📝 Raw Response Body:', text);

        try {
            const json = JSON.parse(text);
            console.log('✅ Parsed JSON:', json);
        } catch (e) {
            console.warn('⚠️ Response is NOT JSON');
        }

    } catch (error) {
        console.error('❌ Network Error:', error);
    }
}

debugAirtable();
