/**
 * AI Chat Agent Frontend
 *
 * Drop-in frontend code for the n8n AI Lead Qualification workflow.
 * Connects to your n8n webhook and displays chat with streaming text effect.
 */

// ============================================
// CONFIGURATION - UPDATE THIS
// ============================================
const WEBHOOK_URL = 'https://your-n8n-instance.com/webhook/chat-agent';

// ============================================
// SESSION MANAGEMENT
// ============================================
function getSessionId() {
  let sessionId = localStorage.getItem('chat_session_id');
  if (!sessionId) {
    sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('chat_session_id', sessionId);
  }
  return sessionId;
}

function resetSession() {
  localStorage.removeItem('chat_session_id');
  return getSessionId();
}

// ============================================
// DOM ELEMENTS (update IDs to match your HTML)
// ============================================
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const chatTyping = document.getElementById('chatTyping');

let conversationComplete = false;

// ============================================
// MESSAGE HANDLING WITH STREAMING
// ============================================
function addMessage(text, isUser = false, stream = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${isUser ? 'user' : 'bot'}`;

  if (!isUser) {
    messageDiv.innerHTML = `
      <img src="/bot-avatar.png" alt="Bot" class="chat-message-avatar">
      <div class="chat-message-bubble"></div>
    `;
    chatMessages.insertBefore(messageDiv, chatTyping);

    if (stream) {
      const bubble = messageDiv.querySelector('.chat-message-bubble');
      streamText(bubble, text);
    } else {
      messageDiv.querySelector('.chat-message-bubble').textContent = text;
    }
  } else {
    messageDiv.innerHTML = `
      <div class="chat-message-bubble">${text}</div>
    `;
    chatMessages.insertBefore(messageDiv, chatTyping);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============================================
// STREAMING TEXT EFFECT
// ============================================
function streamText(element, text) {
  const words = text.split(' ');
  let i = 0;

  function addWord() {
    if (i < words.length) {
      element.textContent += (i > 0 ? ' ' : '') + words[i];
      chatMessages.scrollTop = chatMessages.scrollHeight;
      i++;
      setTimeout(addWord, 30 + Math.random() * 40); // 30-70ms per word
    }
  }

  addWord();
}

// ============================================
// EMAIL DETECTION
// ============================================
function containsEmail(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  return emailRegex.test(text);
}

// ============================================
// SEND MESSAGE TO WEBHOOK
// ============================================
async function sendToWebhook(message) {
  const sessionId = getSessionId();

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_id: sessionId,
        message: message
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error('Webhook error:', error);
    return "I'm having trouble connecting right now. Please try again or contact us directly.";
  }
}

// ============================================
// PROCESS MESSAGE
// ============================================
async function processMessage(userMessage) {
  const userSentEmail = containsEmail(userMessage);

  // Show typing indicator
  chatTyping.classList.add('active');
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Call webhook
  const aiResponse = await sendToWebhook(userMessage);

  // Hide typing, show response with streaming effect
  chatTyping.classList.remove('active');
  addMessage(aiResponse, false, true);

  // Handle conversation completion when email is provided
  if (userSentEmail) {
    conversationComplete = true;
    chatInput.disabled = true;
    chatInput.placeholder = "Conversation complete - we'll be in touch!";
    chatSend.disabled = true;
  }
}

// ============================================
// SEND MESSAGE HANDLER
// ============================================
function sendMessage() {
  if (conversationComplete) return;

  const text = chatInput.value.trim();
  if (!text) return;

  addMessage(text, true);
  chatInput.value = '';

  processMessage(text);
}

// ============================================
// EVENT LISTENERS
// ============================================
chatSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

chatInput.focus();
console.log('Chat Session:', getSessionId());
