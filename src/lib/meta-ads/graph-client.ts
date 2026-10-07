import 'server-only';

export type MetaGraphFetch = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

const META_ID = /^\d{5,32}$/;
const API_VERSION = /^v\d+\.\d+$/;

export interface MetaGraphClientOptions {
  accessToken: string;
  version: string;
  fetchFn?: MetaGraphFetch;
}

/** Dormant adapter: callers must supply an approved token and explicitly invoke it. */
export class MetaGraphReadClient {
  private readonly base: string;
  private readonly token: string;
  private readonly transport: MetaGraphFetch;

  constructor(options: MetaGraphClientOptions) {
    if (!options.accessToken.trim() || !API_VERSION.test(options.version))
      throw new Error('Meta Graph configuration is incomplete');
    this.base = `https://graph.facebook.com/${options.version}/`;
    this.token = options.accessToken.trim();
    this.transport = options.fetchFn ?? fetch;
  }

  async list(
    path: string,
    params: Record<string, string>,
    maxPages = 20
  ): Promise<Record<string, unknown>[]> {
    if (!/^[\w/]+$/.test(path) || path.includes('..'))
      throw new Error('Invalid Meta Graph path');
    const url = new URL(path, this.base);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    const rows: Record<string, unknown>[] = [];
    let next: string | null = url.toString();
    for (let page = 0; next && page < maxPages; page++) {
      const current: URL = new URL(next);
      if (
        current.origin !== 'https://graph.facebook.com' ||
        !current.pathname.startsWith(new URL(this.base).pathname)
      ) {
        throw new Error('Unexpected Meta Graph pagination URL');
      }
      // Graph sometimes embeds access_token in paging.next. Never forward it
      // via the URL; the header is the only authorized credential channel.
      current.searchParams.delete('access_token');
      const response = await this.transport(current.toString(), {
        headers: { Authorization: `Bearer ${this.token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok)
        throw new Error(`Meta Graph returned ${response.status}`);
      const body = (await response.json()) as {
        data?: unknown;
        paging?: { next?: unknown };
      };
      if (!Array.isArray(body.data))
        throw new Error('Invalid Meta Graph list response');
      rows.push(
        ...body.data.filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null && !Array.isArray(item)
        )
      );
      next = typeof body.paging?.next === 'string' ? body.paging.next : null;
      if (next && page === maxPages - 1)
        throw new Error(
          'Meta Graph pagination exceeded the configured batch limit'
        );
    }
    return rows;
  }

  adInsights(adAccountId: string, from: string, to: string) {
    if (!META_ID.test(adAccountId)) throw new Error('Invalid Meta ad account');
    return this.list(`act_${adAccountId}/insights`, {
      level: 'ad',
      time_increment: '1',
      limit: '500',
      time_range: JSON.stringify({ since: from, until: to }),
      fields:
        'date_start,account_id,account_currency,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions',
    });
  }

  adEntities(adAccountId: string, type: 'campaigns' | 'adsets' | 'ads') {
    if (!META_ID.test(adAccountId)) throw new Error('Invalid Meta ad account');
    const fields =
      type === 'campaigns'
        ? 'id,name,effective_status,objective'
        : type === 'adsets'
          ? 'id,name,campaign_id,effective_status'
          : 'id,name,adset_id,campaign_id,effective_status';
    return this.list(`act_${adAccountId}/${type}`, { fields, limit: '500' });
  }

  leadForms(pageId: string) {
    if (!META_ID.test(pageId)) throw new Error('Invalid Meta Page');
    return this.list(`${pageId}/leadgen_forms`, {
      fields: 'id,name,status',
      limit: '100',
    });
  }

  formLeads(formId: string) {
    if (!META_ID.test(formId)) throw new Error('Invalid Meta lead form');
    return this.list(`${formId}/leads`, {
      fields: 'id,created_time,ad_id,form_id,field_data',
      limit: '100',
    });
  }
}

