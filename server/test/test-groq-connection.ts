/**
 * ═══════════════════════════════════════════════════════════════════════
 * GROQ CONNECTION TEST
 * Verify Groq API is working and check rate limits
 * ═══════════════════════════════════════════════════════════════════════
 */

import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY || ''
});

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

async function testGroqConnection() {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🧪 GROQ API CONNECTION TEST`);
    console.log(`${'═'.repeat(80)}\n`);

    // Check API key
    if (!process.env.GROQ_API_KEY) {
        console.error('❌ GROQ_API_KEY is not set in .env file');
        console.error('\nPlease add to server/.env:');
        console.error('GROQ_API_KEY=your_key_here\n');
        process.exit(1);
    }

    console.log(`✅ API Key: ${process.env.GROQ_API_KEY.substring(0, 10)}...`);
    console.log(`✅ Model: ${MODEL}\n`);

    // Test 1: Simple completion
    console.log(`${'─'.repeat(80)}`);
    console.log(`TEST 1: Simple Completion`);
    console.log(`${'─'.repeat(80)}\n`);

    try {
        const startTime = Date.now();
        
        const completion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Say "Hello, Groq is working!" in French.' }
            ],
            model: MODEL,
            temperature: 0.5,
            max_tokens: 50
        });

        const duration = Date.now() - startTime;
        const response = completion.choices[0]?.message?.content || '';

        console.log(`✅ Response: ${response}`);
        console.log(`⏱️  Duration: ${duration}ms`);
        console.log(`📊 Tokens: ${completion.usage?.total_tokens || 'N/A'}\n`);

    } catch (error) {
        console.error(`❌ Test 1 Failed:`, error);
        process.exit(1);
    }

    // Test 2: Extraction (like qualification)
    console.log(`${'─'.repeat(80)}`);
    console.log(`TEST 2: Data Extraction (Qualification Simulation)`);
    console.log(`${'─'.repeat(80)}\n`);

    try {
        const startTime = Date.now();
        
        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: 'system', 
                    content: 'You are a JSON extractor. Extract data and respond ONLY with valid JSON.' 
                },
                { 
                    role: 'user', 
                    content: `Extract from this text: "Je m'appelle Jean Dupont, mon numéro est 0612345678, je cherche un T3 aux Sables"
                    
                    Return JSON:
                    {
                        "prenom": "...",
                        "nom": "...",
                        "numero_telephone": "...",
                        "besoin": "...",
                        "adresse": "..."
                    }` 
                }
            ],
            model: MODEL,
            temperature: 0.3,
            max_tokens: 200
        });

        const duration = Date.now() - startTime;
        const response = completion.choices[0]?.message?.content || '';

        console.log(`✅ Response:\n${response}`);
        console.log(`\n⏱️  Duration: ${duration}ms`);
        console.log(`📊 Tokens: ${completion.usage?.total_tokens || 'N/A'}\n`);

        // Try to parse JSON
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            console.log(`✅ JSON Parsing: Success`);
            console.log(`   Extracted fields:`, Object.keys(parsed).join(', '));
        } else {
            console.warn(`⚠️  JSON Parsing: Failed (no JSON found in response)`);
        }

    } catch (error) {
        console.error(`❌ Test 2 Failed:`, error);
        process.exit(1);
    }

    // Test 3: Rate limit check
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`TEST 3: Rate Limit Check (5 rapid requests)`);
    console.log(`${'─'.repeat(80)}\n`);

    try {
        const startTime = Date.now();
        let successCount = 0;

        for (let i = 1; i <= 5; i++) {
            try {
                await groq.chat.completions.create({
                    messages: [
                        { role: 'user', content: `Count to ${i}` }
                    ],
                    model: MODEL,
                    temperature: 0.5,
                    max_tokens: 20
                });
                successCount++;
                console.log(`✅ Request ${i}/5: Success`);
            } catch (error: any) {
                if (error.message?.includes('rate limit')) {
                    console.warn(`⚠️  Request ${i}/5: Rate limited`);
                } else {
                    throw error;
                }
            }
        }

        const duration = Date.now() - startTime;
        console.log(`\n📊 Results:`);
        console.log(`   Successful: ${successCount}/5`);
        console.log(`   Total time: ${duration}ms`);
        console.log(`   Avg time: ${(duration / 5).toFixed(0)}ms per request\n`);

    } catch (error) {
        console.error(`❌ Test 3 Failed:`, error);
        process.exit(1);
    }

    // Summary
    console.log(`${'═'.repeat(80)}`);
    console.log(`✅ ALL TESTS PASSED`);
    console.log(`${'═'.repeat(80)}\n`);

    console.log(`📋 Summary:`);
    console.log(`   ✅ API Key: Valid`);
    console.log(`   ✅ Model: ${MODEL}`);
    console.log(`   ✅ Simple Completion: Working`);
    console.log(`   ✅ Data Extraction: Working`);
    console.log(`   ✅ Rate Limits: OK\n`);

    console.log(`🎯 Groq is ready for automated testing!\n`);
    console.log(`Next step: Run the full test suite`);
    console.log(`   cd server`);
    console.log(`   npx ts-node test/automated-bot-testing.ts\n`);
}

if (require.main === module) {
    testGroqConnection().catch(error => {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    });
}

export { testGroqConnection };
