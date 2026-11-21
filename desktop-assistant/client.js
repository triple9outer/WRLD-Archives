const chat = document.querySelector('#chat');
const form = document.querySelector('#chatForm');
const promptInput = document.querySelector('#prompt');
const sendButton = document.querySelector('#sendButton');
const modelStatus = document.querySelector('#modelStatus');
const workspacePath = document.querySelector('#workspacePath');
let messages = [];
let busy = false;
let voiceEnabled = true;

function addMessage(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `message ${role === 'user' ? 'user' : 'ai'}`;
  const label = document.createElement('small');
  label.textContent = role === 'user' ? 'You' : 'WRLD AI · Local';
  const content = document.createElement('div');
  content.textContent = text;
  bubble.append(label, content);
  chat.append(bubble);
  chat.scrollTop = chat.scrollHeight;
  if (role !== 'user' && voiceEnabled) speak(text);
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text).slice(0, 1600));
  // Keep the voice expressive but original: a relaxed pace and gently lowered
  // pitch, using the English voice already installed on the user's Mac.
  utterance.rate = 0.86;
  utterance.pitch = 0.88;
  const voice = window.speechSynthesis.getVoices().find(item => item.lang?.startsWith('en') && item.localService);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function showStatus(text, state = '') {
  modelStatus.className = `status ${state}`;
  modelStatus.querySelector('span').textContent = text;
}

async function refreshStatus() {
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    workspacePath.textContent = `Workspace: ${status.workspace}`;
    if (!status.ollama) showStatus('Ollama is not running', 'error');
    else if (!status.installed) showStatus(`Install model ${status.model}`, 'error');
    else showStatus(`Local model ready · ${status.model}`, 'ready');
  } catch {
    showStatus('Local assistant is unavailable', 'error');
  }
}

function setBusy(value) {
  busy = value;
  sendButton.disabled = value;
  sendButton.textContent = value ? 'Thinking…' : 'Send';
  promptInput.disabled = value;
}

async function sendMessage(text) {
  if (!text.trim() || busy) return;
  addMessage('user', text.trim());
  messages.push({ role: 'user', content: text.trim() });
  promptInput.value = '';
  promptInput.style.height = 'auto';
  setBusy(true);
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.textContent = 'WRLD AI is thinking locally…';
  chat.append(typing);
  chat.scrollTop = chat.scrollHeight;
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages }) });
    const data = await response.json();
    typing.remove();
    if (!response.ok) throw new Error(data.error || 'The local model could not answer.');
    addMessage('assistant', data.reply || 'I could not form a response.');
    messages.push({ role: 'assistant', content: data.reply || '' });
  } catch (error) {
    typing.remove();
    addMessage('assistant', error.message.includes('fetch') ? 'I cannot reach the local model. Check that Ollama is running and the selected model is installed.' : error.message);
  } finally {
    setBusy(false);
    promptInput.focus();
  }
}

form.addEventListener('submit', event => { event.preventDefault(); sendMessage(promptInput.value); });
promptInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
});
promptInput.addEventListener('input', () => { promptInput.style.height = 'auto'; promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`; });

document.querySelector('#workspaceButton').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch('/api/workspace/select', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Folder selection failed.');
    workspacePath.textContent = `Workspace: ${data.workspace}`;
    addMessage('assistant', `Workspace changed to ${data.workspace}. My file access is limited to that folder.`);
  } catch (error) { if (!error.message.includes('cancel')) addMessage('assistant', error.message); }
  finally { button.disabled = false; }
});

document.querySelector('#voiceButton').addEventListener('click', event => {
  voiceEnabled = !voiceEnabled;
  event.currentTarget.textContent = voiceEnabled ? 'Voice on' : 'Voice off';
  event.currentTarget.setAttribute('aria-pressed', String(voiceEnabled));
  if (!voiceEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
});

document.querySelector('#clearButton').addEventListener('click', () => {
  messages = [];
  chat.replaceChildren();
  addMessage('assistant', 'Conversation cleared. What are we working on?');
});

refreshStatus();
if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
