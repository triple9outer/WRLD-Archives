import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';

const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const AUTH_FILE = path.join(os.homedir(), '.wrld-archives', 'discord-auth.json');

export function encodeRpcFrame(opcode, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(opcode, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export function sanitizePresenceTrack(track = {}, { showUnreleased = true, now = Date.now() } = {}) {
  if (!track || typeof track !== 'object') return null;
  const title = cleanText(track.title, 120);
  if (!title) return null;
  const unreleased = track.status === 'unreleased';
  const album = cleanText(track.album, 100);
  const version = cleanText(track.version, 60);
  const hiddenTitle = unreleased && !showUnreleased;
  const details = hiddenTitle ? 'Unreleased song' : [title, version].filter(Boolean).join(' · ');
  const activity = {
    type: 2,
    details: cleanText(details, 128),
    state: ['Juice WRLD', album].filter(Boolean).join(' · '),
  };
  if (track.playing === true) {
    const position = Math.max(0, finite(track.position));
    const duration = Math.max(0, finite(track.duration));
    const start = Math.floor(now / 1000 - position);
    activity.timestamps = { start };
    if (duration > position) activity.timestamps.end = start + Math.floor(duration);
  } else {
    activity.state = `Paused · ${activity.state}`;
  }
  return activity;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function discordSocketPaths() {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
  const prefixes = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp'].filter(Boolean);
  return [...new Set(prefixes)].flatMap(prefix => Array.from({ length: 10 }, (_, index) => path.join(prefix, `discord-ipc-${index}`)));
}

async function connectSocket(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => socket.destroy(new Error('Timed out connecting to Discord.')), 650);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

async function openDiscordSocket() {
  const errors = [];
  for (const socketPath of discordSocketPaths()) {
    try { return await connectSocket(socketPath); }
    catch (error) { errors.push(error); }
  }
  throw new Error('Could not find the Discord desktop app. Open Discord on this computer and try again.');
}

class DiscordRpcConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.listeners = new Set();
    this.closeListeners = new Set();
    this.closed = false;
    socket.on('data', chunk => this.#receive(chunk));
    socket.on('close', () => {
      this.closed = true;
      this.#rejectPending(new Error('Discord closed the Rich Presence connection.'));
      for (const listener of this.closeListeners) listener();
    });
    socket.on('error', error => this.#rejectPending(error));
  }

  #receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(4);
      if (length > 1_000_000) { this.socket.destroy(new Error('Discord sent an oversized RPC frame.')); return; }
      if (this.buffer.length < length + 8) return;
      const body = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      if (opcode === 3) {
        const pongHeader = Buffer.alloc(8);
        pongHeader.writeUInt32LE(4, 0);
        pongHeader.writeUInt32LE(body.length, 4);
        this.socket.write(Buffer.concat([pongHeader, body]));
        continue;
      }
      let message;
      try { message = JSON.parse(body.toString('utf8')); } catch { continue; }
      if (message.nonce && this.pending.has(message.nonce)) {
        const { resolve, reject, timer } = this.pending.get(message.nonce);
        this.pending.delete(message.nonce);
        clearTimeout(timer);
        if (message.evt === 'ERROR') reject(new Error(message.data?.message || 'Discord rejected the Rich Presence request.'));
        else resolve(message.data || {});
      }
      for (const listener of this.listeners) listener(message, opcode);
    }
  }

  #rejectPending(error) {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
  }

  onMessage(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onClose(listener) { this.closeListeners.add(listener); return () => this.closeListeners.delete(listener); }

  send(opcode, payload) {
    if (this.closed || this.socket.destroyed) throw new Error('Discord Rich Presence is disconnected.');
    this.socket.write(encodeRpcFrame(opcode, payload));
  }

  async handshake(clientId) {
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { off(); reject(new Error('Discord did not finish the Rich Presence handshake.')); }, 8_000);
      const off = this.onMessage(message => {
        if (message.evt === 'READY') { clearTimeout(timeout); off(); resolve(message.data); }
        else if (message.evt === 'ERROR' && message.data?.code) { clearTimeout(timeout); off(); reject(new Error(message.data.message || 'Discord handshake failed.')); }
      });
    });
    this.send(0, { v: 1, client_id: clientId });
    await ready;
  }

  request(cmd, args, timeoutMs = 10_000) {
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(nonce); reject(new Error(`${cmd} timed out. Approve the WRLD Archives connection in Discord and try again.`)); }, timeoutMs);
      this.pending.set(nonce, { resolve, reject, timer });
      try { this.send(1, { cmd, args, nonce }); }
      catch (error) { clearTimeout(timer); this.pending.delete(nonce); reject(error); }
    });
  }

  close() { if (!this.closed) this.socket.end(encodeRpcFrame(2, {})); }
}

async function postToken(form) {
  const response = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || 'Discord token exchange failed.');
  return data;
}

async function loadSavedAuth() {
  try { return JSON.parse(await readFile(AUTH_FILE, 'utf8')); }
  catch { return null; }
}

async function saveAuth(data) {
  await mkdir(path.dirname(AUTH_FILE), { recursive: true, mode: 0o700 });
  await writeFile(AUTH_FILE, JSON.stringify({ refresh_token: data.refresh_token, expires_at: Date.now() + Math.max(0, Number(data.expires_in) || 0) * 1000 }), { mode: 0o600 });
  await chmod(AUTH_FILE, 0o600).catch(() => {});
}

export class DiscordPresenceService {
  constructor({ applicationId = process.env.WRLD_DISCORD_APPLICATION_ID || process.env.DISCORD_APPLICATION_ID || '', assetKey = process.env.WRLD_DISCORD_ASSET_KEY || '' } = {}) {
    const candidateId = String(applicationId).trim();
    this.applicationId = /^\d{17,20}$/.test(candidateId) ? candidateId : '';
    this.assetKey = cleanText(assetKey, 64);
    this.connection = null;
    this.connectPromise = null;
    this.enabled = false;
    this.connected = false;
    this.state = this.applicationId ? 'disconnected' : 'needs-setup';
    this.error = '';
    this.latest = null;
    this.lastUpdate = 0;
    this.disconnectListener = null;
    this.watchdog = setInterval(() => {
      if (this.enabled && this.latest && this.lastUpdate && Date.now() - this.lastUpdate > 150_000) void this.clearPresence();
    }, 30_000);
    this.watchdog.unref?.();
  }

  getStatus() {
    return {
      configured: Boolean(this.applicationId),
      connected: this.connected,
      enabled: this.enabled,
      state: this.state,
      error: this.error,
      needsAuthorization: this.state === 'disconnected' || this.state === 'needs-setup',
    };
  }

  async enable(track, showUnreleased = true) {
    this.enabled = true;
    this.latest = sanitizePresenceTrack(track, { showUnreleased });
    this.lastUpdate = Date.now();
    if (!this.applicationId) { this.state = 'needs-setup'; this.error = 'Add the Discord application ID to desktop-assistant/.env first.'; return this.getStatus(); }
    if (this.connected) { await this.#applyLatest(); return this.getStatus(); }
    if (!this.connectPromise) {
      this.state = 'connecting';
      this.error = '';
      this.connectPromise = this.#connect().catch(error => {
        this.connected = false;
        this.state = 'error';
        this.error = error.message;
        this.connection?.close();
        this.connection = null;
      }).finally(() => { this.connectPromise = null; });
    }
    return this.getStatus();
  }

  async disable() {
    this.enabled = false;
    this.latest = null;
    this.lastUpdate = 0;
    await this.#clearActivity();
    return this.getStatus();
  }

  async update(track, showUnreleased = true) {
    if (!this.enabled) return this.getStatus();
    this.latest = sanitizePresenceTrack(track, { showUnreleased });
    this.lastUpdate = Date.now();
    if (!this.latest) await this.#clearActivity();
    else if (!this.connected && !this.connectPromise) return this.enable(track, showUnreleased);
    else if (this.connected) await this.#applyLatest();
    return this.getStatus();
  }

  async clearPresence() {
    this.latest = null;
    this.lastUpdate = Date.now();
    await this.#clearActivity();
    return this.getStatus();
  }

  async #connect() {
    const socket = await openDiscordSocket();
    const rpc = new DiscordRpcConnection(socket);
    this.connection = rpc;
    this.disconnectListener = rpc.onClose(() => {
      if (this.connection !== rpc) return;
      this.connected = false;
      this.state = 'disconnected';
      this.connection = null;
    });
    await rpc.handshake(this.applicationId);

    const saved = await loadSavedAuth();
    let token = null;
    if (saved?.refresh_token) {
      try {
        token = await postToken({ grant_type: 'refresh_token', client_id: this.applicationId, refresh_token: saved.refresh_token });
        await saveAuth({ ...token, refresh_token: token.refresh_token || saved.refresh_token });
      } catch { /* The existing consent can be refreshed by asking the user to authorize again. */ }
    }
    if (!token) {
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const auth = await rpc.request('AUTHORIZE', {
        client_id: this.applicationId,
        scopes: ['rpc'],
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }, 120_000);
      if (!auth.code) throw new Error('Discord did not return an authorization code.');
      token = await postToken({ grant_type: 'authorization_code', client_id: this.applicationId, code: auth.code, code_verifier: verifier });
      await saveAuth(token);
    }
    if (!token.access_token) throw new Error('Discord did not provide a Rich Presence access token.');
    await rpc.request('AUTHENTICATE', { access_token: token.access_token });
    this.connected = true;
    this.state = 'connected';
    this.error = '';
    if (this.enabled && this.latest) await this.#applyLatest();
  }

  async #applyLatest() {
    if (!this.connection || !this.connected || !this.enabled) return;
    const activity = this.latest ? { ...this.latest } : null;
    if (activity && this.assetKey) {
      activity.assets = { large_image: this.assetKey, large_text: 'WRLD Archives' };
    }
    try { await this.connection.request('SET_ACTIVITY', { pid: process.pid, activity }); }
    catch (error) { this.error = error.message; throw error; }
  }

  async #clearActivity() {
    if (!this.connection || !this.connected) return;
    try { await this.connection.request('SET_ACTIVITY', { pid: process.pid, activity: null }); }
    catch (error) { this.error = error.message; }
  }

  close() {
    clearInterval(this.watchdog);
    this.enabled = false;
    void this.#clearActivity().finally(() => this.connection?.close());
  }
}
