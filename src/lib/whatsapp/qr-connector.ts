import crypto from 'node:crypto';

type QrConnectorSuffix =
  | 'status'
  | 'qr.svg'
  | 'connect'
  | 'import'
  | 'groups'
  | 'groups/send'
  | 'groups/participants'
  | 'messages/send'
  | 'messages/media'
  | 'messages/read'
  | '';

export class QrConnectorConfigurationError extends Error {
  constructor(message = 'QR connector is not configured') {
    super(message);
    this.name = 'QrConnectorConfigurationError';
  }
}

export function getQrConnectorSecret(): string {
  const secret = process.env.QR_CONNECTOR_SHARED_SECRET?.trim();
  if (!secret) throw new QrConnectorConfigurationError();
  return secret;
}

export function isValidQrConnectorSecret(supplied: string | null): boolean {
  if (!supplied) return false;
  return [
    process.env.QR_CONNECTOR_SHARED_SECRET,
    process.env.EVOLUTION_WEBHOOK_SECRET,
  ].some((expected) => matchesSecret(supplied, expected));
}

export function isValidEvolutionWebhookSecret(
  supplied: string | null
): boolean {
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!supplied || !expected) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isValidInboundConnectorSecret(
  supplied: string | null
): boolean {
  return isValidQrConnectorSecret(supplied);
}

function matchesSecret(
  supplied: string,
  expected: string | undefined
): boolean {
  if (!expected?.trim()) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected.trim());
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function fetchEvolutionMediaBase64(
  accountId: string,
  message: Record<string, unknown>,
  signal: AbortSignal = AbortSignal.timeout(25_000),
  instanceName?: string
): Promise<{
  base64: string;
  mimeType: string;
  fileName: string | null;
} | null> {
  if (process.env.WHATSAPP_QR_PROVIDER !== 'evolution') return null;
  const { baseUrl, apiKey } = evolutionConfiguration();
  const response = await evolutionRequest(
    baseUrl,
    apiKey,
    `chat/getBase64FromMediaMessage/${instanceName ?? evolutionInstanceName(accountId)}`,
    {
      method: 'POST',
      body: JSON.stringify({ message }),
      signal,
    }
  );
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const base64 = typeof payload?.base64 === 'string' ? payload.base64 : '';
  const mimeType =
    typeof payload?.mimetype === 'string'
      ? payload.mimetype.split(';')[0].trim().toLowerCase()
      : '';
  const fileName =
    typeof payload?.fileName === 'string'
      ? payload.fileName
      : typeof payload?.filename === 'string'
        ? payload.filename
        : null;
  return base64 && mimeType.includes('/')
    ? { base64: base64.replace(/^data:[^,]+;base64,/, ''), mimeType, fileName }
    : null;
}

export async function fetchQrConnector(
  accountId: string,
  suffix: QrConnectorSuffix,
  init: RequestInit = {},
  options: { instanceName?: string; channelKey?: string } = {}
): Promise<Response> {
  if (process.env.WHATSAPP_QR_PROVIDER === 'evolution') {
    return fetchEvolutionQrConnector(accountId, suffix, init, options);
  }

  return fetchLegacyQrConnector(accountId, suffix, init);
}

async function fetchLegacyQrConnector(
  accountId: string,
  suffix: QrConnectorSuffix,
  init: RequestInit
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) {
    throw new Error('Invalid account id');
  }

  const rawBaseUrl = process.env.QR_CONNECTOR_BASE_URL?.trim();
  if (!rawBaseUrl) throw new QrConnectorConfigurationError();

  const baseUrl = new URL(rawBaseUrl);
  if (baseUrl.protocol !== 'https:' && baseUrl.hostname !== 'localhost') {
    throw new QrConnectorConfigurationError('QR connector must use HTTPS');
  }

  const resource = suffix ? `/${suffix}` : '';
  const url = new URL(
    `/v1/sessions/${encodeURIComponent(accountId)}${resource}`,
    baseUrl
  );
  const headers = new Headers(init.headers);
  headers.set('x-connector-secret', getQrConnectorSecret());
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
    // A group send is sequential and may take longer than a status check.
    signal:
      init.signal ??
      AbortSignal.timeout(suffix === 'groups/send' ? 48_000 : 10_000),
  });
}

async function fetchEvolutionQrConnector(
  accountId: string,
  suffix: QrConnectorSuffix,
  init: RequestInit,
  options: { instanceName?: string; channelKey?: string } = {}
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) {
    throw new Error('Invalid account id');
  }

  const { baseUrl, apiKey } = evolutionConfiguration();
  const instance = options.instanceName ?? evolutionInstanceName(accountId);
  const timeout = init.signal ?? AbortSignal.timeout(48_000);

  if (suffix === 'status') {
    const response = await evolutionRequest(
      baseUrl,
      apiKey,
      `instance/connectionState/${instance}`,
      {
        signal: timeout,
      }
    );
    if (!response.ok) {
      if (response.status === 404)
        return jsonResponse({ status: 'disconnected', qr_available: false });
      return response;
    }
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const detail = asRecord(payload?.instance);
    const state =
      typeof detail?.state === 'string' ? detail.state.toLowerCase() : '';
    let qrVersion: string | null = null;
    if (state === 'connecting') {
      const qrResponse = await evolutionRequest(
        baseUrl,
        apiKey,
        `instance/connect/${instance}`,
        { signal: timeout }
      );
      if (qrResponse.ok) {
        const qrPayload = (await qrResponse.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        const qrData = asRecord(qrPayload?.qrcode);
        const qrCode =
          (typeof qrPayload?.code === 'string' && qrPayload.code) ||
          (typeof qrData?.code === 'string' && qrData.code) ||
          (typeof qrPayload?.base64 === 'string' && qrPayload.base64) ||
          (typeof qrData?.base64 === 'string' && qrData.base64) ||
          '';
        if (qrCode) {
          qrVersion = crypto
            .createHash('sha256')
            .update(qrCode)
            .digest('hex')
            .slice(0, 16);
        }
      }
    }
    return jsonResponse({
      status:
        state === 'open'
          ? 'connected'
          : state === 'connecting'
            ? 'awaiting_qr_scan'
            : 'disconnected',
      qr_available: state !== 'open' && state !== 'close',
      qr_version: qrVersion,
      last_error: null,
    });
  }

  if (suffix === 'connect') {
    const requestBody = parseJsonBody(init.body);
    const pairingNumber =
      typeof requestBody?.pairing_number === 'string'
        ? requestBody.pairing_number.replace(/\D/g, '')
        : '';
    if (requestBody?.pairing_number !== undefined) {
      if (!/^\d{8,15}$/.test(pairingNumber))
        return jsonResponse(
          { error: 'Informe o telefone com código do país e DDD.' },
          400
        );

      const current = await evolutionRequest(
        baseUrl,
        apiKey,
        `instance/connectionState/${instance}`,
        { signal: timeout }
      );
      if (current.ok) {
        const currentPayload = (await current
          .json()
          .catch(() => null)) as Record<string, unknown> | null;
        const currentInstance = asRecord(currentPayload?.instance);
        if (
          typeof currentInstance?.state === 'string' &&
          currentInstance.state.toLowerCase() === 'open'
        )
          return jsonResponse(
            { error: 'Este WhatsApp já está conectado.' },
            409
          );
        const removed = await evolutionRequest(
          baseUrl,
          apiKey,
          `instance/delete/${instance}`,
          { method: 'DELETE', signal: timeout }
        );
        if (!removed.ok && removed.status !== 404) return removed;
      } else if (current.status !== 404) {
        return current;
      }

      const created = await createEvolutionInstance(
        baseUrl,
        apiKey,
        instance,
        accountId,
        timeout,
        pairingNumber,
        options.channelKey
      );
      if (!created.ok) return created;
      let payload = (await created.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      let pairingCode = extractPairingCode(payload);
      for (let attempt = 0; !pairingCode && attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const connection = await evolutionRequest(
          baseUrl,
          apiKey,
          `instance/connect/${instance}`,
          { signal: timeout }
        );
        if (!connection.ok) continue;
        payload = (await connection.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        pairingCode = extractPairingCode(payload);
      }
      if (!pairingCode)
        return jsonResponse(
          {
            error:
              'A Evolution não retornou o código. Tente novamente ou use o QR Code.',
          },
          502
        );
      return jsonResponse({
        status: 'awaiting_qr_scan',
        pairing_code: pairingCode,
      });
    }
    const created = await createEvolutionInstance(
      baseUrl,
      apiKey,
      instance,
      accountId,
      timeout,
      undefined,
      options.channelKey
    );
    if (created.ok) return created;
    if (created.status === 401 || created.status === 403) return created;
    return evolutionRequest(baseUrl, apiKey, `instance/connect/${instance}`, {
      method: 'GET',
      signal: timeout,
    });
  }

  if (suffix === 'qr.svg') {
    const response = await evolutionRequest(
      baseUrl,
      apiKey,
      `instance/connect/${instance}`,
      { method: 'GET', signal: timeout }
    );
    if (!response.ok) return response;
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const encoded = typeof payload?.base64 === 'string' ? payload.base64 : '';
    const match = encoded.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    const rawBase64 = match?.[2] ?? encoded;
    if (!rawBase64) return new Response(null, { status: 404 });
    const mimeType = match?.[1] ?? 'image/png';
    return new Response(Buffer.from(rawBase64, 'base64'), {
      status: 200,
      headers: {
        'content-type': mimeType,
        'cache-control': 'no-store, max-age=0',
      },
    });
  }

  if (suffix === 'import')
    return jsonResponse({ error: 'history_import_disabled' }, 410);

  if (suffix === '') {
    const logout = await evolutionRequest(
      baseUrl,
      apiKey,
      `instance/logout/${instance}`,
      { method: 'DELETE', signal: timeout }
    );
    if (!logout.ok && logout.status !== 404) return logout;
    const deleted = await evolutionRequest(
      baseUrl,
      apiKey,
      `instance/delete/${instance}`,
      { method: 'DELETE', signal: timeout }
    );
    if (!deleted.ok && deleted.status !== 404) return deleted;
    return jsonResponse({ deleted: true });
  }

  if (suffix === 'groups')
    return fetchEvolutionGroups(baseUrl, apiKey, instance, timeout);

  if (suffix === 'groups/participants') {
    const body = parseJsonBody(init.body);
    const groupId = typeof body?.group_id === 'string' ? body.group_id : '';
    if (!/^[^\s@]{1,80}@g\.us$/.test(groupId))
      return jsonResponse({ error: 'invalid_group_id' }, 400);
    const response = await evolutionRequest(
      baseUrl,
      apiKey,
      `group/participants/${instance}?groupJid=${encodeURIComponent(groupId)}`,
      { signal: timeout }
    );
    if (!response.ok) return response;
    const payload = (await response.json().catch(() => null)) as unknown;
    const rawParticipants = extractArray(payload, ['participants', 'data']);
    const ownerJid = await getEvolutionOwnerJid(
      baseUrl,
      apiKey,
      instance,
      timeout
    );
    const participants = rawParticipants.map((row) =>
      normalizeEvolutionParticipant(row, ownerJid)
    );
    const subject = await getEvolutionGroupSubject(
      baseUrl,
      apiKey,
      instance,
      groupId,
      timeout
    );
    if (
      !ownerJid ||
      !participants.some(
        (participant) =>
          participant.is_admin && sameJid(participant.jid, ownerJid)
      )
    ) {
      return jsonResponse({ error: 'group_admin_required' }, 403);
    }
    return jsonResponse({ subject, participants });
  }

  if (suffix === 'messages/send') {
    const body = parseJsonBody(init.body);
    const phone =
      typeof body?.phone === 'string' ? body.phone.replace(/\D/g, '') : '';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!/^\d{8,15}$/.test(phone) || !text || text.length > 4096)
      return jsonResponse({ error: 'invalid_message' }, 400);
    const response = await evolutionRequest(
      baseUrl,
      apiKey,
      `message/sendText/${instance}`,
      {
        method: 'POST',
        body: JSON.stringify({ number: phone, text }),
        signal: timeout,
      }
    );
    if (!response.ok) return response;
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const key = asRecord(payload?.key);
    const data = asRecord(payload?.data);
    const messageKey = asRecord(data?.key);
    const messageId = [key?.id, messageKey?.id, payload?.messageId].find(
      (value) => typeof value === 'string'
    );
    return typeof messageId === 'string'
      ? jsonResponse({ messageId })
      : jsonResponse({ error: 'message_id_missing' }, 502);
  }

  if (suffix === 'messages/media') {
    const body = parseJsonBody(init.body);
    const phone = typeof body?.phone === 'string' ? body.phone.replace(/\D/g, '') : '';
    const kind = typeof body?.kind === 'string' ? body.kind : '';
    const url = typeof body?.url === 'string' ? body.url : '';
    const caption = typeof body?.caption === 'string' ? body.caption : '';
    if (!/^\d{8,15}$/.test(phone) || !['image', 'video', 'audio', 'document'].includes(kind) || !url)
      return jsonResponse({ error: 'invalid_media' }, 400);
    const response = await evolutionRequest(baseUrl, apiKey, `message/sendMedia/${instance}`, {
      method: 'POST',
      body: JSON.stringify({ number: phone, mediatype: kind, media: url, caption }),
      signal: timeout,
    });
    if (!response.ok) return response;
    const payload = asRecord(await response.json().catch(() => null));
    const key = asRecord(payload?.key);
    const data = asRecord(payload?.data);
    const messageKey = asRecord(data?.key);
    const messageId = [key?.id, messageKey?.id, payload?.messageId].find((value) => typeof value === 'string');
    return typeof messageId === 'string' ? jsonResponse({ messageId }) : jsonResponse({ error: 'message_id_missing' }, 502);
  }

  if (suffix === 'messages/read') {
    const body = parseJsonBody(init.body);
    const phone = typeof body?.phone === 'string' ? body.phone.replace(/\D/g, '') : '';
    const messageId = typeof body?.messageId === 'string' ? body.messageId : '';
    if (!/^\d{8,15}$/.test(phone) || !messageId || messageId.length > 200)
      return jsonResponse({ error: 'invalid_read_receipt' }, 400);
    return evolutionRequest(baseUrl, apiKey, `chat/markMessageAsRead/${instance}`, {
      method: 'POST',
      body: JSON.stringify({ readMessages: [{ remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: messageId }] }),
      signal: timeout,
    });
  }

  if (suffix === 'groups/send') {
    return sendEvolutionGroupMessages(
      baseUrl,
      apiKey,
      instance,
      accountId,
      init,
      timeout
    );
  }

  return jsonResponse({ error: 'unsupported_operation' }, 404);
}

function extractPairingCode(payload: Record<string, unknown> | null): string {
  const qr = asRecord(payload?.qrcode);
  return (
    (typeof qr?.pairingCode === 'string' && qr.pairingCode) ||
    (typeof payload?.pairingCode === 'string' && payload.pairingCode) ||
    ''
  );
}

async function createEvolutionInstance(
  baseUrl: URL,
  apiKey: string,
  instance: string,
  accountId: string,
  signal: AbortSignal,
  pairingNumber?: string,
  channelKey?: string
): Promise<Response> {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    'https://organizap.tpxdigital.com';
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!webhookSecret)
    throw new QrConnectorConfigurationError(
      'Evolution webhook secret is not configured'
    );
  const webhook = new URL('/api/internal/evolution-webhook', siteUrl);
  webhook.searchParams.set('account_id', accountId);
  if (channelKey) webhook.searchParams.set('channel_key', channelKey);

  return evolutionRequest(baseUrl, apiKey, 'instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName: instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      ...(pairingNumber ? { number: pairingNumber } : {}),
      webhook: {
        enabled: true,
        url: webhook.toString(),
        headers: { 'x-evolution-webhook-secret': webhookSecret },
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
      },
      rejectCall: true,
      groupsIgnore: false,
      readMessages: false,
    }),
    signal,
  });
}

async function fetchEvolutionGroups(
  baseUrl: URL,
  apiKey: string,
  instance: string,
  signal: AbortSignal
): Promise<Response> {
  const groupsResponse = await evolutionRequest(
    baseUrl,
    apiKey,
    `group/fetchAllGroups/${instance}?getParticipants=true`,
    { signal }
  );
  if (!groupsResponse.ok) return groupsResponse;
  const groupsPayload = (await groupsResponse
    .json()
    .catch(() => null)) as unknown;
  const groups = extractArray(groupsPayload, ['groups', 'data']);
  const ownerJid = await getEvolutionOwnerJid(
    baseUrl,
    apiKey,
    instance,
    signal
  );
  const normalized = groups
    .map((row) => {
      const group = asRecord(row);
      const participants = Array.isArray(group?.participants)
        ? group.participants
        : [];
      const ownParticipant = participants
        .map((participant) =>
          normalizeEvolutionParticipant(participant, ownerJid)
        )
        .find((participant) => sameJid(participant.jid, ownerJid));
      return {
        id: typeof group?.id === 'string' ? group.id : '',
        subject:
          typeof group?.subject === 'string' && group.subject.trim()
            ? group.subject.trim()
            : 'Grupo sem nome',
        participant_count:
          typeof group?.size === 'number' ? group.size : participants.length,
        is_admin: ownParticipant?.is_admin === true,
      };
    })
    .filter((group) => group.id.endsWith('@g.us'));
  return jsonResponse({
    groups: normalized,
    admin_detection_version: 2,
    member_tools_version: 1,
  });
}

async function sendEvolutionGroupMessages(
  baseUrl: URL,
  apiKey: string,
  instance: string,
  accountId: string,
  init: RequestInit,
  signal: AbortSignal
): Promise<Response> {
  const body = parseJsonBody(init.body);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const kind = typeof body?.kind === 'string' ? body.kind : 'text';
  const mediaUrl = typeof body?.media_url === 'string' ? body.media_url : '';
  const mediaName =
    typeof body?.media_name === 'string'
      ? body.media_name.slice(0, 255)
      : 'Arquivo';
  const pollOptions = Array.isArray(body?.poll_options)
    ? body.poll_options.filter(
        (value): value is string =>
          typeof value === 'string' && Boolean(value.trim())
      )
    : [];
  const mentionAll = text.includes('{{todos}}');
  const groupIds = Array.isArray(body?.group_ids)
    ? [
        ...new Set(
          body.group_ids.filter(
            (value): value is string => typeof value === 'string'
          )
        ),
      ]
    : [];
  if (
    !['text', 'image', 'video', 'audio', 'document', 'poll'].includes(kind) ||
    (!text && (kind === 'text' || kind === 'poll')) ||
    text.length > 4096 ||
    (kind === 'poll' && (pollOptions.length < 2 || pollOptions.length > 12)) ||
    (['image', 'video', 'audio', 'document'].includes(kind) &&
      !validEvolutionGroupMediaUrl(mediaUrl, accountId)) ||
    groupIds.length === 0 ||
    groupIds.length > 30 ||
    (mentionAll &&
      (!['text', 'image', 'video'].includes(kind) ||
        !text.replaceAll('{{todos}}', '').trim() ||
        text.split('{{todos}}').length !== 2))
  ) {
    return jsonResponse({ error: 'invalid_group_send_payload' }, 400);
  }

  const groupsResponse = await evolutionRequest(
    baseUrl,
    apiKey,
    `group/fetchAllGroups/${instance}`,
    { signal }
  );
  if (!groupsResponse.ok) return groupsResponse;
  const groupsPayload = (await groupsResponse
    .json()
    .catch(() => null)) as unknown;
  const groups = new Set(
    extractArray(groupsPayload, ['groups', 'data'])
      .map((row) => asRecord(row)?.id)
      .filter((id): id is string => typeof id === 'string')
  );
  const ownerJid = await getEvolutionOwnerJid(
    baseUrl,
    apiKey,
    instance,
    signal
  );
  const results: Array<{
    group_id: string;
    status: 'sent' | 'failed';
    message_id?: string | null;
    error?: string;
  }> = [];

  for (const [index, groupId] of groupIds.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1250));
    if (!/^[^\s@]{1,80}@g\.us$/.test(groupId) || !groups.has(groupId)) {
      results.push({
        group_id: groupId,
        status: 'failed',
        error: 'group_not_available',
      });
      continue;
    }
    const personalText = renderEvolutionGroupText(
      mentionAll ? text.replace('{{todos}}', '@todos') : text,
      await getEvolutionGroupSubject(baseUrl, apiKey, instance, groupId, signal)
    );
    if (mentionAll) {
      const participantsResponse = await evolutionRequest(
        baseUrl,
        apiKey,
        `group/participants/${instance}?groupJid=${encodeURIComponent(groupId)}`,
        { signal }
      );
      const participantsPayload = participantsResponse.ok
        ? ((await participantsResponse.json().catch(() => null)) as unknown)
        : null;
      const participants = extractArray(participantsPayload, [
        'participants',
        'data',
      ]).map((row) => normalizeEvolutionParticipant(row, ownerJid));
      if (
        !ownerJid ||
        !participants.some(
          (participant) =>
            participant.is_admin && sameJid(participant.jid, ownerJid)
        )
      ) {
        results.push({
          group_id: groupId,
          status: 'failed',
          error: 'group_admin_required',
        });
        continue;
      }
    }

    try {
      let endpoint = `message/sendText/${instance}`;
      let payload: Record<string, unknown>;
      if (kind === 'poll') {
        endpoint = `message/sendPoll/${instance}`;
        payload = {
          number: groupId,
          name: personalText,
          selectableCount: 1,
          values: pollOptions,
        };
      } else if (['image', 'video', 'audio', 'document'].includes(kind)) {
        endpoint = `message/sendMedia/${instance}`;
        payload = {
          number: groupId,
          mediatype: kind,
          media: mediaUrl,
          fileName: mediaName,
          caption: personalText,
        };
      } else {
        payload = {
          number: groupId,
          text: personalText,
          ...(mentionAll ? { mentionsEveryOne: true } : {}),
        };
      }
      const response = await evolutionRequest(baseUrl, apiKey, endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
        signal,
      });
      const sent = response.ok
        ? ((await response.json().catch(() => null)) as Record<
            string,
            unknown
          > | null)
        : null;
      const key = asRecord(sent?.key);
      const data = asRecord(sent?.data);
      const nestedKey = asRecord(data?.key);
      const messageId = [key?.id, nestedKey?.id].find(
        (value) => typeof value === 'string'
      );
      results.push(
        response.ok
          ? {
              group_id: groupId,
              status: 'sent',
              message_id: typeof messageId === 'string' ? messageId : null,
            }
          : {
              group_id: groupId,
              status: 'failed',
              error: `evolution_http_${response.status}`,
            }
      );
    } catch {
      results.push({
        group_id: groupId,
        status: 'failed',
        error: 'evolution_request_failed',
      });
    }
  }
  return jsonResponse({ results });
}

async function getEvolutionOwnerJid(
  baseUrl: URL,
  apiKey: string,
  instance: string,
  signal: AbortSignal
): Promise<string | null> {
  const response = await evolutionRequest(
    baseUrl,
    apiKey,
    `instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
    { signal }
  );
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as unknown;
  const rows = extractArray(payload, ['instances', 'data']);
  for (const row of rows) {
    const record = asRecord(row);
    const nested = asRecord(record?.instance);
    if (
      [record?.name, record?.instanceName, nested?.instanceName].includes(
        instance
      )
    ) {
      const owner =
        record?.ownerJid ?? record?.wuid ?? nested?.ownerJid ?? nested?.wuid;
      if (typeof owner === 'string') return owner;
    }
  }
  return null;
}

async function getEvolutionGroupSubject(
  baseUrl: URL,
  apiKey: string,
  instance: string,
  groupId: string,
  signal: AbortSignal
): Promise<string> {
  const response = await evolutionRequest(
    baseUrl,
    apiKey,
    `group/findGroupInfoByJid/${instance}?groupJid=${encodeURIComponent(groupId)}`,
    { signal }
  );
  if (!response.ok) return 'grupo';
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return typeof payload?.subject === 'string' && payload.subject.trim()
    ? payload.subject.trim()
    : 'grupo';
}

function normalizeEvolutionParticipant(
  value: unknown,
  ownerJid: string | null
) {
  const row = asRecord(value);
  const jid =
    typeof row?.id === 'string'
      ? row.id
      : typeof row?.jid === 'string'
        ? row.jid
        : '';
  const digits = jid.split('@')[0].replace(/\D/g, '');
  const admin =
    row?.admin === 'admin' ||
    row?.admin === 'superadmin' ||
    row?.isAdmin === true ||
    row?.isSuperAdmin === true;
  return {
    name:
      ([row?.name, row?.notify, row?.verifiedName].find(
        (candidate) => typeof candidate === 'string' && candidate.trim()
      ) as string | undefined) ?? '',
    phone: digits ? `+${digits}` : '',
    jid,
    is_admin: admin || Boolean(ownerJid && sameJid(jid, ownerJid)),
  };
}

function renderEvolutionGroupText(template: string, subject: string): string {
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());
  return template.replaceAll('{{grupo}}', subject).replaceAll('{{data}}', date);
}

function validEvolutionGroupMediaUrl(
  value: string,
  accountId: string
): boolean {
  try {
    const url = new URL(value);
    const storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
      .origin;
    return (
      url.protocol === 'https:' &&
      url.origin === storageOrigin &&
      url.pathname.startsWith(
        `/storage/v1/object/public/chat-media/account-${accountId}/group-broadcast/`
      )
    );
  } catch {
    return false;
  }
}

function evolutionConfiguration(): { baseUrl: URL; apiKey: string } {
  const rawUrl = process.env.EVOLUTION_API_URL?.trim();
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!rawUrl || !apiKey)
    throw new QrConnectorConfigurationError('Evolution API is not configured');
  const baseUrl = new URL(rawUrl);
  if (
    baseUrl.protocol !== 'https:' &&
    baseUrl.hostname !== 'localhost' &&
    baseUrl.hostname !== '127.0.0.1'
  ) {
    throw new QrConnectorConfigurationError('Evolution API must use HTTPS');
  }
  return { baseUrl, apiKey };
}

function evolutionInstanceName(accountId: string): string {
  return `organizap${accountId.replaceAll('-', '').toLowerCase()}`;
}

export function getEvolutionInstanceName(accountId: string): string {
  return evolutionInstanceName(accountId);
}

async function evolutionRequest(
  baseUrl: URL,
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', apiKey);
  headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  return fetch(new URL(path, `${baseUrl.toString().replace(/\/$/, '')}/`), {
    ...init,
    headers,
    cache: 'no-store',
  });
}

function parseJsonBody(
  body: BodyInit | null | undefined
): Record<string, unknown> | null {
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractArray(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of keys)
    if (Array.isArray(record?.[key])) return record[key] as unknown[];
  return [];
}

function sameJid(left: string, right: string | null): boolean {
  if (!right) return false;
  return (
    left.split('@')[0].replace(/\D/g, '') ===
    right.split('@')[0].replace(/\D/g, '')
  );
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
