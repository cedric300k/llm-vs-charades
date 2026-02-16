import http from 'http';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

loadDotEnv(path.join(__dirname, '.env'));

const port = Number(process.env.PORT || 3000);
const activeTurns = new Map();
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function normalizeText(text = '') {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function extractText(payload = {}) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || '').join(' ').trim();
}

async function geminiGenerate({ model, body }) {
  const response = await fetch(`${GEMINI_URL}/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Gemini API request failed.');
  }
  return data;
}

function getMime(filePath) {
  const ext = path.extname(filePath);
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  }[ext] || 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/llm-guess') {
      if (!process.env.GEMINI_API_KEY) return json(res, 500, { error: 'Missing GEMINI_API_KEY in server environment.' });
      const { imageData } = await readJsonBody(req);
      if (!imageData?.includes(',')) return json(res, 400, { error: 'imageData is required as a data URL.' });

      const base64 = imageData.split(',')[1];
      const response = await geminiGenerate({
        model: 'gemini-2.0-flash',
        body: {
          contents: [{ role: 'user', parts: [{ text: 'You are playing charades. Guess what the person is acting out from this webcam image. Reply with only one short guess (max 5 words).' }, { inlineData: { data: base64, mimeType: 'image/jpeg' } }] }]
        }
      });
      return json(res, 200, { guess: extractText(response) || 'I could not confidently guess.' });
    }

    if (req.method === 'POST' && req.url === '/api/llm-act') {
      if (!process.env.GEMINI_API_KEY) return json(res, 500, { error: 'Missing GEMINI_API_KEY in server environment.' });

      const conceptResponse = await geminiGenerate({
        model: 'gemini-2.0-flash',
        body: {
          contents: [{ role: 'user', parts: [{ text: 'Give one charades concept that can be visually represented in a photo. Keep it common and family-friendly. Return only the concept phrase (2-4 words).' }] }]
        }
      });

      const answer = extractText(conceptResponse).replace(/^"|"$/g, '') || 'riding a bicycle';

      const imageResponse = await geminiGenerate({
        model: 'gemini-2.0-flash-preview-image-generation',
        body: {
          contents: [{ role: 'user', parts: [{ text: `Create a realistic, high-quality photo that clearly depicts: "${answer}". No text overlay, no watermarks.` }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        }
      });

      let imageBase64 = null;
      for (const part of imageResponse?.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) imageBase64 = part.inlineData.data;
      }
      if (!imageBase64) return json(res, 500, { error: 'Could not generate an image for the LLM turn.' });

      const turnId = crypto.randomUUID();
      activeTurns.set(turnId, { answer, createdAt: Date.now() });
      return json(res, 200, { turnId, imageData: `data:image/png;base64,${imageBase64}` });
    }

    if (req.method === 'POST' && req.url === '/api/judge-user-guess') {
      if (!process.env.GEMINI_API_KEY) return json(res, 500, { error: 'Missing GEMINI_API_KEY in server environment.' });
      const { turnId, guess } = await readJsonBody(req);
      const turn = activeTurns.get(turnId);
      if (!turn) return json(res, 400, { error: 'Turn expired or invalid.' });

      const normalizedGuess = normalizeText(guess);
      const normalizedAnswer = normalizeText(turn.answer);
      if (normalizedGuess && (normalizedAnswer.includes(normalizedGuess) || normalizedGuess.includes(normalizedAnswer))) {
        activeTurns.delete(turnId);
        return json(res, 200, { correct: true, answer: turn.answer, reason: 'Direct string match.' });
      }

      const judgeResponse = await geminiGenerate({
        model: 'gemini-2.0-flash',
        body: {
          contents: [{ role: 'user', parts: [{ text: `In charades, does the guess "${guess}" correctly match or closely mean "${turn.answer}"? Reply only YES or NO.` }] }]
        }
      });
      const verdict = extractText(judgeResponse).toUpperCase().includes('YES');
      activeTurns.delete(turnId);
      return json(res, 200, { correct: verdict, answer: turn.answer });
    }

    const safeUrl = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(publicDir, path.normalize(safeUrl).replace(/^\/+/, ''));
    if (!filePath.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });

    const data = await fsp.readFile(filePath);
    res.writeHead(200, { 'Content-Type': getMime(filePath) });
    res.end(data);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'Server error', details: error.message });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [turnId, value] of activeTurns.entries()) {
    if (now - value.createdAt > 3 * 60 * 1000) activeTurns.delete(turnId);
  }
}, 30000);

server.listen(port, () => {
  console.log(`Charades app listening on http://localhost:${port}`);
});
