const homeView = document.getElementById('homeView');
const chatView = document.getElementById('chatView');
const personaGrid = document.getElementById('personaGrid');
const personaCount = document.getElementById('personaCount');
const chatTitle = document.getElementById('chatTitle');
const chatSubtitle = document.getElementById('chatSubtitle');
const messages = document.getElementById('messages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendButton');
const backButton = document.getElementById('backButton');
const messageTemplate = document.getElementById('messageTemplate');

const state = {
  personas: [],
  currentPersona: null,
  history: [],
  sending: false
};

function setView(view) {
  homeView.classList.toggle('view-active', view === 'home');
  chatView.classList.toggle('view-active', view === 'chat');
}

function getSelectedMode() {
  const selected = document.querySelector('input[name="mode"]:checked');
  return selected ? selected.value : 'interview';
}

function roleLabel(role) {
  if (role === 'user') return 'You';
  if (role === 'assistant') return state.currentPersona ? state.currentPersona.name : 'Persona';
  return 'System';
}

function pushMessage(role, content) {
  const clone = messageTemplate.content.cloneNode(true);
  const node = clone.querySelector('.message');
  const roleNode = clone.querySelector('.message-role');
  const textNode = clone.querySelector('.message-text');

  node.classList.add(`message-${role}`);
  roleNode.textContent = roleLabel(role);
  textNode.textContent = content;

  messages.appendChild(clone);
  messages.scrollTop = messages.scrollHeight;
}

function clearMessages() {
  messages.innerHTML = '';
}

function startSession(persona) {
  state.currentPersona = persona;
  state.history = [];

  chatTitle.textContent = `${persona.name} · ${persona.persona_type}`;
  chatSubtitle.textContent = `${persona.code} · dedicated key ${persona.project_env}`;

  clearMessages();
  pushMessage(
    'system',
    `Mode setup: choose Interview, Scenario, or Usability in the left panel, then send your first message.\n\n` +
      `The persona will remain in character and supports Out of Character commands: OOC:, /meta, /debrief, /persona-summary, /assumptions.`
  );

  setView('chat');
  chatInput.focus();
}

function renderPersonas() {
  personaGrid.innerHTML = '';
  personaCount.textContent = `${state.personas.length} loaded`;

  for (const persona of state.personas) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'persona-card';
    button.innerHTML = `
      <p class="persona-code">${persona.code}</p>
      <h3>${persona.name}</h3>
      <p class="persona-type">${persona.persona_type}</p>
      <p class="persona-tagline">${persona.tagline}</p>
    `;
    button.addEventListener('click', () => startSession(persona));
    personaGrid.appendChild(button);
  }
}

async function loadPersonas() {
  const response = await fetch('/api/personas');
  if (!response.ok) {
    throw new Error('Failed to load personas.');
  }

  const data = await response.json();
  state.personas = data;
  renderPersonas();
}

async function sendMessage(text) {
  if (!state.currentPersona) return;

  const cleanText = text.trim();
  if (!cleanText || state.sending) return;

  state.sending = true;
  sendButton.disabled = true;

  pushMessage('user', cleanText);

  const payload = {
    personaId: state.currentPersona.id,
    mode: getSelectedMode(),
    message: cleanText,
    history: state.history
  };

  state.history.push({ role: 'user', content: cleanText });

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Chat request failed.');
    }

    pushMessage('assistant', data.reply);
    state.history.push({ role: 'assistant', content: data.reply });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unexpected request error.';
    pushMessage('system', `Request failed: ${detail}`);
  } finally {
    state.sending = false;
    sendButton.disabled = false;
  }
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = chatInput.value;
  chatInput.value = '';
  await sendMessage(text);
  chatInput.focus();
});

backButton.addEventListener('click', () => {
  state.currentPersona = null;
  state.history = [];
  setView('home');
});

(async () => {
  try {
    await loadPersonas();
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown startup error.';
    pushMessage('system', `Startup error: ${detail}`);
    setView('chat');
  }
})();
