import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import express from 'express';
import P from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

// libsignal can write complete encrypted session objects directly to stdout.
// Those objects are not useful operational logs and must never end up in a
// container log collector or support transcript.
const originalConsoleLog = console.log.bind(console);
console.log = (...args) => {
  if (
    args.some(
      (arg) => typeof arg === 'string' && arg.startsWith('Closing session:')
    )
  )
    return;
  originalConsoleLog(...args);
};

const port = Number(process.env.PORT ?? 3001);
const authRoot = process.env.AUTH_ROOT ?? '/app/data/sessions';
const legacyAuthDir = process.env.AUTH_DIR ?? '/app/data/auth';
const crmBaseUrl = required('CRM_BASE_URL').replace(/\/$/, '');
const connectorApiSecret = required('CONNECTOR_API_SECRET');
const crmConnectorSecret = process.env.CRM_CONNECTOR_SECRET?.trim() || null;
const legacyIngestKey = process.env.CRM_INGEST_API_KEY?.trim() || null;

if (!crmConnectorSecret && !legacyIngestKey) {
  throw new Error('CRM_CONNECTOR_SECRET or CRM_INGEST_API_KEY is required');
}

const sessions = new Map();
let legacyClaimedBy = null;

const app = express();
app.disable('x-powered-by');
app.use('/v1', express.json({ limit: '32kb' }), authenticateConnectorRequest);

app.get('/health', (_req, res) => {
  res.status(200).type('text').send('ok');
});

app.get('/v1/sessions/:accountId/status', (req, res) => {
  const accountId = parseAccountId(req.params.accountId);
  if (!accountId) return res.status(400).json({ error: 'invalid_account_id' });
  res.set('cache-control', 'no-store').json(publicSessionState(accountId));
});

app.get('/v1/sessions/:accountId/qr.svg', (req, res) => {
  const accountId = parseAccountId(req.params.accountId);
  if (!accountId) return res.status(400).json({ error: 'invalid_account_id' });
  const session = sessions.get(accountId);
  if (!session?.qrSvg) {
    return res.status(404).json({
      error: 'qr_not_available',
      status: session?.status ?? 'disconnected',
    });
  }
  res
    .set('cache-control', 'no-store, max-age=0')
    .set('x-content-type-options', 'nosniff')
    .type('image/svg+xml')
    .send(session.qrSvg);
});

app.post('/v1/sessions/:accountId/connect', async (req, res) => {
  const accountId = parseAccountId(req.params.accountId);
  if (!accountId) return res.status(400).json({ error: 'invalid_account_id' });

  try {
    await startSession(accountId);
    res.status(202).json(publicSessionState(accountId));
  } catch (error) {
    console.error('[qr-connector] failed to start session:', safeError(error));
    res.status(500).json({ error: 'session_start_failed' });
  }
});

app.post('/v1/sessions/:accountId/import', async (req, res) => {
  const accountId = parseAccountId(req.params.accountId);
  if (!accountId) return res.status(400).json({ error: 'invalid_account_id' });

  const session = sessions.get(accountId);
  if (!session || session.status !== 'connected') {
    return res.status(409).json({ error: 'whatsapp_not_connected' });
  }

  try {
    await startHistoryImport(session);
    res.status(202).json(publicSessionState(accountId));
  } catch (error) {
    console.error(
      '[qr-connector] failed to start history import:',
      safeError(error)
    );
    res.status(500).json({ error: 'history_import_start_failed' });
  }
});

app.delete('/v1/sessions/:accountId', async (req, res) => {
  const accountId = parseAccountId(req.params.accountId);
  if (!accountId) return res.status(400).json({ error: 'invalid_account_id' });

  try {
    await removeSession(accountId);
    res
      .status(200)
      .json({ status: 'disconnected', qr_available: false, last_error: null });
  } catch (error) {
    console.error('[qr-connector] failed to remove session:', safeError(error));
    res.status(500).json({ error: 'session_remove_failed' });
  }
});

app.get('/', (_req, res) => {
  res
    .type('html')
    .send(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conector QR</title><style>body{font-family:system-ui;background:#0b0b0d;color:#f4f4f5;margin:0;min-height:100vh;display:grid;place-items:center}.card{max-width:440px;padding:28px;text-align:center;background:#18181b;border-radius:16px}p{color:#a1a1aa;line-height:1.5}</style></head><body><main class="card"><h1>Conector WhatsApp</h1><p>A conexão por QR agora é administrada com segurança dentro do painel do CRM.</p></main></body></html>`
    );
});

app.listen(port, '0.0.0.0', () => {
  console.log(`[qr-connector] listening on ${port}`);
});

void restorePersistedSessions();

async function restorePersistedSessions() {
  await fs.mkdir(authRoot, { recursive: true });
  const entries = await fs
    .readdir(authRoot, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const accountId = parseAccountId(entry.name);
    if (accountId) void startSession(accountId);
  }
}

async function startSession(accountId) {
  let session = sessions.get(accountId);
  if (
    session &&
    ['connecting', 'awaiting_qr_scan', 'connected'].includes(session.status)
  ) {
    return session;
  }

  if (!session) {
    session = createSession(accountId);
    sessions.set(accountId, session);
  }

  clearTimeout(session.reconnectTimer);
  session.reconnectTimer = null;
  session.status = 'connecting';
  session.qrSvg = null;
  session.lastError = null;
  session.generation += 1;
  const generation = session.generation;

  if (session.wasLoggedOut) {
    await fs.rm(session.authDir, { recursive: true, force: true });
    session.wasLoggedOut = false;
  }

  await adoptLegacySessionIfAvailable(accountId, session.authDir);
  await fs.mkdir(session.authDir, { recursive: true });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(session.authDir);
    const { version } = await fetchLatestBaileysVersion();
    const socket = makeWASocket({
      auth: state,
      version,
      logger: P({ level: 'silent' }),
      markOnlineOnConnect: false,
      syncFullHistory: session.historyImport?.status === 'preparing',
      generateHighQualityLinkPreview: false,
    });
    session.socket = socket;

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('messaging-history.set', (history) => {
      if (generation !== session.generation) return;
      if (session.historyImport?.status !== 'preparing') return;
      collectHistoryImport(session, history);
    });

    socket.ev.on(
      'connection.update',
      async ({ connection, lastDisconnect, qr }) => {
        if (generation !== session.generation) return;

        if (qr) {
          session.qrSvg = await QRCode.toString(qr, {
            type: 'svg',
            margin: 1,
            errorCorrectionLevel: 'M',
          });
          session.status = 'awaiting_qr_scan';
        }

        if (connection === 'open') {
          session.qrSvg = null;
          session.status = 'connected';
          session.lastError = null;
          console.log(
            `[qr-connector] WhatsApp connected for account ${accountId}`
          );
        }

        if (connection === 'close') {
          const statusCode =
            lastDisconnect?.error instanceof Boom
              ? lastDisconnect.error.output.statusCode
              : undefined;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          session.socket = null;
          session.qrSvg = null;
          session.wasLoggedOut = loggedOut;
          session.status = loggedOut ? 'logged_out' : 'reconnecting';
          session.lastError = loggedOut
            ? 'A sessão foi desconectada. Gere e escaneie um novo QR.'
            : null;
          if (!loggedOut) scheduleReconnect(session);
        }
      }
    );

    socket.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      if (generation !== session.generation) return;
      if (lid?.endsWith('@lid') && jid?.endsWith('@s.whatsapp.net')) {
        session.phoneJidsByLid.set(lid, jid);
      }
    });

    socket.ev.on('messages.upsert', ({ type, messages }) => {
      if (generation !== session.generation) return;
      console.log(
        `[qr-connector] message event for account ${accountId}: type=${type}, count=${messages.length}`
      );
      if (type !== 'notify') return;
      for (const message of messages)
        void ingestInboundMessage(accountId, message, session);
    });
  } catch (error) {
    session.lastError = safeError(error);
    session.status = 'reconnecting';
    console.error('[qr-connector] connect error:', session.lastError);
    scheduleReconnect(session);
  }

  return session;
}

function createSession(accountId) {
  return {
    accountId,
    authDir: path.join(authRoot, accountId),
    status: 'disconnected',
    qrSvg: null,
    lastError: null,
    reconnectTimer: null,
    socket: null,
    phoneJidsByLid: new Map(),
    historyImport: null,
    historyCandidates: new Map(),
    historyImportTimer: null,
    historyImportTimeout: null,
    wasLoggedOut: false,
    generation: 0,
  };
}

function scheduleReconnect(session) {
  clearTimeout(session.reconnectTimer);
  session.reconnectTimer = setTimeout(
    () => void startSession(session.accountId),
    5000
  );
}

async function removeSession(accountId) {
  const session = sessions.get(accountId);
  if (!session) return;

  session.generation += 1;
  clearTimeout(session.reconnectTimer);
  session.reconnectTimer = null;
  clearTimeout(session.historyImportTimer);
  clearTimeout(session.historyImportTimeout);
  try {
    await session.socket?.logout();
  } catch {
    session.socket?.end(new Error('Session removed by CRM administrator'));
  }
  await fs.rm(session.authDir, { recursive: true, force: true });
  sessions.delete(accountId);
}

async function adoptLegacySessionIfAvailable(accountId, destination) {
  if (legacyClaimedBy && legacyClaimedBy !== accountId) return;
  if (await directoryHasFiles(destination)) return;
  if (!(await directoryHasFiles(legacyAuthDir))) return;

  legacyClaimedBy = accountId;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(legacyAuthDir, destination);
  console.log(`[qr-connector] migrated legacy session to account ${accountId}`);
}

async function directoryHasFiles(directory) {
  const entries = await fs.readdir(directory).catch(() => []);
  return entries.length > 0;
}

function publicSessionState(accountId) {
  const session = sessions.get(accountId);
  return {
    status: session?.status ?? 'disconnected',
    qr_available: Boolean(session?.qrSvg),
    last_error: session?.lastError ?? null,
    history_import: session?.historyImport
      ? {
          status: session.historyImport.status,
          discovered: session.historyImport.discovered,
          imported: session.historyImport.imported,
          failed: session.historyImport.failed,
          error: session.historyImport.error,
        }
      : null,
  };
}

async function startHistoryImport(session) {
  if (
    session.historyImport?.status === 'preparing' ||
    session.historyImport?.status === 'running'
  ) {
    return;
  }

  session.historyImport = {
    status: 'preparing',
    discovered: 0,
    imported: 0,
    failed: 0,
    error: null,
  };
  session.historyCandidates.clear();
  clearTimeout(session.historyImportTimer);
  clearTimeout(session.historyImportTimeout);
  session.historyImportTimeout = setTimeout(() => {
    if (session.historyImport?.status === 'preparing') {
      session.historyImport.status = 'failed';
      session.historyImport.error =
        'O WhatsApp não enviou o histórico. Tente novamente.';
      console.error('[qr-connector] history import timed out');
    }
  }, 60_000);

  // Baileys only sends a history snapshot when a socket opens with this
  // option. Restarting preserves the authenticated session and does not
  // require reading a new QR code.
  session.generation += 1;
  clearTimeout(session.reconnectTimer);
  session.reconnectTimer = null;
  session.status = 'reconnecting';
  session.socket?.end(new Error('Restarting to import historical chats'));
  await startSession(session.accountId);
}

function collectHistoryImport(session, history) {
  const contactsByJid = new Map();
  for (const contact of Array.isArray(history.contacts)
    ? history.contacts
    : []) {
    const jid = typeof contact?.id === 'string' ? contact.id : null;
    if (!jid?.endsWith('@s.whatsapp.net')) continue;
    const name = [contact.name, contact.notify, contact.verifiedName].find(
      (value) => typeof value === 'string' && value.trim()
    );
    contactsByJid.set(jid, name?.trim() || null);
  }

  for (const chat of Array.isArray(history.chats) ? history.chats : []) {
    const jid = typeof chat?.id === 'string' ? chat.id : null;
    if (!jid?.endsWith('@s.whatsapp.net')) continue;
    session.historyCandidates.set(jid, contactsByJid.get(jid) || null);
  }

  session.historyImport.discovered = session.historyCandidates.size;
  clearTimeout(session.historyImportTimer);
  session.historyImportTimer = setTimeout(
    () => void flushHistoryImport(session),
    2500
  );
}

async function flushHistoryImport(session) {
  if (session.historyImport?.status !== 'preparing') return;
  clearTimeout(session.historyImportTimeout);
  session.historyImport.status = 'running';
  const candidates = [...session.historyCandidates.entries()];

  // Keep the VPS and CRM responsive even for accounts with a long history.
  const workers = Array.from({ length: Math.min(4, candidates.length) }, () =>
    importHistoryWorker(session, candidates)
  );
  await Promise.all(workers);

  session.historyImport.status = 'completed';
  console.log(
    `[qr-connector] history import completed for account ${session.accountId}: imported=${session.historyImport.imported}, failed=${session.historyImport.failed}`
  );
}

async function importHistoryWorker(session, candidates) {
  for (;;) {
    const candidate = candidates.pop();
    if (!candidate) return;
    const [jid, name] = candidate;
    const phone = `+${jid.slice(0, jid.indexOf('@')).replace(/\D/g, '')}`;
    if (phone === '+') {
      session.historyImport.failed += 1;
      continue;
    }
    if (await sendLeadToCrm(session.accountId, phone, name)) {
      session.historyImport.imported += 1;
    } else {
      session.historyImport.failed += 1;
    }
  }
}

async function ingestInboundMessage(accountId, message, session) {
  if (message.key.fromMe) {
    console.log(
      `[qr-connector] ignored outbound message for account ${accountId}`
    );
    return;
  }

  const remoteJid = message.key.remoteJid;
  const jid = remoteJid?.endsWith('@lid')
    ? session.phoneJidsByLid.get(remoteJid)
    : remoteJid;
  if (
    !jid ||
    jid.endsWith('@g.us') ||
    jid.endsWith('@broadcast') ||
    !jid.endsWith('@s.whatsapp.net')
  ) {
    console.log(
      `[qr-connector] ignored inbound message for account ${accountId}: unsupported_sender_identifier`
    );
    return;
  }

  const phone = `+${jid.slice(0, jid.indexOf('@')).replace(/\D/g, '')}`;
  if (phone === '+') {
    console.log(
      `[qr-connector] ignored inbound message for account ${accountId}: invalid_phone`
    );
    return;
  }
  const name = message.pushName?.trim() || null;

  await sendLeadToCrm(accountId, phone, name);
}

async function sendLeadToCrm(accountId, phone, name) {
  const endpoint = crmConnectorSecret
    ? `${crmBaseUrl}/api/internal/qr-ingest`
    : `${crmBaseUrl}/api/v1/ingest/whatsapp`;
  const authorizationHeaders = crmConnectorSecret
    ? { 'x-connector-secret': crmConnectorSecret }
    : { authorization: `Bearer ${legacyIngestKey}` };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...authorizationHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ account_id: accountId, phone, name }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error('[qr-connector] CRM ingest rejected:', response.status);
      return false;
    } else {
      console.log(
        `[qr-connector] CRM ingest accepted for account ${accountId}`
      );
      return true;
    }
  } catch (error) {
    console.error('[qr-connector] CRM ingest failed:', safeError(error));
    return false;
  }
}

function authenticateConnectorRequest(req, res, next) {
  const supplied = req.get('x-connector-secret')?.trim() ?? '';
  if (!safeSecretEqual(supplied, connectorApiSecret)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

function safeSecretEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseAccountId(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    normalized
  )
    ? normalized
    : null;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeError(error) {
  return error instanceof Error ? error.message : 'Falha desconhecida';
}
