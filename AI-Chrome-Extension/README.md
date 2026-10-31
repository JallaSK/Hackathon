# AI Prompt Assistant Extension

A Manifest V3 Chrome popup that sends prompts to a local Express backend and generates plain-text responses with GroqCloud. The Groq API key stays in the backend and is never included in extension files.

## Configure the backend

Use Node.js 20 or newer. In `backend/`, install dependencies:

```sh
npm install
```

Open `backend/.env` and enter your GroqCloud API key and a model ID available to your account:

```dotenv
GROQ_API_KEY=paste_your_groq_api_key_here
GROQ_MODEL=paste_a_supported_model_id_here
PORT=3000
EXTENSION_ORIGIN=
```

Get a key from the [Groq Console](https://console.groq.com/keys) and choose a current model from [Groq's supported models](https://console.groq.com/docs/models). Keep `.env` private; it is excluded by `.gitignore`.

Start the backend:

```sh
npm start
```

Check `http://localhost:3000/api/health`; it should return `{"status":"ok", ...}`.

## Load the extension

1. Open `chrome://extensions/` and enable **Developer mode**.
2. Select **Load unpacked** and choose this project's `extension/` folder.
3. For a tighter CORS allowlist, copy the extension ID from Chrome into `EXTENSION_ORIGIN=chrome-extension://YOUR_EXTENSION_ID` in `backend/.env`, then restart the backend. Valid Chrome extension origins are allowed during local development by default.

Open the extension, enter a prompt, and choose **Generate response** or **Generate MCQ quiz (5+ questions)**. Quiz mode asks Groq for at least five numbered multiple-choice questions with four options each. Select an option and check your answer to see feedback and your running score. Generated responses and quizzes are saved in Chrome's local extension storage, up to the latest 20. Select a History entry to reopen it or use Clear to remove saved entries. The backend calls Groq's OpenAI-compatible Chat Completions endpoint and aborts an upstream request after 15 seconds.

If you change the backend port, update `API_BASE_URL` in `extension/popup.js` and the localhost host permission in `extension/manifest.json` to match.

## Project files

- `backend/server.js`: health and generation endpoints, CORS, validation, rate limiting, Groq API requests, and timeout handling.
- `backend/package.json`: Express backend dependencies.
- `backend/.env.example`: environment variable template for the API key and model.
- `extension/manifest.json`: MV3 popup and local backend host permission.
- `extension/popup.html`, `popup.css`, and `popup.js`: popup UI and request flow.
