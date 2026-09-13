/**
 * Normalisation for Meta's Click-to-WhatsApp (CTWA) referral envelope.
 *
 * Meta adds `messages[].referral` to the first customer message that was
 * opened from a Click-to-WhatsApp ad.  Keep this deliberately narrow: the
 * webhook body is external input, while these are the documented referral
 * properties that are useful for later campaign enrichment.
 */
export interface MetaCtwaReferral {
  sourceUrl: string | null;
  sourceType: string | null;
  sourceId: string | null;
  ctwaClid: string | null;
  headline: string | null;
  body: string | null;
  mediaType: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  /** A safe, typed copy of the accepted Meta fields for forward-compatible reporting. */
  metadata: Record<string, string>;
}

const FIELD_LIMITS: Record<string, number> = {
  source_url: 4_000,
  source_type: 100,
  source_id: 255,
  ctwa_clid: 512,
  headline: 1_000,
  body: 4_000,
  media_type: 100,
  image_url: 4_000,
  video_url: 4_000,
  thumbnail_url: 4_000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(referral: Record<string, unknown>, key: string): string | null {
  const value = referral[key];
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, FIELD_LIMITS[key]);
}

/**
 * Returns null unless the inbound payload actually contains one of Meta's
 * known CTWA fields.  This avoids creating attribution rows for ordinary
 * WhatsApp conversations or arbitrary unknown webhook properties.
 */
export function normalizeMetaCtwaReferral(
  value: unknown
): MetaCtwaReferral | null {
  if (!isRecord(value)) return null;

  const accepted = Object.fromEntries(
    Object.keys(FIELD_LIMITS)
      .map((key) => [key, field(value, key)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null)
  );

  if (Object.keys(accepted).length === 0) return null;

  return {
    sourceUrl: accepted.source_url ?? null,
    sourceType: accepted.source_type ?? null,
    sourceId: accepted.source_id ?? null,
    ctwaClid: accepted.ctwa_clid ?? null,
    headline: accepted.headline ?? null,
    body: accepted.body ?? null,
    mediaType: accepted.media_type ?? null,
    imageUrl: accepted.image_url ?? null,
    videoUrl: accepted.video_url ?? null,
    thumbnailUrl: accepted.thumbnail_url ?? null,
    metadata: accepted,
  };
}
