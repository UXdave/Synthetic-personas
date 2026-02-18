const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'data', 'config', 'personas.json');

function fail(message) {
  console.error(`[check] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  fail('Missing data/config/personas.json');
}

let personas;
try {
  personas = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  fail(`Invalid personas.json: ${error.message}`);
}

if (!Array.isArray(personas) || personas.length !== 7) {
  fail('Expected exactly 7 personas in config.');
}

for (const persona of personas) {
  for (const key of ['id', 'code', 'name', 'persona_type', 'dossier_path', 'policy_path', 'api_key_env']) {
    if (!persona[key]) {
      fail(`Persona ${persona.id || '(unknown)'} missing ${key}`);
    }
  }

  const dossierPath = path.join(root, persona.dossier_path);
  const policyPath = path.join(root, persona.policy_path);

  if (!fs.existsSync(dossierPath)) {
    fail(`Missing dossier file: ${persona.dossier_path}`);
  }
  if (!fs.existsSync(policyPath)) {
    fail(`Missing policy file: ${persona.policy_path}`);
  }

  try {
    JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch (error) {
    fail(`Invalid policy JSON (${persona.policy_path}): ${error.message}`);
  }
}

for (const file of ['server.js', 'public/index.html', 'public/styles.css', 'public/app.js']) {
  if (!fs.existsSync(path.join(root, file))) {
    fail(`Missing required file: ${file}`);
  }
}

console.log('[check] OK - configuration and required files are present.');
