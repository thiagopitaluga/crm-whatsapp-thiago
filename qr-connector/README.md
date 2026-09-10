# QR capture connector

This service links a WhatsApp account by QR code and forwards **only the
contact phone and display name** to the CRM's `POST /api/v1/ingest/whatsapp`
endpoint. It does not send messages and does not persist incoming message
bodies.

The connector uses an unofficial WhatsApp Web protocol library. Keep it
isolated from the official Meta Cloud API configuration, use it only with the
account owner's authorization, and expect that WhatsApp can require a new QR
scan or restrict an account at its discretion.

## Environment

Copy `.env.example` to `.env`. The API key must be restricted to the
`ingest:write` scope.

## Run

```bash
docker compose up -d --build
```

The session credentials live in `./data` and must be backed up before moving
the VPS. The service listens only on `127.0.0.1:3001`; Caddy should be the
only public entry point.
