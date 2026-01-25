# AI Lead Qualification Chat Agent

A complete n8n workflow that powers an AI chatbot for lead qualification. The bot has a natural conversation with visitors, qualifies their needs, captures their email, and notifies your team with an AI-generated summary.

## Live Demo

See it in action: [Demo Link] (add your deployed URL)

## Features

- **Conversational AI** - Claude-powered chat that qualifies leads naturally
- **Conversation Memory** - PostgreSQL stores full chat history per session
- **Email Capture** - Detects when users provide email and saves lead
- **AI Summarization** - Generates bullet-point summary for sales team
- **Team Notifications** - Slack/webhook notification when lead is captured
- **Streaming Text Effect** - Frontend displays responses word-by-word

## Architecture

```
Frontend (HTML/JS)
    ↓ POST /webhook/chat-agent
n8n Workflow:
    → Webhook Trigger
    → Upsert Conversation (PostgreSQL)
    → Save User Message
    → Load Conversation History
    → Format Messages for Claude
    → Claude AI (HTTP Request)
    → Save Assistant Message
    → Extract Email (Code node)
    → IF has email:
        → Save Lead
        → Mark Completed
        → Summarize Chat (Claude)
        → Notify Team (Slack)
    → Respond to Webhook
```

## Setup

### 1. Database (PostgreSQL/Neon)

Run `schema.sql` to create the required tables:
- `conversations` - Tracks chat sessions
- `messages` - Stores all messages with role (user/assistant)
- `leads` - Captured leads with email and chat summary

### 2. n8n Credentials

Create these credentials in n8n:
- **PostgreSQL** - Your database connection
- **HTTP Header Auth** - Anthropic API key (header name: `x-api-key`)

### 3. Import Workflow

1. Open n8n
2. Import `workflow.json`
3. Update credential references in each node
4. Update webhook path and allowed origins
5. Activate the workflow

### 4. Frontend

1. Copy `frontend-chat.js` to your project
2. Update `WEBHOOK_URL` to your n8n webhook URL
3. Add required HTML elements (see comments in JS)
4. Style as needed

## Configuration

### Webhook Trigger
- Update `allowedOrigins` with your domain(s)
- Multiple domains: `"https://example.com,https://www.example.com"`

### System Prompt
Edit the prompt in the "Format Messages" Code node to customize:
- Bot personality
- Qualification questions
- Conversation flow

### Notifications
Replace Slack webhook URL or swap for your preferred notification service.

## Files

| File | Description |
|------|-------------|
| `workflow.json` | n8n workflow (import this) |
| `schema.sql` | PostgreSQL table definitions |
| `frontend-chat.js` | Drop-in frontend code |
| `system-prompt.md` | Full system prompt reference |

## Gotchas

### SQL Injection
User messages with apostrophes break queries. Always escape:
```javascript
$json.message.replace(/'/g, "''")
```

### Paired Item Data
After HTTP Request nodes, use `$execution.customData` to pass data:
```javascript
// Store early
$execution.customData.set('session_id', String(value));

// Retrieve later
$execution.customData.get('session_id');
```

### CORS
Add both www and non-www domains to allowed origins.

## License

MIT - Use freely for your own projects.

## Credits

Built with [n8n](https://n8n.io) and [Claude](https://anthropic.com).
