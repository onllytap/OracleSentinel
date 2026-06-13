/**
 * ═══════════════════════════════════════════════════════════════════════
 * QUICK TEST - Single conversation test for debugging
 * ═══════════════════════════════════════════════════════════════════════
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

async function sendMessage(sessionId: string, message: string): Promise<any> {
    console.log(`\n👤 USER: ${message}`);
    
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

    const data = await response.json();
    
    console.log(`🤖 BOT: ${data.response}`);
    
    if (data.qualification) {
        console.log(`\n📊 Qualification:`);
        console.log(`   Score: ${data.qualification.score}/100`);
        console.log(`   Complete: ${data.qualification.isComplete ? '✅' : '❌'}`);
        console.log(`   Missing: ${data.qualification.missingFields.join(', ') || 'None'}`);
        console.log(`   Pushed to CRM: ${data.qualification.pushedToCRM ? '✅' : '❌'}`);
    }
    
    return data;
}

async function quickTest() {
    const sessionId = `quick-test-${Date.now()}`;
    
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🧪 QUICK TEST - Session: ${sessionId}`);
    console.log(`${'═'.repeat(80)}`);

    try {
        // Test scenario: User gives all info at once (the problematic case)
        await sendMessage(
            sessionId,
            "Bonjour je m'appelle Sophie Lefebvre, je cherche un T3 aux Sables d'Olonne pour environ 350 000 euros, mon numéro c'est le 06 45 67 89 12, je voudrais acheter rapidement"
        );

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Follow up
        await sendMessage(
            sessionId,
            "Oui je suis disponible cette semaine pour une visite"
        );

        console.log(`\n${'═'.repeat(80)}`);
        console.log(`✅ Test completed successfully`);
        console.log(`${'═'.repeat(80)}\n`);

    } catch (error) {
        console.error(`\n❌ Test failed:`, error);
        process.exit(1);
    }
}

if (require.main === module) {
    quickTest().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { quickTest };
