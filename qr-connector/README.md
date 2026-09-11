# QR capture connector

This service links WhatsApp accounts by QR code and forwards **only the
contact phone and display name** to the CRM. It does not send messages and
does not persist incoming message bodies. Sessions are isolated by CRM
account under `./data/sessions/<account-id>`.

The connector uses an unofficial WhatsApp Web protocol library. Keep it
isolated from the official Meta Cloud API configuration, use it only with the
account owner's authorization, and expect that WhatsApp can require a new QR
scan or restrict an account at its discretion.

## Environment

Copy `.env.example` to `.env`. Generate one long random secret and use it for
both `CONNECTOR_API_SECRET` and `CRM_CONNECTOR_SECRET`. Set the same value as
`QR_CONNECTOR_SHARED_SECRET` in the CRM deployment.

`CRM_INGEST_API_KEY` remains available only to migrate an older,
single-account installation. New installations should not use it.

## Run

```bash
docker compose up -d --build
```

The session credentials live in `./data` and must be backed up before moving
the VPS. The service listens only on `127.0.0.1:3001`; Caddy should be the
only public entry point. Keep the human-facing root page behind Basic Auth,
but allow `/v1/*` through to the connector: those endpoints independently
require `x-connector-secret` on every request.

```caddyfile
connect.example.com {
  handle /v1/* {
    reverse_proxy 127.0.0.1:3001
  }

  handle {
    basic_auth {
      admin <caddy-password-hash>
    }
    reverse_proxy 127.0.0.1:3001
  }
}
```

When the first CRM account connects after upgrading, an existing legacy
`./data/auth` session is moved into that account's isolated session folder.
