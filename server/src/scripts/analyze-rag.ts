import { KnowledgeService } from '../services/knowledge.service';
import dotenv from 'dotenv';
import path from 'path';

// Force load env
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function analyzeRagPipeline() {
    console.log('🕵️‍♂️ STARTING RAG PIPELINE ANALYSIS...\n');

    // 1. Analyze Detection Logic (Trigger)
    console.log('🔍 PHASE 1: Detection Logic Analysis');
    console.log('----------------------------------------');

    const testQueries = [
        "Bonjour, comment ça va ?", // Should NOT trigger
        "Avez-vous des appartements à vendre ?", // Should trigger
        "Je cherche une maison", // Should trigger
        "Quel est votre numéro ?", // Should trigger (agency info?) or maybe not if handled by system prompt, but keywords might trigger
        "C'est quoi le prix ?", // Should trigger
        "Ok merci", // Should NOT trigger
        "Je veux visiter demain" // Should trigger (visiter -> often implies viewing a property) => Actually 'visiter' is not in the list I saw earlier? Let's check.
    ];

    for (const query of testQueries) {
        const triggers = KnowledgeService.needsKnowledgeLookup(query);
        console.log(`"${query}" \t=> ${triggers ? '✅ TRIGGER' : '❌ SKIP'}`);
    }

    // 2. Analyze Scraper Integration & Context Build
    console.log('\n🧠 PHASE 2: Context Generation Analysis');
    console.log('----------------------------------------');
    console.log('Simulating query: "Je cherche un appartement aux sables"');

    try {
        const chunks = await KnowledgeService.searchKnowledge({ query: "Je cherche un appartement aux sables", tenantId: 'default' });

        console.log(`\n📚 Retrieved ${chunks.length} chunks of knowledge.`);

        if (chunks.length > 0) {
            const context = KnowledgeService.buildContext(chunks);
            console.log('\n📝 GENERATED CONTEXT FOR LLM (First 1000 chars):');
            console.log('==================================================');
            console.log(context.substring(0, 1000));
            console.log('...');
            console.log('==================================================');

            // Analyze typical issues
            if (context.includes('NaN')) console.error('⚠️ WARNING: Context contains NaN values!');
            if (context.includes('undefined')) console.error('⚠️ WARNING: Context contains "undefined"!');
            if (context.length < 100) console.error('⚠️ WARNING: Context seems too short!');

        } else {
            console.warn('⚠️ WARNING: No chunks retrieved. Scraper might have returned nothing?');
        }

    } catch (error) {
        console.error('❌ ERROR in pipeline:', error);
    }

    process.exit();
}

analyzeRagPipeline();
