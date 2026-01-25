export { }; // Met le fichier dans son propre scope pour éviter les conflits de nom globaux
// import fetch from 'node-fetch';

const API_URL = 'http://localhost:3001/api/chat';

async function testGroqChat() {
    console.log('🧪 Testing Groq Chat API...');

    try {
        console.log('\n--- 1. Greeting ---');
        const res1 = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: 'groq-test-' + Date.now(), message: "Hello, I need help automating my lead gen." })
        });
        const data1 = await res1.json();
        console.log('User: Hello...');
        console.log('Bot:', data1.response);

        console.log('\n--- 2. Tools Info ---');
        const res2 = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: data1.sessionId, message: "I use Shopify and Google Sheets mostly." })
        });
        const data2 = await res2.json();
        console.log('User: I use Shopify...');
        console.log('Bot:', data2.response);

        console.log('\n--- 3. Email Qualification ---');
        const res3 = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: data1.sessionId, message: "Okay, email is test-groq@example.com" })
        });
        const data3 = await res3.json() as { response: string };
        console.log('User: Email is test-groq...');
        console.log('Bot:', data3.response);

    } catch (err) {
        console.error('Failed:', err);
    }
}

testGroqChat();
