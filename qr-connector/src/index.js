import express from 'express'
import P from 'pino'
import QRCode from 'qrcode'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'

const port = Number(process.env.PORT ?? 3001)
const authDir = process.env.AUTH_DIR ?? '/app/data/auth'
const crmBaseUrl = required('CRM_BASE_URL').replace(/\/$/, '')
const ingestKey = required('CRM_INGEST_API_KEY')

let connectionStatus = 'starting'
let qrSvg = null
let lastError = null
let reconnectTimer = null

const app = express()
app.disable('x-powered-by')

app.get('/health', (_req, res) => {
  res.status(200).type('text').send('ok')
})

app.get('/status', (_req, res) => {
  res.json({ status: connectionStatus, qr_available: Boolean(qrSvg), last_error: lastError })
})

app.get('/qr.svg', (_req, res) => {
  if (!qrSvg) return res.status(404).type('text').send('QR ainda não disponível')
  res.type('image/svg+xml').send(qrSvg)
})

app.get('/', (_req, res) => {
  const content = qrSvg
    ? '<img src="/qr.svg" alt="QR Code para conectar o WhatsApp" />'
    : '<p>O QR ainda não está disponível. Atualize esta página em alguns segundos.</p>'
  res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="20"><title>Conector QR</title><style>body{font-family:system-ui;background:#0b0b0d;color:#f4f4f5;margin:0;min-height:100vh;display:grid;place-items:center}.card{max-width:420px;padding:28px;text-align:center;background:#18181b;border-radius:16px}img{width:min(320px,80vw);background:white;padding:12px;border-radius:10px}small{color:#a1a1aa}</style></head><body><main class="card"><h1>Conectar WhatsApp</h1><p>Abra WhatsApp → Dispositivos conectados → Conectar dispositivo e escaneie este código.</p>${content}<p><small>Status: ${escapeHtml(connectionStatus)}</small></p></main></body></html>`)
})

app.listen(port, '0.0.0.0', () => {
  console.log(`[qr-connector] listening on ${port}`)
})

void connect()

async function connect() {
  clearTimeout(reconnectTimer)
  connectionStatus = 'connecting'
  lastError = null

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    const { version } = await fetchLatestBaileysVersion()
    const socket = makeWASocket({
      auth: state,
      version,
      logger: P({ level: 'silent' }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    })

    socket.ev.on('creds.update', saveCreds)

    socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        qrSvg = await QRCode.toString(qr, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
        connectionStatus = 'awaiting_qr_scan'
      }

      if (connection === 'open') {
        qrSvg = null
        connectionStatus = 'connected'
        lastError = null
        console.log('[qr-connector] WhatsApp connected')
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : undefined
        const loggedOut = statusCode === DisconnectReason.loggedOut
        qrSvg = null
        connectionStatus = loggedOut ? 'logged_out' : 'reconnecting'
        lastError = loggedOut ? 'A sessão foi desconectada. Gere e escaneie um novo QR.' : null
        if (!loggedOut) scheduleReconnect()
      }
    })

    socket.ev.on('messages.upsert', ({ type, messages }) => {
      if (type !== 'notify') return
      for (const message of messages) void ingestInboundMessage(message)
    })
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Falha desconhecida ao iniciar'
    connectionStatus = 'reconnecting'
    console.error('[qr-connector] connect error:', error)
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => void connect(), 5000)
}

async function ingestInboundMessage(message) {
  if (message.key.fromMe) return
  const jid = message.key.remoteJid
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || !jid.endsWith('@s.whatsapp.net')) return

  const phone = `+${jid.slice(0, jid.indexOf('@')).replace(/\D/g, '')}`
  if (phone === '+') return
  const name = message.pushName?.trim() || null

  try {
    const response = await fetch(`${crmBaseUrl}/api/v1/ingest/whatsapp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ingestKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ phone, name }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      console.error('[qr-connector] CRM ingest rejected:', response.status, await response.text())
    }
  } catch (error) {
    console.error('[qr-connector] CRM ingest failed:', error)
  }
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}
