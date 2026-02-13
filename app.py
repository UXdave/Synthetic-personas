import os
import json
import logging
import secrets
from pathlib import Path
from functools import wraps

from flask import (
    Flask, render_template, request, jsonify, session,
    redirect, url_for, flash
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
SITE_PASSWORD = os.environ.get("SITE_PASSWORD", "transform2024")
AI_PROVIDER = os.environ.get("AI_PROVIDER", "anthropic")  # "anthropic" or "openai"
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")

# Startup diagnostics
logger.info("AI_PROVIDER=%s", AI_PROVIDER)
logger.info("ANTHROPIC_API_KEY configured: %s", bool(ANTHROPIC_API_KEY))
logger.info("OPENAI_API_KEY configured: %s", bool(OPENAI_API_KEY))

# Load persona data
PERSONA_DIR = Path(__file__).parent / "persona_data"
PERSONAS = {}

for json_file in sorted(PERSONA_DIR.glob("*.json")):
    with open(json_file, "r") as f:
        data = json.load(f)
        PERSONAS[data["persona_id"]] = data

# System prompt template
SYSTEM_PROMPT_TEMPLATE = """You are Persona Simulator, a synthetic persona simulation engine.

PURPOSE
Simulate a persona based ONLY on the user-provided dossier below. Persona fidelity is more important than being broadly helpful.

FIRST REPLY ONLY
Include once: "FYI: I'm a synthetic simulation of this persona—not a real person."

LOADING A PERSONA
1. Ingest the dossier and build an internal model: identity, context, goals, pains, behaviors, decision drivers, knowledge boundaries, voice/tone.
2. If the dossier is too thin, ask up to 3 clarifying questions—otherwise, proceed.

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
- Scenario Mode (user proposes a situation): Walk through: notice → assume → act → where you'd give up.
- Usability Mode (user describes a flow/prototype): Think aloud naturally as the persona.

OOC COMMANDS
Respond [Out of Character] when user types: OOC:, /meta, /debrief, /persona-summary, /assumptions

- /persona-summary → Traits, needs, pains, decision drivers, voice notes, unknowns
- /assumptions → List gaps you're filling in
- /debrief → Summarize insights from the interaction
- /meta → Explain your interpretation of the dossier

Return to roleplay after OOC unless told otherwise.

You must show the above commands when a user first interacts with you so they understand the commands they can use. You need to explain what each command will do. Always refer to Out of Character in full the first time you use it. After that use OOC.

SAFETY
- Don't claim to be real or have real private data.
- Treat dossiers of real people as fictionalized composites.
- For medical/legal/financial: respond in character, then add brief [OOC] note to consult a professional.

CORE PRINCIPLE
When uncertain, prefer "I don't know" (in character) over guessing.

Use the following dossier as a behavioural policy.
When making decisions, recommendations, prioritisation choices, or explanations, follow the objectives, rules, thresholds, and constraints defined in that dossier.
If there is ambiguity, default to the persona's primary objectives and decision hierarchy.

--- PERSONA DOSSIER ---
{dossier}
--- END DOSSIER ---"""


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get("authenticated"):
            # Return JSON 401 for AJAX/API requests instead of a redirect
            if request.is_json or request.headers.get("Content-Type") == "application/json":
                return jsonify({"error": "Session expired. Please refresh the page and log in again."}), 401
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated_function


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        password = request.form.get("password", "")
        if password == SITE_PASSWORD:
            session["authenticated"] = True
            return redirect(url_for("home"))
        else:
            flash("Incorrect password. Please try again.", "error")
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def home():
    return render_template("home.html", personas=PERSONAS)


@app.route("/chat/<persona_id>")
@login_required
def chat(persona_id):
    if persona_id not in PERSONAS:
        return redirect(url_for("home"))
    persona = PERSONAS[persona_id]
    return render_template("chat.html", persona=persona, personas=PERSONAS)


@app.route("/api/chat", methods=["POST"])
@login_required
def api_chat():
    data = request.json
    if not data:
        return jsonify({"error": "Invalid request body."}), 400

    persona_id = data.get("persona_id")
    messages = data.get("messages", [])

    if not persona_id or persona_id not in PERSONAS:
        return jsonify({"error": "Unknown persona."}), 400

    if not messages:
        return jsonify({"error": "No messages provided."}), 400

    persona = PERSONAS[persona_id]
    dossier = json.dumps(persona, indent=2)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(dossier=dossier)

    provider = AI_PROVIDER.lower()

    # Auto-detect provider based on available keys
    if provider == "openai" and not OPENAI_API_KEY:
        if ANTHROPIC_API_KEY:
            provider = "anthropic"
    elif provider == "anthropic" and not ANTHROPIC_API_KEY:
        if OPENAI_API_KEY:
            provider = "openai"

    # Validate that the selected provider has an API key
    if provider == "anthropic" and not ANTHROPIC_API_KEY:
        logger.error("Anthropic API key is not configured")
        return jsonify({"error": "The Claude API key is not configured. Please set ANTHROPIC_API_KEY in the environment."}), 503
    if provider == "openai" and not OPENAI_API_KEY:
        logger.error("OpenAI API key is not configured")
        return jsonify({"error": "The OpenAI API key is not configured. Please set OPENAI_API_KEY in the environment."}), 503

    try:
        if provider == "anthropic":
            return _chat_anthropic(system_prompt, messages)
        else:
            return _chat_openai(system_prompt, messages)
    except Exception as e:
        logger.exception("Chat API error (provider=%s)", provider)
        return jsonify({"error": f"AI service error: {e}"}), 500


def _chat_openai(system_prompt, messages):
    from openai import OpenAI

    client = OpenAI(api_key=OPENAI_API_KEY)

    api_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        api_messages.append({
            "role": msg["role"],
            "content": msg["content"]
        })

    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=api_messages,
        temperature=0.7,
        max_tokens=2048,
    )

    reply = response.choices[0].message.content
    return jsonify({"reply": reply})


def _chat_anthropic(system_prompt, messages):
    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    api_messages = []
    for msg in messages:
        api_messages.append({
            "role": msg["role"],
            "content": msg["content"]
        })

    response = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=2048,
        system=system_prompt,
        messages=api_messages,
    )

    reply = response.content[0].text
    return jsonify({"reply": reply})


@app.route("/api/status")
@login_required
def api_status():
    """Check whether the AI backend is configured and ready."""
    provider = AI_PROVIDER.lower()
    if provider == "anthropic" and not ANTHROPIC_API_KEY:
        if OPENAI_API_KEY:
            provider = "openai"
    elif provider == "openai" and not OPENAI_API_KEY:
        if ANTHROPIC_API_KEY:
            provider = "anthropic"

    has_key = (provider == "anthropic" and bool(ANTHROPIC_API_KEY)) or \
              (provider == "openai" and bool(OPENAI_API_KEY))

    return jsonify({
        "ready": has_key,
        "provider": provider,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
