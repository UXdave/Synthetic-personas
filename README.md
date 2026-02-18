# Synthetic Persona Platform

A dossier-grounded synthetic persona roleplay platform with 7 selectable personas and a dedicated OpenAI project/GPT key per persona.

## What this repo contains

- `public/`: frontend (persona selection + roleplay chat)
- `server.js`: API + static server + HTTP Basic Auth protection
- `data/dossiers/*.txt`: extracted local dossier text from persona PDFs/DOCX
- `data/policies/*.json`: behavioral policies used during roleplay
- `scripts/ingest_personas.py`: local extractor (PDF/DOCX -> dossier text)
- `render.yaml`: Render deployment blueprint

## Persona architecture

Each persona is mapped to its own API key env var, so each request can be routed through a separate OpenAI project:

- `PA01` -> `OPENAI_API_KEY_PA01`
- `PA02` -> `OPENAI_API_KEY_PA02`
- `PA03` -> `OPENAI_API_KEY_PA03`
- `PA04` -> `OPENAI_API_KEY_PA04`
- `PA05` -> `OPENAI_API_KEY_PA05`
- `PA06` -> `OPENAI_API_KEY_PA06`
- `PA07` -> `OPENAI_API_KEY_PA07`

## Local setup

1. Create environment file:

```bash
cp .env.example .env
```

2. Set these required values in `.env`:

- `APP_USERNAME`
- `APP_PASSWORD`
- `OPENAI_API_KEY_PA01` ... `OPENAI_API_KEY_PA07`

3. (Optional) Regenerate dossier text from source files:

```bash
npm run ingest
```

4. Validate configuration:

```bash
npm run check
```

5. Start server:

```bash
npm start
```

Open: `http://localhost:3000`

## Password protection

HTTP Basic Auth is enabled by default.

- `AUTH_ENABLED=true` (default)
- Credentials are enforced with `APP_USERNAME` and `APP_PASSWORD`

For local-only design/dev without auth:

```bash
npm run dev
```

## Render deployment

This repo includes `render.yaml`.

### Quick deploy flow

1. Push repo to GitHub.
2. In Render, create a new Blueprint deploy and select this repo.
3. Set secret env vars in Render:
- `APP_USERNAME`
- `APP_PASSWORD`
- `OPENAI_API_KEY_PA01` ... `OPENAI_API_KEY_PA07`
4. Deploy.

The service is then password-protected via Basic Auth and uses per-persona project keys.

## Notes on persona policy files

`data/policies/persona_PA01_stephen_jones.json` is included as a starter structure.
If you have a final uploaded version of that file, replace the starter file contents with your authoritative policy.

## Constraint adherence

- Persona behavior is grounded to local repository dossier files and policy JSON.
- No internet augmentation is performed for persona insight generation.
