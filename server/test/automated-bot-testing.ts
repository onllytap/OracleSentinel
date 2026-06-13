/**
 * ═══════════════════════════════════════════════════════════════════════
 * AUTOMATED BOT TESTING SUITE
 * Tests the chatbot with multiple user profiles and scenarios
 * ═══════════════════════════════════════════════════════════════════════
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

// ═══════════════════════════════════════════════════════════════════════
// TEST PROFILES - Different user behaviors
// ═══════════════════════════════════════════════════════════════════════

interface TestProfile {
    name: string;
    description: string;
    messages: string[];
    expectedFields: string[];
    behavior: 'cooperative' | 'impatient' | 'verbose' | 'minimal' | 'confused' | 'angry';
}

const TEST_PROFILES: TestProfile[] = [
    {
        name: 'Cooperative User',
        description: 'Répond clairement à toutes les questions',
        behavior: 'cooperative',
        messages: [
            'Bonjour',
            'Je cherche un appartement',
            'Aux Sables d\'Olonne',
            'Un T3 environ',
            'Mon budget est de 300 000€',
            'Je m\'appelle Jean Dupont',
            '06 12 34 56 78',
        ],
        expectedFields: ['prenom', 'nom', 'numero_telephone', 'type', 'besoin', 'adresse']
    },
    {
        name: 'Impatient User',
        description: 'Donne toutes les infos d\'un coup',
        behavior: 'impatient',
        messages: [
            'Bonjour je m\'appelle Marie Martin, je cherche un T3 aux Sables d\'Olonne pour 350k€, mon numéro c\'est le 06 98 76 54 32, je veux acheter rapidement'
        ],
        expectedFields: ['prenom', 'nom', 'numero_telephone', 'type', 'besoin', 'adresse']
    },
    {
        name: 'Verbose User',
        description: 'Donne beaucoup de détails non structurés',
        behavior: 'verbose',
        messages: [
            'Bonjour, alors voilà, je vous explique ma situation. Je suis actuellement en location mais je souhaite vraiment acheter quelque chose de bien. J\'ai deux enfants et on cherche vraiment un endroit sympa, pas trop loin de la plage si possible. Mon mari travaille aux Sables d\'Olonne donc ce serait l\'idéal. On a un budget d\'environ 400 000 euros, peut-être un peu plus si c\'est vraiment bien. On cherche au moins 3 chambres, voire 4 si possible. Ah oui, je m\'appelle Sophie Lefebvre et vous pouvez me joindre au 06 45 67 89 12. On aimerait vraiment visiter rapidement parce qu\'on doit libérer notre location actuelle d\'ici 3 mois.'
        ],
        expectedFields: ['prenom', 'nom', 'numero_telephone', 'type', 'besoin', 'adresse']
    },
    {
        name: 'Minimal User',
        description: 'Répond par oui/non, très court',
        behavior: 'minimal',
        messages: [
            'Salut',
            'Oui',
            'Appartement',
            'Sables',
            'T2',
            'Pierre',
            'Durand',
            '0612345678'
        ],
        expectedFields: ['prenom', 'nom', 'numero_telephone', 'type', 'besoin', 'adresse']
    },
    {
        name: 'Confused User',
        description: 'Pose des questions, hésite, change d\'avis',
        behavior: 'confused',
        messages: [
            'Bonjour',
            'Je ne sais pas trop, peut-être un appartement ?',
            'Ou une maison, je ne sais pas',
            'C\'est quoi la différence de prix ?',
            'Ok un appartement alors',
            'Aux Sables ou à La Roche ?',
            'Aux Sables',
            'Je m\'appelle Luc Bernard',
            'Mon numéro ? Attendez... 06 23 45 67 89'
        ],
        expectedFields: ['prenom', 'nom', 'numero_telephone', 'type', 'besoin', 'adresse']
    },
    {
        name: 'Angry User',
        description: 'Frustré, impatient, exigeant',
        behavior: 'angry',
        messages: [
            'Bonjour',
            'Ça fait 3 semaines que j\'attends une réponse !',
            'Je veux un T4 aux Sables, budget 500k',
            'C\'est urgent !',
            'Thomas Rousseau, 06 11 22 33 44',
            'Vous pouvez me rappeler AUJOURD\'HUI ?'
        ],
        expectedFields: ['prenom', 'nom', 'numero_telephone', 'type', 'besoin', 'adresse']
    }
];

// ═══════════════════════════════════════════════════════════════════════
// TEST EXECUTION
// ═══════════════════════════════════════════════════════════════════════

interface TestResult {
    profile: string;
    success: boolean;
    collectedFields: string[];
    missingFields: string[];
    score: number;
    pushedToCRM: boolean;
    conversationLength: number;
    errors: string[];
    duration: number;
}

async function sendMessage(sessionId: string, message: string): Promise<any> {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            session_id: sessionId,
            message: message
        })
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
}

async function testProfile(profile: TestProfile): Promise<TestResult> {
    const sessionId = `test-${profile.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    const startTime = Date.now();
    const errors: string[] = [];
    
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🧪 Testing Profile: ${profile.name}`);
    console.log(`📝 Description: ${profile.description}`);
    console.log(`🎭 Behavior: ${profile.behavior}`);
    console.log(`${'═'.repeat(80)}\n`);

    let lastResponse: any = null;
    let conversationLength = 0;

    try {
        for (const message of profile.messages) {
            console.log(`👤 USER: ${message}`);
            
            const response = await sendMessage(sessionId, message);
            lastResponse = response;
            conversationLength++;

            console.log(`🤖 BOT: ${response.response?.substring(0, 100)}...`);
            
            if (response.qualification) {
                console.log(`📊 Score: ${response.qualification.score}/100`);
                console.log(`📋 Missing: ${response.qualification.missingFields.join(', ') || 'None'}`);
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const duration = Date.now() - startTime;

        // Analyze final result
        const qualification = lastResponse?.qualification || {};
        const collectedFields = profile.expectedFields.filter(
            field => !qualification.missingFields?.includes(field)
        );
        const missingFields = qualification.missingFields || profile.expectedFields;

        const result: TestResult = {
            profile: profile.name,
            success: qualification.isComplete || false,
            collectedFields,
            missingFields,
            score: qualification.score || 0,
            pushedToCRM: qualification.pushedToCRM || false,
            conversationLength,
            errors,
            duration
        };

        console.log(`\n${'─'.repeat(80)}`);
        console.log(`✅ Test Complete`);
        console.log(`   Success: ${result.success ? '✓' : '✗'}`);
        console.log(`   Score: ${result.score}/100`);
        console.log(`   Collected: ${result.collectedFields.join(', ')}`);
        console.log(`   Missing: ${result.missingFields.join(', ') || 'None'}`);
        console.log(`   Pushed to CRM: ${result.pushedToCRM ? '✓' : '✗'}`);
        console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);
        console.log(`${'─'.repeat(80)}\n`);

        return result;

    } catch (error) {
        const duration = Date.now() - startTime;
        errors.push(error instanceof Error ? error.message : String(error));
        
        console.error(`\n❌ Test Failed: ${error}`);
        
        return {
            profile: profile.name,
            success: false,
            collectedFields: [],
            missingFields: profile.expectedFields,
            score: 0,
            pushedToCRM: false,
            conversationLength,
            errors,
            duration
        };
    }
}

async function runAllTests(): Promise<void> {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🚀 AUTOMATED BOT TESTING SUITE`);
    console.log(`📅 ${new Date().toISOString()}`);
    console.log(`🌐 API: ${API_BASE_URL}`);
    console.log(`${'═'.repeat(80)}\n`);

    const results: TestResult[] = [];

    for (const profile of TEST_PROFILES) {
        const result = await testProfile(profile);
        results.push(result);
        
        // Delay between profiles to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Generate summary report
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📊 SUMMARY REPORT`);
    console.log(`${'═'.repeat(80)}\n`);

    const totalTests = results.length;
    const successfulTests = results.filter(r => r.success).length;
    const pushedToCRM = results.filter(r => r.pushedToCRM).length;
    const averageScore = results.reduce((sum, r) => sum + r.score, 0) / totalTests;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    console.log(`Total Tests: ${totalTests}`);
    console.log(`Successful: ${successfulTests}/${totalTests} (${((successfulTests/totalTests)*100).toFixed(1)}%)`);
    console.log(`Pushed to CRM: ${pushedToCRM}/${totalTests} (${((pushedToCRM/totalTests)*100).toFixed(1)}%)`);
    console.log(`Average Score: ${averageScore.toFixed(1)}/100`);
    console.log(`Total Duration: ${(totalDuration/1000).toFixed(2)}s`);

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`DETAILED RESULTS:\n`);

    results.forEach(result => {
        const status = result.success ? '✅' : '❌';
        const crmStatus = result.pushedToCRM ? '📤' : '⏸️';
        console.log(`${status} ${crmStatus} ${result.profile}`);
        console.log(`   Score: ${result.score}/100`);
        console.log(`   Missing: ${result.missingFields.join(', ') || 'None'}`);
        if (result.errors.length > 0) {
            console.log(`   Errors: ${result.errors.join(', ')}`);
        }
        console.log();
    });

    console.log(`${'═'.repeat(80)}\n`);

    // Exit with error code if tests failed
    if (successfulTests < totalTests) {
        console.error(`⚠️  ${totalTests - successfulTests} test(s) failed`);
        process.exit(1);
    } else {
        console.log(`✅ All tests passed!`);
        process.exit(0);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════

if (require.main === module) {
    runAllTests().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { runAllTests, testProfile, TEST_PROFILES };
