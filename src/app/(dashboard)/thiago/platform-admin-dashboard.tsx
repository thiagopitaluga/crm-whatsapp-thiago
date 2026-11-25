'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Ban,
  Building2,
  Database,
  HardDrive,
  Container,
  Gauge,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Role = 'owner' | 'admin' | 'agent' | 'viewer';
type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  blocked: boolean;
  activeAccountId: string | null;
  activeAccountName: string | null;
  activeRole: Role | null;
  memberships: { accountId: string; accountName: string; role: Role }[];
};
type Account = {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
};
type AccountMetric = {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
  members: number;
  contacts: number;
  conversations: number;
  messages: number;
  deals: number;
};
type Metrics = {
  database_bytes: number;
  public_tables_bytes: number;
  storage_bytes: number;
  contacts: number;
  conversations: number;
  messages: number;
  deals: number;
  accounts_total: number;
  accounts_active: number;
  accounts: AccountMetric[];
};
type AuditEntry = {
  id: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
type Overview = {
  generatedAt: string;
  users: AdminUser[];
  accounts: Account[];
  metrics: Metrics;
  audit: AuditEntry[];
  infrastructure: {
    vps: null | {
      source: string;
      hostname: string;
      collected_at: string;
      received_at: string;
      payload: {
        cpuCores: number;
        load1: number;
        load5: number;
        load15: number;
        uptimeSeconds: number;
        memory: { total: number; used: number; available: number; swap_total: number; swap_used: number };
        disk: { total: number; used: number; available: number };
        network: { received: number; transmitted: number };
        docker: {
          running: number;
          containers: { name: string; image: string; status: string }[];
          usage: { Type?: string; Size?: string; Reclaimable?: string; Active?: string }[];
        };
      };
    };
    supabase: {
      plan: string;
      databaseCapacityBytes: number;
      storageCapacityBytes: number;
    };
    vercel: {
      status: string;
      environment: string;
      region: string | null;
      deployment: string | null;
    };
  };
};

const roleLabels: Record<Role, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  agent: 'Agente',
  viewer: 'Visualizador',
};

const actionLabels: Record<string, string> = {
  'user.created': 'Criou um acesso',
  'user.block': 'Bloqueou um acesso',
  'user.unblock': 'Desbloqueou um acesso',
  'user.deleted': 'Excluiu um acesso',
  'user.password_reset': 'Redefiniu uma senha',
  'user.membership_updated': 'Alterou conta ou perfil',
  'account.renamed': 'Renomeou uma conta',
};

function formatBytes(value = 0) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toLocaleString('pt-BR', {
    maximumFractionDigits: index > 1 ? 2 : 0,
  })} ${units[index]}`;
}

function formatDate(value: string | null) {
  if (!value) return 'Nunca';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.');
  return data;
}

export function PlatformAdminDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<'overview' | 'infrastructure' | 'users' | 'accounts' | 'audit'>('overview');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [temporaryAccess, setTemporaryAccess] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [createForm, setCreateForm] = useState({
    fullName: '',
    email: '',
    destination: 'new',
    accountName: '',
    role: 'agent',
  });
  const [editForm, setEditForm] = useState({ accountId: '', role: 'agent' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/api/platform-admin/overview');
      setOverview(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao carregar o painel.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return overview?.users ?? [];
    return (overview?.users ?? []).filter((user) =>
      [user.fullName, user.email, user.activeAccountName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [overview?.users, search]);

  async function runUserAction(user: AdminUser, action: 'block' | 'unblock' | 'reset-password') {
    const verbs = {
      block: 'bloquear',
      unblock: 'desbloquear',
      'reset-password': 'redefinir a senha de',
    };
    if (!window.confirm(`Deseja ${verbs[action]} ${user.email}?`)) return;
    setBusy(`${action}:${user.id}`);
    try {
      const result = await api(`/api/platform-admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      if (result.temporaryPassword) {
        setTemporaryAccess({ email: user.email, password: result.temporaryPassword });
      }
      toast.success('Ação concluída.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ação não concluída.');
    } finally {
      setBusy('');
    }
  }

  async function deleteUser(user: AdminUser) {
    if (!window.confirm(`Excluir definitivamente o acesso ${user.email}? Esta ação não pode ser desfeita.`)) return;
    setBusy(`delete:${user.id}`);
    try {
      await api(`/api/platform-admin/users/${user.id}`, { method: 'DELETE' });
      toast.success('Acesso excluído.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível excluir.');
    } finally {
      setBusy('');
    }
  }

  async function createUser() {
    setBusy('create');
    try {
      const result = await api('/api/platform-admin/users', {
        method: 'POST',
        body: JSON.stringify({
          fullName: createForm.fullName,
          email: createForm.email,
          accountId: createForm.destination === 'new' ? null : createForm.destination,
          accountName: createForm.destination === 'new' ? createForm.accountName : '',
          role: createForm.role,
        }),
      });
      setCreateOpen(false);
      setTemporaryAccess({ email: result.email, password: result.temporaryPassword });
      setCreateForm({ fullName: '', email: '', destination: 'new', accountName: '', role: 'agent' });
      toast.success('Acesso criado.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar.');
    } finally {
      setBusy('');
    }
  }

  async function saveMembership() {
    if (!editUser) return;
    setBusy(`edit:${editUser.id}`);
    try {
      await api(`/api/platform-admin/users/${editUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'update-membership',
          accountId: editForm.accountId,
          role: editForm.role,
        }),
      });
      setEditUser(null);
      toast.success('Vínculo atualizado.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar.');
    } finally {
      setBusy('');
    }
  }

  async function renameAccount(account: AccountMetric) {
    const name = window.prompt('Novo nome da conta:', account.name)?.trim();
    if (!name || name === account.name) return;
    setBusy(`account:${account.id}`);
    try {
      await api(`/api/platform-admin/accounts/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      toast.success('Conta renomeada.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível renomear.');
    } finally {
      setBusy('');
    }
  }

  const metrics = overview?.metrics;
  const cards = [
    { label: 'Logins', value: overview?.users.length ?? 0, icon: Users, hint: `${overview?.users.filter((u) => u.blocked).length ?? 0} bloqueados` },
    { label: 'Contas em uso', value: metrics?.accounts_active ?? 0, icon: Building2, hint: `${metrics?.accounts_total ?? 0} registros totais` },
    { label: 'Banco de dados', value: formatBytes(metrics?.database_bytes), icon: Database, hint: `${formatBytes(metrics?.public_tables_bytes)} em tabelas públicas` },
    { label: 'Arquivos', value: formatBytes(metrics?.storage_bytes), icon: HardDrive, hint: 'Supabase Storage' },
    { label: 'Contatos', value: metrics?.contacts ?? 0, icon: UserCog, hint: `${metrics?.conversations ?? 0} conversas` },
    { label: 'Mensagens', value: metrics?.messages ?? 0, icon: Activity, hint: `${metrics?.deals ?? 0} negócios` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-primary size-6" />
            <h1 className="text-2xl font-bold tracking-tight">Administração geral</h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Visão consolidada e controle global do Organizap.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} /> Atualizar
          </Button>
          <Button onClick={() => setCreateOpen(true)}><Plus /> Novo acesso</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border bg-card p-2">
        {([
          ['overview', 'Visão geral'],
          ['infrastructure', 'Infraestrutura'],
          ['users', 'Acessos'],
          ['accounts', 'Contas'],
          ['audit', 'Auditoria'],
        ] as const).map(([value, label]) => (
          <Button key={value} variant={tab === value ? 'default' : 'ghost'} onClick={() => setTab(value)}>
            {label}
          </Button>
        ))}
      </div>

      {loading && !overview ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Carregando dados de produção...</CardContent></Card>
      ) : null}

      {overview && tab === 'overview' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <Card key={card.label}>
                <CardHeader className="flex-row items-center justify-between">
                  <div><CardDescription>{card.label}</CardDescription><CardTitle className="mt-1 text-2xl">{card.value}</CardTitle></div>
                  <div className="bg-primary/10 text-primary rounded-xl p-3"><card.icon className="size-5" /></div>
                </CardHeader>
                <CardContent className="text-muted-foreground text-xs">{card.hint}</CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader><CardTitle>Uso por conta organizacional</CardTitle><CardDescription>Volume atual registrado em cada empresa.</CardDescription></CardHeader>
            <CardContent>
              <AccountsTable accounts={metrics?.accounts ?? []} busy={busy} onRename={renameAccount} />
            </CardContent>
          </Card>
        </>
      ) : null}

      {overview && tab === 'users' ? (
        <Card>
          <CardHeader>
            <CardTitle>Acessos cadastrados</CardTitle>
            <CardDescription>Crie, bloqueie, redefina ou exclua logins.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-md"><Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, e-mail ou empresa..." /></div>
            <Table>
              <TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead>Conta ativa</TableHead><TableHead>Perfil</TableHead><TableHead>Status</TableHead><TableHead>Último acesso</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell><div className="font-medium">{user.fullName || 'Sem nome'}</div><div className="text-muted-foreground text-xs">{user.email}</div></TableCell>
                    <TableCell>{user.activeAccountName || 'Sem conta'}</TableCell>
                    <TableCell>{user.activeRole ? roleLabels[user.activeRole] : '—'}</TableCell>
                    <TableCell><Badge variant={user.blocked ? 'destructive' : 'secondary'}>{user.blocked ? 'Bloqueado' : 'Ativo'}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatDate(user.lastSignInAt)}</TableCell>
                    <TableCell><div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" title="Alterar conta e perfil" onClick={() => { setEditUser(user); setEditForm({ accountId: user.activeAccountId ?? '', role: user.activeRole === 'owner' ? 'admin' : user.activeRole ?? 'agent' }); }}><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" title="Redefinir senha" disabled={Boolean(busy)} onClick={() => void runUserAction(user, 'reset-password')}><KeyRound /></Button>
                      <Button size="icon-sm" variant="ghost" title={user.blocked ? 'Desbloquear' : 'Bloquear'} disabled={Boolean(busy)} onClick={() => void runUserAction(user, user.blocked ? 'unblock' : 'block')}><Ban /></Button>
                      <Button size="icon-sm" variant="destructive" title="Excluir acesso" disabled={Boolean(busy)} onClick={() => void deleteUser(user)}><Trash2 /></Button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {overview && tab === 'infrastructure' ? (
        <InfrastructurePanel overview={overview} />
      ) : null}

      {overview && tab === 'accounts' ? (
        <Card><CardHeader><CardTitle>Contas organizacionais</CardTitle><CardDescription>Empresas ativas e registros sem membros.</CardDescription></CardHeader><CardContent><AccountsTable accounts={metrics?.accounts ?? []} busy={busy} onRename={renameAccount} /></CardContent></Card>
      ) : null}

      {overview && tab === 'audit' ? (
        <Card><CardHeader><CardTitle>Auditoria administrativa</CardTitle><CardDescription>Últimas ações executadas neste painel.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Administrador</TableHead><TableHead>Ação</TableHead><TableHead>Alvo</TableHead></TableRow></TableHeader><TableBody>{overview.audit.map((entry) => <TableRow key={entry.id}><TableCell className="text-xs">{formatDate(entry.created_at)}</TableCell><TableCell>{entry.actor_email}</TableCell><TableCell>{actionLabels[entry.action] ?? entry.action}</TableCell><TableCell className="text-muted-foreground text-xs">{entry.target_type} {entry.target_id?.slice(0, 8)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Novo acesso</DialogTitle><DialogDescription>Crie um login em uma conta existente ou em uma nova empresa.</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2"><Label>Nome</Label><Input value={createForm.fullName} onChange={(e) => setCreateForm((f) => ({ ...f, fullName: e.target.value }))} /></div>
            <div className="grid gap-2"><Label>E-mail de login</Label><Input type="email" value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div className="grid gap-2"><Label>Destino</Label><Select value={createForm.destination} onValueChange={(value) => setCreateForm((f) => ({ ...f, destination: value ?? 'new' }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">Criar nova conta organizacional</SelectItem>{overview?.accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent></Select></div>
            {createForm.destination === 'new' ? <div className="grid gap-2"><Label>Nome da nova empresa</Label><Input value={createForm.accountName} onChange={(e) => setCreateForm((f) => ({ ...f, accountName: e.target.value }))} /></div> : <div className="grid gap-2"><Label>Perfil</Label><RoleSelect value={createForm.role} onChange={(value) => setCreateForm((f) => ({ ...f, role: value }))} /></div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={() => void createUser()} disabled={busy === 'create'}>{busy === 'create' ? 'Criando...' : 'Criar acesso'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editUser)} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent><DialogHeader><DialogTitle>Alterar conta e perfil</DialogTitle><DialogDescription>{editUser?.email}</DialogDescription></DialogHeader>
          <div className="grid gap-4"><div className="grid gap-2"><Label>Conta ativa</Label><Select value={editForm.accountId} onValueChange={(value) => setEditForm((f) => ({ ...f, accountId: value ?? '' }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{overview?.accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>Perfil</Label><RoleSelect value={editForm.role} onChange={(role) => setEditForm((f) => ({ ...f, role }))} /></div></div>
          <DialogFooter><Button variant="outline" onClick={() => setEditUser(null)}>Cancelar</Button><Button onClick={() => void saveMembership()} disabled={!editForm.accountId || busy.startsWith('edit:')}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(temporaryAccess)} onOpenChange={(open) => !open && setTemporaryAccess(null)}>
        <DialogContent><DialogHeader><DialogTitle>Senha temporária</DialogTitle><DialogDescription>Copie agora e envie por um canal seguro. Ela não será exibida novamente.</DialogDescription></DialogHeader><div className="rounded-lg border bg-muted/40 p-4"><div className="text-muted-foreground text-xs">{temporaryAccess?.email}</div><code className="mt-2 block break-all text-base font-semibold">{temporaryAccess?.password}</code></div><DialogFooter><Button variant="outline" onClick={() => temporaryAccess && navigator.clipboard.writeText(temporaryAccess.password)}>Copiar senha</Button><Button onClick={() => setTemporaryAccess(null)}>Concluir</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={(next) => onChange(next ?? 'agent')}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Administrador</SelectItem><SelectItem value="agent">Agente</SelectItem><SelectItem value="viewer">Visualizador</SelectItem></SelectContent></Select>;
}

function AccountsTable({ accounts, busy, onRename }: { accounts: AccountMetric[]; busy: string; onRename: (account: AccountMetric) => void }) {
  return <Table><TableHeader><TableRow><TableHead>Conta</TableHead><TableHead>Membros</TableHead><TableHead>Contatos</TableHead><TableHead>Conversas</TableHead><TableHead>Mensagens</TableHead><TableHead>Negócios</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>{accounts.map((account) => <TableRow key={account.id}><TableCell><div className="font-medium">{account.name}</div><div className="text-muted-foreground text-xs">Criada em {formatDate(account.created_at)}</div></TableCell><TableCell>{account.members}</TableCell><TableCell>{account.contacts}</TableCell><TableCell>{account.conversations}</TableCell><TableCell>{account.messages}</TableCell><TableCell>{account.deals}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" disabled={busy === `account:${account.id}`} onClick={() => onRename(account)}><Pencil /> Renomear</Button></TableCell></TableRow>)}</TableBody></Table>;
}

function percentage(used: number, total: number) {
  return total > 0 ? Math.min(100, (used / total) * 100) : 0;
}

function uptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

function UsageBar({ label, used, total, detail }: { label: string; used: number; total: number; detail?: string }) {
  const value = percentage(used, total);
  const tone = value >= 90 ? 'bg-destructive' : value >= 75 ? 'bg-amber-500' : 'bg-primary';
  return <div className="space-y-2"><div className="flex items-center justify-between gap-4 text-sm"><span className="font-medium">{label}</span><span className="text-muted-foreground">{formatBytes(used)} / {formatBytes(total)} · {value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span></div><div className="bg-muted h-2 overflow-hidden rounded-full"><div className={`${tone} h-full rounded-full transition-all`} style={{ width: `${value}%` }} /></div>{detail ? <p className="text-muted-foreground text-xs">{detail}</p> : null}</div>;
}

function InfrastructurePanel({ overview }: { overview: Overview }) {
  const { metrics, infrastructure } = overview;
  const vps = infrastructure.vps;
  const ageMinutes = vps ? Math.floor((new Date(overview.generatedAt).getTime() - new Date(vps.collected_at).getTime()) / 60000) : null;
  const fresh = ageMinutes !== null && ageMinutes <= 15;
  const capacityAlerts = [
    { label: 'Banco de dados', used: metrics.database_bytes, total: infrastructure.supabase.databaseCapacityBytes },
    { label: 'Armazenamento de arquivos', used: metrics.storage_bytes, total: infrastructure.supabase.storageCapacityBytes },
  ].filter(({ used, total }) => total > 0 && used / total >= 0.85);
  return <div className="space-y-4">
    {capacityAlerts.map(({ label, used, total }) => (
      <p key={label} role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
        <strong>{label}</strong> está em {(used / total).toLocaleString('pt-BR', { style: 'percent', maximumFractionDigits: 1 })} da capacidade configurada.
        {' '}{formatBytes(Math.max(0, total - used))} disponíveis.
      </p>
    ))}
    <div className="grid gap-4 xl:grid-cols-3">
      <Card><CardHeader><div className="flex items-center justify-between"><div><CardTitle>Supabase</CardTitle><CardDescription>Banco, autenticação e arquivos</CardDescription></div><Database className="text-primary size-5" /></div></CardHeader><CardContent className="space-y-5"><div className="flex items-center justify-between"><span className="text-sm">Plano de referência</span><Badge variant="secondary">{infrastructure.supabase.plan}</Badge></div><UsageBar label="Banco de dados" used={metrics.database_bytes} total={infrastructure.supabase.databaseCapacityBytes} detail={`${formatBytes(Math.max(0, infrastructure.supabase.databaseCapacityBytes - metrics.database_bytes))} disponíveis`} /><UsageBar label="Armazenamento de arquivos" used={metrics.storage_bytes} total={infrastructure.supabase.storageCapacityBytes} detail={`${formatBytes(Math.max(0, infrastructure.supabase.storageCapacityBytes - metrics.storage_bytes))} disponíveis`} /></CardContent></Card>
      <Card><CardHeader><div className="flex items-center justify-between"><div><CardTitle>VPS InterServer</CardTitle><CardDescription>{vps?.hostname ?? 'Aguardando primeira leitura'}</CardDescription></div><Server className="text-primary size-5" /></div></CardHeader><CardContent className="space-y-5">{vps ? <><div className="flex items-center justify-between"><span className="text-sm">Monitoramento</span><Badge variant={fresh ? 'secondary' : 'destructive'}>{fresh ? 'Online' : 'Desatualizado'}</Badge></div><UsageBar label="Memória RAM" used={vps.payload.memory.used} total={vps.payload.memory.total} /><UsageBar label="Disco" used={vps.payload.disk.used} total={vps.payload.disk.total} /><UsageBar label="Swap" used={vps.payload.memory.swap_used} total={vps.payload.memory.swap_total} /><div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Carga / núcleos</div><div className="mt-1 font-semibold">{vps.payload.load1.toFixed(2)} / {vps.payload.cpuCores}</div></div><div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Uptime</div><div className="mt-1 font-semibold">{uptime(vps.payload.uptimeSeconds)}</div></div></div><p className="text-muted-foreground text-xs">Última coleta há {ageMinutes} min.</p></> : <p className="text-muted-foreground text-sm">O agente da VPS ainda não enviou dados.</p>}</CardContent></Card>
      <Card><CardHeader><div className="flex items-center justify-between"><div><CardTitle>Aplicação Vercel</CardTitle><CardDescription>Frontend e APIs do Organizap</CardDescription></div><Gauge className="text-primary size-5" /></div></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between"><span>Status</span><Badge variant="secondary">Operacional</Badge></div><div className="grid gap-3 text-sm"><div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Ambiente</div><div className="mt-1 font-semibold">{infrastructure.vercel.environment}</div></div><div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Região atual</div><div className="mt-1 font-semibold">{infrastructure.vercel.region ?? 'Automática'}</div></div><div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Versão publicada</div><div className="mt-1 font-mono font-semibold">{infrastructure.vercel.deployment ?? 'Produção'}</div></div></div></CardContent></Card>
    </div>
    <Card><CardHeader><div className="flex items-center gap-2"><Container className="text-primary size-5" /><div><CardTitle>Serviços da VPS</CardTitle><CardDescription>Containers e componentes responsáveis por WhatsApp e Evolution.</CardDescription></div></div></CardHeader><CardContent>{vps?.payload.docker.containers.length ? <Table><TableHeader><TableRow><TableHead>Serviço</TableHead><TableHead>Imagem</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{vps.payload.docker.containers.map((container) => <TableRow key={container.name}><TableCell className="font-medium">{container.name}</TableCell><TableCell className="text-muted-foreground text-xs">{container.image}</TableCell><TableCell><Badge variant="secondary">{container.status}</Badge></TableCell></TableRow>)}</TableBody></Table> : <p className="text-muted-foreground text-sm">Nenhum container informado ainda.</p>}{vps?.payload.docker.usage.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{vps.payload.docker.usage.map((item) => <div key={item.Type} className="rounded-lg border p-3 text-sm"><div className="font-medium">{item.Type}</div><div className="text-muted-foreground mt-1 text-xs">{item.Size} · recuperável {item.Reclaimable}</div></div>)}</div> : null}</CardContent></Card>
  </div>;
}

