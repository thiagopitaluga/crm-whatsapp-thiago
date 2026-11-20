'use client';
import { useEffect, useState } from 'react';
import { Bell, Download, Check, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAppInstall } from '@/hooks/use-app-install';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
type Settings = {
  messages: boolean;
  allMessages: boolean;
  tasks: boolean;
  sales: boolean;
  system: boolean;
  quietPush: boolean;
  weekends: boolean;
  whatsapp: boolean;
  phone: string;
  quietStart: string;
  quietEnd: string;
};
const defaults: Settings = {
  messages: true,
  allMessages: false,
  tasks: true,
  sales: true,
  system: true,
  quietPush: false,
  weekends: true,
  whatsapp: false,
  phone: '',
  quietStart: '22:00',
  quietEnd: '08:00',
};
export function NotificationSettings() {
  const { installed, ios, prompt, requestInstall } = useAppInstall();
  const [installHelp, setInstallHelp] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [settings, setSettings] = useState(defaults),
    [key, setKey] = useState<string | null>(null),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/notifications/preferences')
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => {
        if (!cancelled) {
          setSettings({ ...defaults, ...d.settings });
          setKey(d.publicKey);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.ready
        .then((r) => r.pushManager?.getSubscription())
        .then(async (s) => {
          if (!s) return;
          const response = await fetch(
            `/api/notifications/subscribe?endpoint=${encodeURIComponent(s.endpoint)}`
          );
          if (!response.ok) throw Error('Falha ao conferir aparelho');
          const data = await response.json();
          if (!cancelled)
            setEnabled(
              data.subscribed === true && Notification.permission === 'granted'
            );
        })
        .catch(() => {
          /* Browser may block service workers in private mode. */
        });
    return () => {
      cancelled = true;
    };
  }, []);
  async function save() {
    const r = await fetch('/api/notifications/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!r.ok) throw Error((await r.json()).error || 'Falha ao salvar');
  }
  async function toggle() {
    setBusy(true);
    try {
      if (
        !('Notification' in window) ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      )
        throw Error(
          'Este navegador não oferece avisos push. No iPhone, instale na tela inicial e abra o app.'
        );
      if (!enabled && !key)
        throw Error('Avisos ainda não configurados no servidor.');
      if (!enabled && (await Notification.requestPermission()) !== 'granted')
        throw Error('Permita notificações nas configurações do navegador.');
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                Error(
                  'Não foi possível preparar os avisos. Atualize a página e tente novamente.'
                )
              ),
            10000
          )
        ),
      ]);
      if (enabled) {
        const sub = await registration.pushManager.getSubscription();
        if (sub) {
          const r = await fetch('/api/notifications/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          if (!r.ok) throw Error('Não foi possível desligar.');
          await sub.unsubscribe();
        }
        setEnabled(false);
        return;
      }
      await save();
      const binary = atob(key!.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        }));
      const r = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!r.ok) throw Error('Falha ao registrar este aparelho.');
      setEnabled(true);
      toast.success('Avisos ativados neste aparelho.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const check = (name: keyof Settings, label: string) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
      <input
        className="accent-primary mt-1 size-4"
        type="checkbox"
        checked={settings[name] === true}
        onChange={(e) =>
          setSettings((s) => ({ ...s, [name]: e.target.checked }))
        }
      />
      <span>{label}</span>
    </label>
  );
  if (loading) return <p>Carregando preferências…</p>;
  if (failed)
    return (
      <p role="alert">
        Não foi possível carregar as preferências. Atualize a página para tentar
        novamente.
      </p>
    );
  return (
    <section className="space-y-4">
      <div className="bg-card rounded-xl border p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Smartphone className="size-5" /> App no celular
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Android: menu do Chrome → Instalar app. iPhone: Safari → Compartilhar
          → Adicionar à Tela de Início. Entre com a mesma conta do Organizap.
        </p>
        <Button
          className="mt-3"
          disabled={installed || installing}
          onClick={async () => {
            if (!prompt) {
              setInstallHelp(true);
              return;
            }
            setInstalling(true);
            try {
              await requestInstall();
            } catch {
              setInstallHelp(true);
            } finally {
              setInstalling(false);
            }
          }}
        >
          {installed ? (
            <Check className="size-4" />
          ) : (
            <Download className="size-4" />
          )}
          {installed
            ? 'Aplicativo instalado'
            : installing
              ? 'Abrindo instalação…'
              : 'Instalar aplicativo'}
        </Button>
        <Dialog open={installHelp} onOpenChange={setInstallHelp}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Instalar Organizap</DialogTitle>
              <DialogDescription>
                Adicione o Organizap à tela inicial e entre com a mesma conta do
                CRM.
              </DialogDescription>
            </DialogHeader>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {ios ? (
                <>
                  <li>Abra este site no Safari do iPhone ou iPad.</li>
                  <li>
                    Toque em Compartilhar e depois em Adicionar à Tela de
                    Início.
                  </li>
                  <li>
                    Confirme em Adicionar e abra o Organizap pelo novo ícone.
                  </li>
                </>
              ) : (
                <>
                  <li>Abra este site no Chrome ou Edge.</li>
                  <li>
                    No menu do navegador, escolha Instalar app ou Instalar
                    Organizap. No computador, procure também o ícone de
                    instalação na barra de endereço.
                  </li>
                  <li>
                    Confirme a instalação e abra pelo novo ícone. Se a opção não
                    aparecer, verifique se o app já está instalado ou use um
                    navegador compatível fora do modo privado.
                  </li>
                </>
              )}
            </ol>
            <p className="text-muted-foreground text-sm">
              Depois, volte a Notificações no aplicativo e toque em Ligar avisos
              para permitir os alertas neste aparelho.
            </p>
          </DialogContent>
        </Dialog>
      </div>
      <div className="bg-card space-y-3 rounded-xl border p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Bell className="size-5" /> Avisos neste aparelho
        </h2>
        <p className="text-muted-foreground text-sm">
          {enabled ? 'Ligados neste aparelho.' : 'Desligados neste aparelho.'}{' '}
          Os avisos podem chegar mesmo com o app fechado.
        </p>
        <Button disabled={busy} onClick={() => void toggle()}>
          {enabled ? 'Desligar avisos' : 'Ligar avisos'}
        </Button>
        {check('messages', 'Mensagens de contatos sob atendimento da equipe')}
        {check('allMessages', 'Incluir mensagens enquanto a IA atende')}
        {check('tasks', 'Tarefas e lembretes')}
        {check('sales', 'Vendas ganhas')}
        {check('system', 'Atribuições de conversas e atualizações do sistema')}
        {check('quietPush', 'Seguir o modo não perturbe também neste aparelho')}
      </div>
      <div className="bg-card space-y-3 rounded-xl border p-5">
        <h2 className="font-semibold">Lembretes por WhatsApp</h2>
        {check('whatsapp', 'Receber lembretes de tarefas no meu WhatsApp')}
        <label className="block text-sm">
          Meu número com DDI e DDD
          <input
            value={settings.phone}
            inputMode="tel"
            onChange={(e) =>
              setSettings((s) => ({ ...s, phone: e.target.value }))
            }
            className="bg-background mt-1 block w-full rounded-md border p-2"
            placeholder="55 + DDD + número"
          />
        </label>
        <p className="text-muted-foreground text-xs">
          O envio usa a conexão Evolution desta conta. A opção precisa estar
          ligada e o número conectado para enviar.
        </p>
      </div>
      <div className="bg-card space-y-3 rounded-xl border p-5">
        <h2 className="font-semibold">Modo não perturbe</h2>
        <p className="text-muted-foreground text-sm">
          Horário de Brasília. Os lembretes aguardam até a próxima janela
          permitida.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {(['quietStart', 'quietEnd'] as const).map((name, i) => (
            <label key={name} className="text-sm">
              {i ? 'Fim do silêncio' : 'Início do silêncio'}
              <input
                type="time"
                value={settings[name]}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, [name]: e.target.value }))
                }
                className="bg-background mt-1 block w-full rounded-md border p-2"
              />
            </label>
          ))}
        </div>
        {check('weekends', 'Silenciar fins de semana inteiros')}
      </div>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void save()
            .then(() => toast.success('Preferências salvas.'))
            .catch((e) => toast.error(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Salvar preferências
      </Button>
    </section>
  );
}
