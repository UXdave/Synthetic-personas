const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const PERSONA_CONFIG_PATH = path.join(ROOT_DIR, 'data', 'config', 'personas.json');

const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';
const APP_USERNAME = process.env.APP_USERNAME || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES || 24);
const MAX_DOSSIER_CHARS = Number(process.env.MAX_DOSSIER_CHARS || 90000);

if (AUTH_ENABLED && process.env.NODE_ENV === 'production' && (!APP_USERNAME || !APP_PASSWORD)) {
  throw new Error('APP_USERNAME and APP_PASSWORD are required in production when AUTH_ENABLED is not false.');
}

if (AUTH_ENABLED && (!APP_USERNAME || !APP_PASSWORD)) {
  console.warn('[warn] Basic auth is enabled but APP_USERNAME/APP_PASSWORD are not both set. Requests will fail until configured.');
}

const BASE_PROMPT = `You are Persona Simulator, a synthetic persona simulation engine.

PURPOSE
Simulate a persona based ONLY on the user-provided dossier uploaded into this GPT. Persona fidelity is more important than being broadly helpful.

FIRST REPLY ONLY
Include once: "FYI: I'm a synthetic simulation of this persona-not a real person."

LOADING A PERSONA
1. Ingest the dossier and interview notes and build an internal model: identity, context, goals, pains, behaviors, decision drivers, knowledge boundaries, voice/tone.
2. If the dossier or notes is too thin, ask up to 3 clarifying questions-otherwise, proceed.

ROLEPLAY RULES
- Speak in first person as a real person, not a summary.
- Stay consistent with the dossier across turns.
- Knowledge boundaries: Answer what the persona would know; say "I don't know" for what they wouldn't.
- No invention: Don't fabricate specifics (addresses, salaries, diagnoses) not in the dossier.
- Prefer general plausibility over fake precision.
- Do not ask the user questions while in character.
- Do not break character to help the user.

MODES
At the beginning of the interaction ask the user how they would like to interact with the persona in the following modes:
- Interview Mode (user asks questions): Answer candidly + example + what matters to you.
- Scenario Mode (user proposes a situation): Walk through: notice -> assume -> act -> where you'd give up.
- Usability Mode (user describes a flow/prototype): Think aloud naturally as the persona.

OOC COMMANDS
Respond [Out of Character] when user types: OOC:, /meta, /debrief, /persona-summary, /assumptions

- /persona-summary -> Traits, needs, pains, decision drivers, voice notes, unknowns
- /assumptions -> List gaps you're filling in
- /debrief -> Summarize insights from the interaction
- /meta -> Explain your interpretation of the dossier

Return to roleplay after OOC unless told otherwise.

You must show the above commands when a user first interacts with you so they understand the commands they can use. You need to explain what each command will do. Always refer to Out of Character in full the first time you use it. After that use OOC.

SAFETY
- Don't claim to be real or have real private data.
- Treat dossiers of real people as fictionalized composites.
- For medical/legal/financial: respond in character, then add brief [OOC] note to consult a professional.

CORE PRINCIPLE
When uncertain, prefer "I don't know" (in character) over guessing.`;

const MODE_DESCRIPTIONS = {
  interview: 'Interview Mode',
  scenario: 'Scenario Mode',
  usability: 'Usability Mode'
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const personas = loadPersonas();
const personaById = new Map(personas.map((persona) => [persona.id, persona]));

function loadPersonas() {
  const raw = fs.readFileSync(PERSONA_CONFIG_PATH, 'utf-8');
  const rows = JSON.parse(raw);
  return rows.map((row) => {
    const dossier = fs.readFileSync(path.join(ROOT_DIR, row.dossier_path), 'utf-8').trim();
    const policy = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, row.policy_path), 'utf-8'));
    return {
      ...row,
      dossier,
      policy,
      display_name: `${row.name} (${row.persona_type})`
    };
  });
}

function truncateText(value, maxChars) {
  if (value.length <= maxChars) {
    return value;
  }

  const head = value.slice(0, Math.floor(maxChars * 0.8));
  const tail = value.slice(-Math.floor(maxChars * 0.2));
  return `${head}\n\n[... dossier truncated for context length ...]\n\n${tail}`;
}

function parseAuthHeader(headerValue) {
  if (!headerValue || !headerValue.startsWith('Basic ')) {
    return null;
  }

  const encoded = headerValue.slice(6).trim();
  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    return null;
  }

  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return null;
  }

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1)
  };
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function isAuthenticated(req) {
  if (!AUTH_ENABLED) {
    return true;
  }
  if (!APP_USERNAME || !APP_PASSWORD) {
    return false;
  }

  const creds = parseAuthHeader(req.headers.authorization || '');
  if (!creds) {
    return false;
  }

  return safeEqual(creds.username, APP_USERNAME) && safeEqual(creds.password, APP_PASSWORD);
}

function requireAuth(req, res) {
  if (isAuthenticated(req)) {
    return true;
  }

  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Synthetic Persona Platform"',
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify({ error: 'Authentication required.' }));
  return false;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) {
        return;
      }

      body += chunk;
      if (body.length > 1_000_000) {
        tooLarge = true;
        const error = new Error('Request body too large.');
        error.statusCode = 413;
        reject(error);
      }
    });

    req.on('end', () => {
      if (tooLarge) {
        return;
      }

      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        const parseError = new Error('Invalid JSON body.');
        parseError.statusCode = 400;
        reject(parseError);
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 4000)
    }))
    .filter((message) => message.content.length > 0)
    .slice(-MAX_HISTORY_MESSAGES);
}

function extractOutputText(responseBody) {
  if (typeof responseBody.output_text === 'string' && responseBody.output_text.trim()) {
    return responseBody.output_text.trim();
  }

  if (!Array.isArray(responseBody.output)) {
    return '';
  }

  const chunks = [];
  for (const item of responseBody.output) {
    if (!Array.isArray(item.content)) {
      continue;
    }
    for (const contentItem of item.content) {
      if (typeof contentItem.text === 'string' && contentItem.text.trim()) {
        chunks.push(contentItem.text.trim());
      }
      if (typeof contentItem.output_text === 'string' && contentItem.output_text.trim()) {
        chunks.push(contentItem.output_text.trim());
      }
    }
  }

  return chunks.join('\n').trim();
}

async function requestPersonaReply({ persona, mode, message, history }) {
  const apiKey = process.env[persona.api_key_env] || '';
  if (!apiKey) {
    throw new Error(`Missing API key for ${persona.code}. Set ${persona.api_key_env}.`);
  }

  const model = process.env[persona.model_env] || DEFAULT_MODEL;
  const isFirstReply = !history.some((entry) => entry.role === 'assistant');
  const modeName = MODE_DESCRIPTIONS[mode] || MODE_DESCRIPTIONS.interview;

  const policyText = JSON.stringify(persona.policy, null, 2);
  const dossierText = truncateText(persona.dossier, MAX_DOSSIER_CHARS);

  const systemText = [
    BASE_PROMPT,
    `Use ONLY the dossier and policy below. Do not augment persona facts with external internet knowledge.`,
    `Selected persona: ${persona.display_name}.`,
    `Selected interaction mode: ${modeName}.`,
    `Behavior policy JSON:\n${policyText}`,
    `Persona dossier:\n${dossierText}`,
    isFirstReply
      ? `This is your first reply. Include the FYI sentence exactly once and explain Out of Character commands in plain language.`
      : `This is not your first reply. Do not repeat the FYI sentence.`
  ].join('\n\n');

  const input = [
    {
      role: 'system',
      content: [{ type: 'input_text', text: systemText }]
    }
  ];

  for (const turn of history) {
    input.push({
      role: turn.role,
      content: [{ type: 'input_text', text: turn.content }]
    });
  }

  input.push({
    role: 'user',
    content: [{ type: 'input_text', text: message }]
  });

  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input,
      temperature: 0.25,
      max_output_tokens: 950
    })
  });

  const responseBody = await openAiResponse.json();
  if (!openAiResponse.ok) {
    const detail = responseBody.error && responseBody.error.message ? responseBody.error.message : 'OpenAI API request failed.';
    throw new Error(detail);
  }

  const reply = extractOutputText(responseBody);
  if (!reply) {
    throw new Error('No assistant response text was returned.');
  }

  return reply;
}

function sanitizePathname(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const clean = decoded.replace(/\\+/g, '/');
  const normalized = path.posix.normalize(clean);
  if (normalized.includes('..')) {
    return null;
  }
  return normalized;
}

function serveStaticFile(req, res, pathname) {
  const safePath = sanitizePathname(pathname);
  if (!safePath) {
    sendJson(res, 400, { error: 'Invalid path.' });
    return;
  }

  const requestedPath = safePath === '/' ? '/index.html' : safePath;
  const localPath = path.join(PUBLIC_DIR, requestedPath);

  if (!localPath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden.' });
    return;
  }

  fs.readFile(localPath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        const hasExtension = path.extname(requestedPath).length > 0;
        if (hasExtension) {
          sendJson(res, 404, { error: 'Not found.' });
          return;
        }
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackErr, fallbackContent) => {
          if (fallbackErr) {
            sendJson(res, 404, { error: 'Not found.' });
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fallbackContent);
        });
        return;
      }

      sendJson(res, 500, { error: 'Failed to read file.' });
      return;
    }

    const ext = path.extname(localPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  if (!requireAuth(req, res)) {
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'synthetic-personas' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/personas') {
    sendJson(
      res,
      200,
      personas.map((persona) => ({
        id: persona.id,
        code: persona.code,
        name: persona.name,
        persona_type: persona.persona_type,
        tagline: persona.tagline,
        project_env: persona.api_key_env
      }))
    );
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const body = await readJsonBody(req);
      const personaId = String(body.personaId || '').trim();
      const message = String(body.message || '').trim();
      const mode = String(body.mode || 'interview').toLowerCase();
      const history = normalizeHistory(body.history || []);

      if (!personaById.has(personaId)) {
        sendJson(res, 400, { error: 'Unknown personaId.' });
        return;
      }
      if (!message) {
        sendJson(res, 400, { error: 'Message is required.' });
        return;
      }
      if (!MODE_DESCRIPTIONS[mode]) {
        sendJson(res, 400, { error: 'Invalid mode.' });
        return;
      }

      const persona = personaById.get(personaId);
      const reply = await requestPersonaReply({ persona, mode, message, history });
      sendJson(res, 200, { reply });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      const statusCode =
        error && typeof error === 'object' && Number.isInteger(error.statusCode) ? error.statusCode : 500;
      sendJson(res, statusCode, { error: message });
      return;
    }
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'API route not found.' });
    return;
  }

  serveStaticFile(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Synthetic persona platform listening on port ${PORT}`);
});
