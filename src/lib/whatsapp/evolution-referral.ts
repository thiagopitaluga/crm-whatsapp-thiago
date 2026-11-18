import { normalizeMetaCtwaReferral, type MetaCtwaReferral } from './ctwa-referral';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Extract only the incoming message's advertising context, never quoted messages. */
export function normalizeEvolutionReferral(message: unknown): MetaCtwaReferral | null {
  const envelope = record(message);
  let content = record(envelope?.message);
  for (let depth = 0; depth < 5 && content; depth++) {
    const wrapped = record(content.ephemeralMessage) ?? record(content.viewOnceMessage) ?? record(content.viewOnceMessageV2) ?? record(content.viewOnceMessageV2Extension) ?? record(content.documentWithCaptionMessage);
    const nested = record(wrapped?.message);
    if (!nested) break;
    content = nested;
  }
  const candidates = [record(envelope?.referral), record(content?.referral)];
  for (const type of ['extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'buttonsResponseMessage', 'interactiveResponseMessage']) {
    const context = record(record(content?.[type])?.contextInfo);
    candidates.push(record(context?.externalAdReply));
  }
  candidates.push(record(record(content?.messageContextInfo)?.externalAdReply));
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate) continue;
    const referral = normalizeMetaCtwaReferral({
      source_id: candidate.source_id ?? candidate.sourceId,
      source_type: candidate.source_type ?? candidate.sourceType,
      source_url: candidate.source_url ?? candidate.sourceUrl,
      ctwa_clid: candidate.ctwa_clid ?? candidate.ctwaClid,
      headline: candidate.headline ?? candidate.title,
      body: candidate.body,
      media_type: candidate.media_type ?? (candidate.mediaType === 2 || candidate.mediaType === 'VIDEO' ? 'video' : candidate.mediaType === 1 || candidate.mediaType === 'IMAGE' ? 'image' : candidate.mediaType),
      image_url: candidate.image_url ?? candidate.originalImageUrl,
      video_url: candidate.video_url ?? (candidate.mediaType === 2 || candidate.mediaType === 'VIDEO' ? candidate.mediaUrl : null),
      thumbnail_url: candidate.thumbnail_url ?? candidate.thumbnailUrl,
    });
    // A generic external link preview is not enough to attribute an ad.
    if (referral && (referral.ctwaClid || (referral.sourceId && (index < 2 || referral.sourceType?.toLowerCase() === 'ad' || candidate.showAdAttribution === true)))) return referral;
  }
  return null;
}
