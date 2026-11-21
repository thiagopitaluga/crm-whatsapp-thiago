import type { MessageButton, SendableContent } from './automation-flow';
export class InstagramDeliveryError extends Error {
  constructor(
    message: string,
    readonly uncertain = false
  ) {
    super(message);
  }
}
export function instagramMessage(
  content: SendableContent,
  buttons: MessageButton[],
  automationId: string
) {
  const postbacks: string[] = [];
  const mapped = buttons.slice(0, 3).map((b) => {
    if (b.type === 'flow') {
      const payload = `organizap-instagram:${automationId}:${b.targetNodeId}`;
      postbacks.push(payload);
      return { type: 'postback', title: b.text.slice(0, 20), payload };
    }
    return { type: 'web_url', title: b.text.slice(0, 20), url: b.url };
  });
  if (mapped.length)
    return {
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: content.text || 'Escolha uma opção',
            buttons: mapped,
          },
        },
      },
      postbacks,
    };
  if (content.type === 'image' || content.type === 'pdf')
    return {
      message: {
        attachment: {
          type: content.type === 'image' ? 'image' : 'file',
          payload: { url: content.url, is_reusable: true },
        },
      },
      postbacks,
    };
  return { message: { text: content.text || '' }, postbacks };
}
export async function callInstagram(
  path: string,
  token: string,
  body: unknown
) {
  let response: Response;
  try {
    response = await fetch('https://graph.instagram.com/v25.0/' + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new InstagramDeliveryError(
      'A Meta não confirmou o recebimento. Revise antes de tentar novamente.',
      true
    );
  }
  const data = (await response.json().catch(() => ({}))) as {
    message_id?: string;
    recipient_id?: string;
    id?: string;
    error?: { code?: number };
  };
  if (!response.ok)
    throw new InstagramDeliveryError(
      'A Meta recusou a ação' +
        (data.error?.code ? ' (código ' + data.error.code + ')' : '') +
        '.',
      response.status >= 500
    );
  return data;
}
