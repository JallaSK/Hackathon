import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';

const app = express();
const port = Number(process.env.PORT) || 3000;
const apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
const requestTimeoutMs = 15_000;
const maxPromptLength = 10_000;
const responseInstruction = 'Answer in plain text only. Do not use Markdown syntax, including bold or italic markers, headings, code fences, tables, or Markdown links. Use simple sentences and line breaks when needed.';
const quizInstruction = `Create a multiple-choice quiz based on the user's topic. Return at least 5 clear, distinct questions. Each question must have exactly four options labelled A, B, C, and D, with exactly one correct answer. Keep the answer and a brief explanation in the data for each question so the app can check the user's selection. Return only a JSON object in this shape: {"questions":[{"question":"Question text","options":{"A":"Option A","B":"Option B","C":"Option C","D":"Option D"},"answer":"A","explanation":"Brief explanation"}]}. Do not include Markdown or any text outside the JSON object.`;
const extensionOrigin = process.env.EXTENSION_ORIGIN?.trim();

const allowedOrigins = new Set([
  ...(extensionOrigin ? [extensionOrigin] : []),
  'http://localhost',
  'http://127.0.0.1',
]);

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json({ limit: '16kb', strict: true }));

const generationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute and try again.' },
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ai-chrome-extension-backend' });
});

app.post('/api/generate', generationLimiter, async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const mode = req.body?.mode === 'quiz' ? 'quiz' : 'response';
  if (!prompt) {
    return res.status(400).json({ error: 'Enter a prompt before generating a response.' });
  }
  if (prompt.length > maxPromptLength) {
    return res.status(400).json({ error: `Prompt must be ${maxPromptLength.toLocaleString()} characters or fewer.` });
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  const model = process.env.GROQ_MODEL?.trim();
  if (!apiKey || !model) {
    return res.status(503).json({ error: 'Add GROQ_API_KEY and GROQ_MODEL to backend/.env, then restart the server.' });
  }

  try {
    const upstreamResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: mode === 'quiz' ? quizInstruction : responseInstruction },
          { role: 'user', content: prompt },
        ],
        max_tokens: mode === 'quiz' ? 2048 : 1024,
        ...(mode === 'quiz' ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });

    if (!upstreamResponse.ok) {
      if (upstreamResponse.status === 429) {
        return res.status(429).json({ error: 'Groq is rate limiting requests. Please wait and try again.' });
      }
      if (upstreamResponse.status === 401) {
        console.error('Groq rejected the API key.');
        return res.status(502).json({ error: 'Groq rejected the API key. Check that GROQ_API_KEY is valid.' });
      }
      if (upstreamResponse.status === 403) {
        console.error('Groq denied access for this API key or model.');
        return res.status(502).json({ error: 'Groq denied access for this API key or model. Check your key permissions.' });
      }
      console.error(`Groq request failed with status ${upstreamResponse.status}.`);
      return res.status(502).json({ error: 'Groq is temporarily unavailable or the selected model is invalid.' });
    }

    const result = await upstreamResponse.json();
    const content = result.choices?.[0]?.message?.content;

    if (mode === 'quiz') {
      const quiz = normalizeQuiz(content);
      if (!quiz) {
        return res.status(502).json({ error: 'The quiz could not be formatted correctly. Please try again.' });
      }
      return res.json({ quiz, model });
    }

    const responseText = typeof content === 'string' ? content.trim() : '';

    if (!responseText) {
      return res.status(502).json({ error: 'Groq returned an empty response. Please try again.' });
    }
    return res.json({ response: responseText, model });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Groq did not respond within 15 seconds. Try a shorter prompt and try again.' });
    }
    console.error('Groq generation failed:', error?.message ?? 'Unknown error');
    return res.status(502).json({ error: 'Unable to generate a response right now. Please try again.' });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  if (error?.message === 'Origin not allowed') {
    return res.status(403).json({ error: 'This request origin is not allowed.' });
  }
  console.error('Request failed:', error?.message ?? 'Unknown error');
  return res.status(500).json({ error: 'An unexpected server error occurred.' });
});

function normalizeQuiz(content) {
  if (typeof content !== 'string') return null;

  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.questions) || parsed.questions.length < 5) return null;

    const questions = parsed.questions.map((item) => {
      const letters = ['A', 'B', 'C', 'D'];
      const answer = typeof item.answer === 'string' ? item.answer.toUpperCase() : '';
      if (typeof item.question !== 'string' || !item.question.trim()) return null;
      if (!letters.every((letter) => typeof item.options?.[letter] === 'string' && item.options[letter].trim())) return null;
      if (!letters.includes(answer)) return null;

      return {
        question: item.question.trim(),
        options: Object.fromEntries(letters.map((letter) => [letter, item.options[letter].trim()])),
        answer,
        explanation: typeof item.explanation === 'string' ? item.explanation.trim() : '',
      };
    });

    if (questions.some((item) => item === null)) return null;
    return { questions };
  } catch {
    return null;
  }
}

app.listen(port, () => {
  console.log(`AI extension backend listening at http://localhost:${port}`);
});
