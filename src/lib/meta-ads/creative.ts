export type CreativePreview = { imageUrl: string | null; isVideo: boolean; videoId: string | null };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function metaMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !['fbcdn.net', 'facebook.com', 'fbsbx.com', 'cdninstagram.com', 'instagram.com'].some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
    return url.toString();
  } catch { return null; }
}

export function creativePreview(value: unknown): CreativePreview {
  const creative = record(value);
  const story = record(creative.object_story_spec);
  const video = record(story.video_data);
  const link = record(story.link_data);
  const assets = record(creative.asset_feed_spec);
  const videos = Array.isArray(assets.videos) ? assets.videos : [];
  const images = Array.isArray(assets.images) ? assets.images : [];
  const videoAsset = record(videos[0]);
  const imageAsset = record(images[0]);
  const rawVideoId = video.video_id ?? videoAsset.video_id;
  const videoId = typeof rawVideoId === 'string' && /^\d{5,32}$/.test(rawVideoId) ? rawVideoId : null;
  const imageUrl = [creative.image_url, video.image_url, link.picture, imageAsset.url, creative.thumbnail_url]
    .map(metaMediaUrl).find(Boolean) ?? null;
  return { imageUrl, isVideo: !!videoId || videos.length > 0, videoId };
}
