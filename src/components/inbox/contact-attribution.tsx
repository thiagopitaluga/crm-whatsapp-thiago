'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MousePointerClick, Megaphone } from 'lucide-react';
interface WebsiteAttributionClick {
  id: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  gclid: string | null;
  fbclid: string | null;
  captured_at: string;
}

interface WhatsAppConversationAttribution {
  id: string;
  provider: string;
  attribution_type: string;
  source_id: string | null;
  source_type: string | null;
  source_url: string | null;
  ctwa_clid: string | null;
  headline: string | null;
  body: string | null;
  meta_ad_account_id: string | null;
  meta_campaign_id: string | null;
  meta_campaign_name: string | null;
  meta_adset_id: string | null;
  meta_adset_name: string | null;
  meta_ad_id: string | null;
  meta_ad_name: string | null;
  meta_marketing_resolved_at: string | null;
  created_at: string;
}

interface AttributionTouchpoint {
  id: string;
  provider: 'meta' | 'google_ads' | 'website' | 'direct' | 'other';
  method: string;
  source_platform: string | null;
  source_channel: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  msclkid: string | null;
  ctwa_clid: string | null;
  ad_account_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  ad_group_id: string | null;
  ad_group_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  placement: string | null;
  network: string | null;
  landing_url: string | null;
  referrer: string | null;
  confidence: string;
  occurred_at: string;
}

function MetaAttributionDetail({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;

  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
        {label}
      </p>
      <p className="text-foreground truncate text-xs" title={value}>
        {value}
      </p>
    </div>
  );
}

export function ContactAttribution({ contactId }: { contactId: string }) {
  const [websiteAttributions, setWebsiteAttributions] = useState<
    WebsiteAttributionClick[]
  >([]);
  const [whatsAppAttributions, setWhatsAppAttributions] = useState<
    WhatsAppConversationAttribution[]
  >([]);
  const [touchpoints, setTouchpoints] = useState<AttributionTouchpoint[]>([]);
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const contact = { id: contactId };
    void Promise.all([
      supabase
        .from('campaign_attribution_clicks')
        .select(
          'id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, captured_at'
        )
        .eq('resolved_contact_id', contact.id)
        .order('captured_at', { ascending: false })
        .limit(3),
      supabase
        .from('conversation_attributions')
        .select(
          'id, provider, attribution_type, source_id, source_type, source_url, ctwa_clid, headline, body, meta_ad_account_id, meta_campaign_id, meta_campaign_name, meta_adset_id, meta_adset_name, meta_ad_id, meta_ad_name, meta_marketing_resolved_at, created_at'
        )
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('attribution_touchpoints')
        .select(
          'id, provider, method, source_platform, source_channel, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, msclkid, ctwa_clid, ad_account_id, campaign_id, campaign_name, ad_group_id, ad_group_name, ad_id, ad_name, placement, network, landing_url, referrer, confidence, occurred_at'
        )
        .eq('contact_id', contact.id)
        .order('occurred_at', { ascending: false })
        .limit(5),
    ]).then(([a, b, c]) => {
      if (cancelled) return;
      setWebsiteAttributions(a.data ?? []);
      setWhatsAppAttributions(b.data ?? []);
      setTouchpoints(c.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);
  const hasAttribution = !!(
    websiteAttributions.length ||
    whatsAppAttributions.length ||
    touchpoints.length
  );
  return (
    <>
      <h4 className="text-muted-foreground text-xs font-semibold uppercase">
        Origem do contato
      </h4>
      {!hasAttribution && (
        <p className="text-muted-foreground text-xs">
          Origem ainda não identificada.
        </p>
      )}{' '}
      {hasAttribution && (
        <>
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <MousePointerClick className="h-3 w-3" />
              Origem da conversa
            </div>
            <div className="mt-2 space-y-2">
              {touchpoints.map((touchpoint) => {
                const providerLabel =
                  touchpoint.provider === 'google_ads'
                    ? 'Google Ads'
                    : touchpoint.provider === 'meta'
                      ? 'Meta Ads'
                      : touchpoint.provider === 'website'
                        ? 'Site'
                        : touchpoint.source_platform || 'Origem registrada';
                const campaign =
                  touchpoint.campaign_name || touchpoint.utm_campaign;
                const evidence =
                  touchpoint.method === 'ctwa_referral'
                    ? 'Referência recebida pelo WhatsApp'
                    : touchpoint.method === 'tracking_link'
                      ? 'Vinculado por link rastreado'
                      : touchpoint.method === 'manual' ||
                          touchpoint.confidence === 'manual'
                        ? 'Origem informada'
                        : touchpoint.confidence === 'modeled'
                          ? 'Origem estimada'
                          : 'Origem registrada';
                const hasTechnicalData = Boolean(
                  touchpoint.utm_source ||
                  touchpoint.utm_medium ||
                  touchpoint.utm_campaign ||
                  touchpoint.utm_term ||
                  touchpoint.utm_content ||
                  touchpoint.gclid ||
                  touchpoint.fbclid ||
                  touchpoint.msclkid ||
                  touchpoint.ctwa_clid ||
                  touchpoint.landing_url ||
                  touchpoint.referrer
                );
                return (
                  <div
                    key={touchpoint.id}
                    className="border-primary/20 bg-primary/5 rounded-lg border px-3 py-2.5"
                  >
                    <div className="text-foreground flex items-center gap-1.5 text-xs font-medium">
                      <Megaphone className="text-primary size-3.5" />
                      {providerLabel}
                      {touchpoint.source_channel
                        ? ` · ${touchpoint.source_channel}`
                        : ''}
                    </div>
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      {evidence}
                    </p>
                    <div className="mt-2 space-y-2">
                      <MetaAttributionDetail
                        label="Campanha"
                        value={campaign}
                      />
                      <MetaAttributionDetail
                        label={
                          touchpoint.provider === 'google_ads'
                            ? 'Grupo de anúncios'
                            : 'Conjunto de anúncios'
                        }
                        value={
                          touchpoint.ad_group_name || touchpoint.ad_group_id
                        }
                      />
                      <MetaAttributionDetail
                        label="Anúncio"
                        value={touchpoint.ad_name || touchpoint.ad_id}
                      />
                      <MetaAttributionDetail
                        label="Posicionamento"
                        value={touchpoint.placement || touchpoint.network}
                      />
                    </div>
                    {hasTechnicalData && (
                      <details className="group mt-2">
                        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-[10px]">
                          Ver parâmetros e identificadores
                        </summary>
                        <div className="mt-2 grid gap-1.5 border-l pl-2">
                          <MetaAttributionDetail
                            label="UTM source"
                            value={touchpoint.utm_source}
                          />
                          <MetaAttributionDetail
                            label="UTM medium"
                            value={touchpoint.utm_medium}
                          />
                          <MetaAttributionDetail
                            label="UTM campaign"
                            value={touchpoint.utm_campaign}
                          />
                          <MetaAttributionDetail
                            label="UTM term"
                            value={touchpoint.utm_term}
                          />
                          <MetaAttributionDetail
                            label="UTM content"
                            value={touchpoint.utm_content}
                          />
                          <MetaAttributionDetail
                            label="gclid"
                            value={touchpoint.gclid}
                          />
                          <MetaAttributionDetail
                            label="fbclid"
                            value={touchpoint.fbclid}
                          />
                          <MetaAttributionDetail
                            label="msclkid"
                            value={touchpoint.msclkid}
                          />
                          <MetaAttributionDetail
                            label="Clique do WhatsApp"
                            value={touchpoint.ctwa_clid}
                          />
                          <MetaAttributionDetail
                            label="Página de entrada"
                            value={touchpoint.landing_url}
                          />
                          <MetaAttributionDetail
                            label="Referência"
                            value={touchpoint.referrer}
                          />
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
              {touchpoints.length === 0 &&
                whatsAppAttributions.map((attribution) => (
                  <div
                    key={attribution.id}
                    className="border-primary/20 bg-primary/5 rounded-lg border px-3 py-2.5"
                  >
                    <div className="text-foreground flex items-center gap-1.5 text-xs font-medium">
                      <Megaphone className="text-primary size-3.5" />
                      Meta Ads · Clique para WhatsApp
                    </div>
                    <div className="mt-2 space-y-2">
                      <MetaAttributionDetail
                        label="Campanha"
                        value={
                          attribution.meta_campaign_name ||
                          (attribution.meta_campaign_id
                            ? `ID ${attribution.meta_campaign_id}`
                            : null)
                        }
                      />
                      <MetaAttributionDetail
                        label="Conjunto de anúncios"
                        value={
                          attribution.meta_adset_name ||
                          (attribution.meta_adset_id
                            ? `ID ${attribution.meta_adset_id}`
                            : null)
                        }
                      />
                      <MetaAttributionDetail
                        label="Anúncio"
                        value={
                          attribution.meta_ad_name ||
                          attribution.headline ||
                          (attribution.meta_ad_id
                            ? `ID ${attribution.meta_ad_id}`
                            : null)
                        }
                      />
                    </div>
                    {!attribution.meta_marketing_resolved_at && (
                      <p className="text-muted-foreground mt-2 text-[10px]">
                        Dados da campanha aguardando consulta no Meta Ads.
                      </p>
                    )}
                    {attribution.source_id && (
                      <p
                        className="text-muted-foreground mt-2 truncate text-[10px]"
                        title={attribution.source_id}
                      >
                        ID de origem: {attribution.source_id}
                      </p>
                    )}
                    {attribution.ctwa_clid && (
                      <p className="text-muted-foreground mt-1 text-[10px]">
                        Identificador do clique salvo
                      </p>
                    )}
                  </div>
                ))}
              {touchpoints.length === 0 &&
                websiteAttributions.map((attribution) => {
                  const source =
                    attribution.utm_source ||
                    (attribution.gclid
                      ? 'Google Ads'
                      : attribution.fbclid
                        ? 'Meta'
                        : 'Site');
                  return (
                    <div
                      key={attribution.id}
                      className="bg-muted rounded-lg px-3 py-2"
                    >
                      <p className="text-foreground text-xs font-medium">
                        {source}
                        {attribution.utm_medium
                          ? ` · ${attribution.utm_medium}`
                          : ''}
                      </p>
                      {attribution.utm_campaign && (
                        <p
                          className="text-muted-foreground mt-1 truncate text-xs"
                          title={attribution.utm_campaign}
                        >
                          {attribution.utm_campaign}
                        </p>
                      )}
                      {(attribution.gclid || attribution.fbclid) && (
                        <p className="text-muted-foreground mt-1 text-[10px]">
                          Identificador de clique salvo
                        </p>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
          <div className="border-border my-4 border-t" />
        </>
      )}
    </>
  );
}
