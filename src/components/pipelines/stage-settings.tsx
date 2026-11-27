'use client';
import { useState } from 'react';
import { Settings2, Plus, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import {
  AI_CONDITIONS,
  META_EVENTS,
  defaultStageSettings,
  validateStageSettings,
  type StageSettings,
  type StageRule,
} from '@/lib/pipelines/stage-settings';
import type { PipelineStage, Tag } from '@/types';
import Link from 'next/link';

const field = 'w-full rounded-md border bg-background p-2 text-sm';
export function StageSettingsButton({
  stage,
  tags,
}: {
  stage: PipelineStage;
  tags: Tag[];
}) {
  const { canEditSettings: editable } = useAuth();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<StageSettings>(defaultStageSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [jobs, setJobs] = useState<
    Array<{ id: string; kind: string; status: string; error: string | null }>
  >([]);
  const [choices, setChoices] = useState<{
    stages: Array<{ id: string; name: string }>;
    pipelines: Array<{ id: string; name: string }>;
    users: Array<{
      user_id: string;
      full_name: string | null;
      email: string | null;
    }>;
  }>({ stages: [], pipelines: [], users: [] });
  async function show() {
    setOpen(true);
    setLoading(true);
    setLoaded(false);
    setError('');
    try {
      const response = await fetch(
        `/api/pipelines/stages/${stage.id}/settings`
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || 'Não foi possível carregar.');
      setSettings(body.settings);
      setJobs(body.jobs ?? []);
      setChoices(body.choices ?? { stages: [], pipelines: [], users: [] });
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }
  async function save() {
    const issue = validateStageSettings(settings);
    if (issue) {
      setError(issue);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(
        `/api/pipelines/stages/${stage.id}/settings`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Falha ao salvar.');
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }
  function addRule(kind: 'welcome' | 'followup' | 'tag' | 'custom') {
    const rule: StageRule = {
      id: crypto.randomUUID(),
      enabled: true,
      name:
        kind === 'welcome'
          ? 'Boas-vindas'
          : kind === 'followup'
            ? 'Retomar após 24h'
            : kind === 'tag'
              ? 'Marcar ao entrar'
              : 'Novo gatilho',
      event: kind === 'followup' ? 'no_reply' : 'entered',
      hours: 24,
      condition: '',
      target: '',
      action: kind === 'tag' ? 'add_tag' : 'message',
      value:
        kind === 'welcome'
          ? 'Olá, {contact.name}! Como podemos ajudar?'
          : kind === 'followup'
            ? 'Olá, {contact.name}! Você ainda tem interesse?'
            : '',
    };
    setSettings((s) => ({ ...s, rules: [...s.rules, rule] }));
  }
  function updateRule(id: string, patch: Partial<StageRule>) {
    setSettings((s) => ({
      ...s,
      rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        title={`Configurar etapa ${stage.name}`}
        aria-label={`Configurar etapa ${stage.name}`}
        onClick={() => void show()}
      >
        <Settings2 className="h-4 w-4" />
      </Button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!saving) setOpen(next);
        }}
      >
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Configurações da etapa</SheetTitle>
            <SheetDescription>{stage.name}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            {loading && <p role="status">Carregando configurações…</p>}
            {error && (
              <p role="alert" className="text-destructive mb-4">
                {error}
              </p>
            )}
            {!loading && loaded && (
              <fieldset
                disabled={!editable || saving}
                className="space-y-6 pb-6 disabled:opacity-70"
              >
                {!editable && (
                  <p>
                    Somente administradores podem alterar estas configurações.
                  </p>
                )}
                <section className="space-y-3">
                  <label className="flex gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={settings.ai.enabled}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          ai: { ...s.ai, enabled: e.target.checked },
                        }))
                      }
                    />
                    Deixar a IA mover leads para esta etapa
                  </label>
                  <p className="text-muted-foreground text-xs">
                    A IA avalia as mensagens recebidas quando o agendador
                    processa a fila. Quando mais de uma condição for atendida,
                    prevalece a primeira etapa na ordem do funil. Exige provedor
                    de IA ativo; conversas pausadas ou assumidas por uma pessoa
                    são preservadas. A condição sem resposta avança somente para
                    etapas posteriores.
                  </p>
                  {settings.ai.enabled && (
                    <>
                      <label className="block">
                        Condição
                        <select
                          className={field}
                          value={settings.ai.condition}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              ai: {
                                ...s.ai,
                                condition: e.target
                                  .value as StageSettings['ai']['condition'],
                              },
                            }))
                          }
                        >
                          {Object.entries(AI_CONDITIONS).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {settings.ai.condition === 'silent' && (
                        <label className="block">
                          Dias sem resposta
                          <input
                            className={field}
                            type="number"
                            min={1}
                            max={365}
                            value={settings.ai.days}
                            onChange={(e) =>
                              setSettings((s) => ({
                                ...s,
                                ai: { ...s.ai, days: Number(e.target.value) },
                              }))
                            }
                          />
                        </label>
                      )}
                      <label className="block">
                        {settings.ai.condition === 'custom'
                          ? 'Instrução para a IA'
                          : 'Orientações adicionais (opcional)'}
                        <textarea
                          className={field}
                          rows={3}
                          maxLength={4000}
                          value={settings.ai.instruction}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              ai: { ...s.ai, instruction: e.target.value },
                            }))
                          }
                        />
                      </label>
                    </>
                  )}
                </section>
                <section className="space-y-3 border-t pt-4">
                  <h3 className="font-semibold">
                    Gatilhos desta etapa · {settings.rules.length}
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    Funcionam independentemente da movimentação por IA.
                    Retomadas são canceladas quando o lead responde ou sai da
                    etapa.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(['welcome', 'followup', 'tag'] as const).map(
                      (kind, i) => (
                        <Button
                          key={kind}
                          variant="outline"
                          size="sm"
                          onClick={() => addRule(kind)}
                        >
                          {
                            [
                              'Boas-vindas',
                              'Retomar após 24h',
                              'Marcar ao entrar',
                            ][i]
                          }
                        </Button>
                      )
                    )}
                  </div>
                  {settings.rules.map((r) => (
                    <div key={r.id} className="space-y-2 rounded-lg border p-3">
                      <div className="flex gap-2">
                        <input
                          aria-label={`Ativar ${r.name}`}
                          type="checkbox"
                          checked={r.enabled}
                          onChange={(e) =>
                            updateRule(r.id, { enabled: e.target.checked })
                          }
                        />
                        <input
                          aria-label="Nome do gatilho"
                          className={field}
                          value={r.name}
                          onChange={(e) =>
                            updateRule(r.id, { name: e.target.value })
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remover ${r.name}`}
                          onClick={() =>
                            setSettings((s) => ({
                              ...s,
                              rules: s.rules.filter((v) => v.id !== r.id),
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <label className="block">
                        Quando
                        <select
                          className={field}
                          value={r.event}
                          onChange={(e) =>
                            updateRule(r.id, {
                              event: e.target.value as StageRule['event'],
                            })
                          }
                        >
                          <option value="entered">
                            Quando o lead entra nesta etapa
                          </option>
                          <option value="no_reply">
                            Quando o lead fica sem responder
                          </option>
                          <option value="keyword">
                            Quando o lead manda palavra-chave
                          </option>
                          <option value="tag_added">
                            Quando uma tag é adicionada
                          </option>
                          <option value="ai_check">
                            Avaliação livre (IA verifica)
                          </option>
                          <option value="inactive">
                            Quando o lead fica parado X dias
                          </option>
                        </select>
                      </label>
                      {(r.event === 'no_reply' || r.event === 'inactive') && (
                        <label className="block">
                          Esperar ({r.event === 'inactive' ? 'dias' : 'horas'})
                          <input
                            className={field}
                            type="number"
                            min={1}
                            max={8760}
                            value={r.hours}
                            onChange={(e) =>
                              updateRule(r.id, {
                                hours: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      )}
                      {['keyword', 'tag_added', 'ai_check'].includes(
                        r.event
                      ) && (
                        <label className="block">
                          {r.event === 'keyword'
                            ? 'Palavra-chave'
                            : r.event === 'tag_added'
                              ? 'ID da tag'
                              : 'Instrução para a IA'}
                          {r.event === 'tag_added' ? (
                            <select
                              className={field}
                              value={r.condition ?? ''}
                              onChange={(e) =>
                                updateRule(r.id, { condition: e.target.value })
                              }
                            >
                              <option value="">Selecione a tag</option>
                              {tags.map((tag) => (
                                <option key={tag.id} value={tag.id}>
                                  {tag.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className={field}
                              value={r.condition ?? ''}
                              onChange={(e) =>
                                updateRule(r.id, { condition: e.target.value })
                              }
                            />
                          )}
                        </label>
                      )}
                      <label className="block">
                        Ação
                        <select
                          className={field}
                          value={r.action}
                          onChange={(e) =>
                            updateRule(r.id, {
                              action: e.target.value as StageRule['action'],
                              value: '',
                            })
                          }
                        >
                          <option value="message">Enviar mensagem</option>
                          <option value="add_tag">Adicionar tag</option>
                          <option value="remove_tag">Remover tag</option>
                          <option value="notify_user">Notificar usuário</option>
                          <option value="move_stage">Mover de etapa</option>
                          <option value="move_pipeline">Mudar de funil</option>
                          <option value="webhook">Disparar webhook</option>
                          <option value="ai_message">
                            IA escreve a mensagem
                          </option>
                          <option value="ai_decide">
                            IA decide o que fazer
                          </option>
                          <option value="disable_ai">
                            Desativar IA nesta etapa
                          </option>
                        </select>
                      </label>
                      {r.action === 'message' ? (
                        <>
                          <label className="block">
                            Canal de envio
                            <select
                              className={field}
                              value={r.transport ?? 'cloud'}
                              onChange={(e) =>
                                updateRule(r.id, {
                                  transport: e.target.value as 'cloud' | 'qr',
                                })
                              }
                            >
                              <option value="cloud">
                                WhatsApp Cloud API (janela de 24h)
                              </option>
                              <option value="qr">WhatsApp QR Code</option>
                            </select>
                          </label>
                          <label className="block">
                            Mensagem
                            <textarea
                              className={field}
                              rows={3}
                              value={r.value}
                              onChange={(e) =>
                                updateRule(r.id, { value: e.target.value })
                              }
                            />
                          </label>
                        </>
                      ) : ['add_tag', 'remove_tag'].includes(r.action) ? (
                        <label className="block">
                          Tag
                          <select
                            className={field}
                            value={r.value}
                            onChange={(e) =>
                              updateRule(r.id, { value: e.target.value })
                            }
                          >
                            <option value="">Selecione</option>
                            {tags.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        r.action !== 'disable_ai' && (
                          <label className="block">
                            {r.action === 'notify_user'
                              ? 'ID do usuário'
                              : r.action === 'move_stage'
                                ? 'ID da etapa'
                                : r.action === 'move_pipeline'
                                  ? 'ID do funil'
                                  : r.action === 'webhook'
                                    ? 'URL HTTPS do webhook'
                                    : 'Instrução para a IA'}
                            {[
                              'notify_user',
                              'move_stage',
                              'move_pipeline',
                            ].includes(r.action) ? (
                              <select
                                className={field}
                                value={r.value}
                                onChange={(e) =>
                                  updateRule(r.id, { value: e.target.value })
                                }
                              >
                                <option value="">Selecione</option>
                                {(r.action === 'notify_user'
                                  ? choices.users.map((v) => ({
                                      id: v.user_id,
                                      name: v.full_name || v.email || v.user_id,
                                    }))
                                  : r.action === 'move_stage'
                                    ? choices.stages
                                    : choices.pipelines
                                ).map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                className={field}
                                value={r.value}
                                onChange={(e) =>
                                  updateRule(r.id, { value: e.target.value })
                                }
                              />
                            )}
                          </label>
                        )
                      )}
                    </div>
                  ))}
                  <Button variant="ghost" onClick={() => addRule('custom')}>
                    <Plus className="mr-2 h-4 w-4" />
                    Começar do zero
                  </Button>
                </section>

                <section className="space-y-3 border-t pt-4">
                  <h3 className="font-semibold">Evento do Meta (pixel)</h3>
                  <p className="text-muted-foreground text-xs">
                    Configure o ID do pixel e o token em{' '}
                    <Link
                      className="text-primary underline"
                      href="/connections?tab=pixel"
                    >
                      Conexões → Pixel do Meta
                    </Link>
                    .
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Enviado pela API de Conversões ao entrar na etapa, com
                    telefone e e-mail protegidos por hash.
                  </p>
                  <label className="block">
                    Evento
                    <select
                      className={field}
                      value={settings.metaEvent}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          metaEvent: e.target.value,
                        }))
                      }
                    >
                      <option value="">Nenhum evento</option>
                      {META_EVENTS.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                </section>

                {editable && (
                  <section className="space-y-2 border-t pt-4">
                    <h3 className="font-semibold">Execuções recentes</h3>
                    {jobs.length === 0 ? (
                      <p className="text-muted-foreground text-xs">
                        Nenhuma execução registrada.
                      </p>
                    ) : (
                      jobs.map((job) => (
                        <div
                          key={job.id}
                          className="rounded border p-2 text-xs"
                        >
                          <span>
                            {job.kind} ·{' '}
                            {(
                              {
                                pending: 'Na fila',
                                running: 'Em execução',
                                done: 'Concluída',
                                failed: 'Falhou',
                                skipped: 'Cancelada',
                              } as Record<string, string>
                            )[job.status] ?? job.status}
                          </span>
                          {job.error && (
                            <p className="text-destructive">{job.error}</p>
                          )}
                        </div>
                      ))
                    )}
                  </section>
                )}
              </fieldset>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t p-4">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={!loaded || loading || saving || !editable}
              onClick={() => void save()}
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
