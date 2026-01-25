// import fetch from 'node-fetch'; // Using built-in fetch

const API_URL = 'http://localhost:3001/api/chat';

async function testChat() {
    console.log('🧪 Testing Chat API...');

    try {
        // Test 1: Simple Greeting
        console.log('\n--- Test 1: Simple Greeting ---');
        const res1 = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: 'test-session-' + Date.now(),
                message: 'Hello, I need help with automation.'
            })
        });

        if (!res1.ok) {
            const err = await res1.text();
            throw new Error(`Status ${res1.status}: ${err}`);
        }

        const data1 = await res1.json();
        console.log('Response:', data1);

        // Test 2: Email Qualification
        console.log('\n--- Test 2: Email Qualification ---');
        const res2 = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: 'test-session-' + Date.now(),
                message: 'My email is test@example.com, send me the info.'
            })
        });

        if (!res2.ok) {
            const err = await res2.text();
            throw new Error(`Status ${res2.status}: ${err}`);
        }

        const data2 = await res2.json();
        console.log('Response:', data2);

        console.log('\n✅ Verification Passed!');

    } catch (error) {
        console.error('❌ Verification Failed:', error);
        process.exit(1);
    }
}

// Wait for server to start if running immediately? 
// We will manually start server in one terminal and test in another, or rely on existing running server?
// The user has a "start.bat" maybe?
// I will run `npm run dev` in background and then run this test.
testChat();
