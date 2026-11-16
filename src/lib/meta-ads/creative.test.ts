import { describe, expect, it } from 'vitest';
import { creativePreview, metaAdPreviewUrl, metaMediaUrl } from './creative';

describe('prévia de criativos Meta', () => {
  it('identifica uma imagem e rejeita endereços fora da Meta', () => {
    expect(creativePreview({ image_url: 'https://scontent.fbcdn.net/image.jpg' })).toEqual({ imageUrl: 'https://scontent.fbcdn.net/image.jpg', videoId: null, isVideo: false });
    expect(metaMediaUrl('https://fbcdn.net.evil.example/image.jpg')).toBeNull();
    expect(metaMediaUrl('http://scontent.fbcdn.net/image.jpg')).toBeNull();
  });
  it('identifica vídeo no anúncio ou nos ativos dinâmicos', () => {
    expect(creativePreview({ object_story_spec: { video_data: { video_id: '123456', image_url: 'https://scontent.fbcdn.net/video.jpg' } } })).toEqual({ imageUrl: 'https://scontent.fbcdn.net/video.jpg', videoId: '123456', isVideo: true });
    expect(creativePreview({ asset_feed_spec: { videos: [{ video_id: '234567' }] } })).toMatchObject({ videoId: '234567', isVideo: true });
    expect(creativePreview({ object_story_spec: { video_data: { video_id: '../../other' } } }).videoId).toBeNull();
  });
  it('aceita apenas iframe de prévia da Meta sem token na URL', () => {
    expect(metaAdPreviewUrl('<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=abc&amp;x=1"></iframe>')).toBe('https://www.facebook.com/ads/api/preview_iframe.php?d=abc&x=1');
    expect(metaAdPreviewUrl('<iframe src="https://evil.example/ads/api/preview_iframe.php"></iframe>')).toBeNull();
    expect(metaAdPreviewUrl('<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?access_token=secret"></iframe>')).toBeNull();
  });
});
