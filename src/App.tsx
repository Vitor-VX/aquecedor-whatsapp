import { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, CalendarDays, CheckCircle2, CirclePause, Clock3,
  Flame, Github, Inbox, LayoutDashboard, Library, Loader2, MessageCircle, Pause, Play, Plus,
  Pencil, QrCode, Radio, RefreshCw, Send, Server, Settings, ShieldCheck, Smartphone, Trash2, Upload, Users, X,
} from 'lucide-react';

type Tab = 'overview' | 'numbers' | 'slots' | 'queue' | 'content' | 'settings';
type Profile = 'light' | 'moderate' | 'intensive' | 'aggressive';

interface WarmNumber {
  _id: string; name: string; phoneNumber?: string; instanceId: string;
  connectionState: string; warmupState: string; profile: Profile; slotId?: string;
  progress: number; sentToday: number; receivedToday: number; successfulSends: number;
  failedSends: number; lastError?: string; profileName?: string; profilePicUrl?: string;
  warmupDays: 7 | 14 | 30;
  healthScore: number; healthLabel: string;
}
interface WarmSlot {
  _id: string; name: string; profile: Profile; status: string; numberIds: Array<string | WarmNumber>;
  startedAt?: string;
  durationDays: 7 | 14 | 30;
}
interface EventItem { _id: string; title: string; detail?: string; level: string; createdAt: string; type: string; }
type ContentKind = 'text' | 'audio' | 'image' | 'video' | 'sticker';
interface ContentItem { _id: string; label: string; kind: ContentKind; text?: string; url?: string; mimeType?: string; fileName?: string; usageCount: number; active: boolean; }
interface Dashboard {
  metrics: Record<string, number>; numbers: WarmNumber[]; slots: WarmSlot[];
  events: EventItem[]; queue: Record<string, number>; queuePaused: boolean;
  profiles: Array<{ id: Profile; label: string; limits: number[] }>;
  durations: number[];
}
interface Config {
  serverUrl: string; hasAdminToken: boolean; publicBaseUrl: string; queuePaused: boolean;
  quietStartHour: number; quietEndHour: number; workerConcurrency: number; rabbitMqEnabled?: boolean; databaseName: string;
}

const profileLabel: Record<Profile, string> = { light: 'Leve', moderate: 'Moderado', intensive: 'Intenso controlado', aggressive: 'Agressivo controlado' };

const formatPhone = (value?: string) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 'Sem número pareado';
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const area = digits.slice(2, 4);
    const local = digits.slice(4);
    const split = local.length === 9 ? `${local.slice(0, 5)}-${local.slice(5)}` : `${local.slice(0, 4)}-${local.slice(4)}`;
    return `+55 (${area}) ${split}`;
  }
  return `+${digits}`;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}

const timeAgo = (value: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'agora';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86400)} d`;
};

function StatusPill({ status }: { status: string }) {
  const good = ['connected', 'warming', 'ready', 'active', 'completed'].includes(status);
  const warning = ['connecting', 'draft', 'queued', 'paused', 'processing'].includes(status);
  return <span className={`pill ${good ? 'pill-good' : warning ? 'pill-warn' : 'pill-bad'}`}><i />{status}</span>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={18} /></button></div>{children}</div></div>;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [numberModal, setNumberModal] = useState(false);
  const [slotModal, setSlotModal] = useState(false);
  const [editNumber, setEditNumber] = useState<WarmNumber | null>(null);
  const [editSlot, setEditSlot] = useState<WarmSlot | null>(null);
  const [qr, setQr] = useState<{ name: string; value: string } | null>(null);
  const [queueJobs, setQueueJobs] = useState<any[]>([]);
  const [queueMeta, setQueueMeta] = useState({ total: 0, hasMore: false });
  const [agendaSlot, setAgendaSlot] = useState<WarmSlot | null>(null);

  const refresh = async () => {
    const [dash, nextConfig] = await Promise.all([api<Dashboard>('/api/dashboard'), api<Config>('/api/config')]);
    setDashboard(dash); setConfig(nextConfig);
  };
  useEffect(() => {
    refresh().catch((error) => setNotice({ type: 'error', text: error.message }));
    const timer = window.setInterval(() => refresh().catch(() => undefined), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (tab !== 'queue') return;
    setBusy('queue-load');
    api<any>('/api/queue?limit=10&offset=0').then((result) => {
      setQueueJobs(result.items || []);
      setQueueMeta({ total: result.total || 0, hasMore: Boolean(result.hasMore) });
    }).catch((error) => setNotice({ type: 'error', text: error.message })).finally(() => setBusy(''));
  }, [tab]);

  const loadMoreQueue = async () => {
    setBusy('queue-more');
    try {
      const result = await api<any>(`/api/queue?limit=10&offset=${queueJobs.length}`);
      setQueueJobs((current) => [...current, ...(result.items || [])]);
      setQueueMeta({ total: result.total || 0, hasMore: Boolean(result.hasMore) });
    } catch (error: any) { setNotice({ type: 'error', text: error.message }); }
    finally { setBusy(''); }
  };

  const run = async (key: string, task: () => Promise<any>, success?: string) => {
    setBusy(key); setNotice(null);
    try { const result = await task(); if (success || result?.message) setNotice({ type: 'ok', text: success || result.message }); await refresh(); return result; }
    catch (error: any) { setNotice({ type: 'error', text: error.message }); }
    finally { setBusy(''); }
  };

  const navigation: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'overview', label: 'Visão geral', icon: LayoutDashboard },
    { id: 'numbers', label: 'Números', icon: Smartphone },
    { id: 'slots', label: 'Slots', icon: Users },
    { id: 'queue', label: 'Fila', icon: Inbox },
    { id: 'content', label: 'Conteúdo', icon: Library },
    { id: 'settings', label: 'Configurações', icon: Settings },
  ];
  const connectedPercent = dashboard?.metrics.totalNumbers ? Math.round((dashboard.metrics.connected / dashboard.metrics.totalNumbers) * 100) : 0;
  const averageHealth = dashboard?.numbers.length ? Math.round(dashboard.numbers.reduce((sum, number) => sum + number.healthScore, 0) / dashboard.numbers.length) : 0;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Flame size={21} /></div><div><strong>WarmFlow</strong><span>Aquecedor WhatsApp</span></div></div>
      <div className="workspace-badge"><span className="live-dot" />Operação controlada</div>
      <nav>{navigation.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => setTab(item.id)} className={tab === item.id ? 'active' : ''}><Icon size={18} /><span>{item.label}</span>{item.id === 'queue' && dashboard?.metrics.queued ? <b>{dashboard.metrics.queued}</b> : null}</button>; })}</nav>
      <a className="sidebar-safety developer-link" href="https://github.com/Vitor-VX" target="_blank" rel="noreferrer"><Github size={18} /><div><strong>Desenvolvido por Vitor VX</strong><p>Projeto open source no GitHub</p></div><ArrowRight size={14} /></a>
      <div className="sidebar-footer"><div className={`queue-state ${dashboard?.queuePaused ? 'paused' : ''}`}><span /><div><strong>Fila {dashboard?.queuePaused ? 'pausada' : 'ativa'}</strong><small>{dashboard?.queuePaused ? 'Nenhum envio automático' : 'Worker processando'}</small></div></div></div>
    </aside>

    <main>
      <header className="topbar"><div><p className="eyebrow">OPERAÇÃO / {navigation.find((item) => item.id === tab)?.label.toUpperCase()}</p><h1>{navigation.find((item) => item.id === tab)?.label}</h1></div><div className="top-actions"><button className="secondary-button" onClick={() => refresh()}><RefreshCw size={16} />Atualizar</button><button className="primary-button" onClick={() => setNumberModal(true)}><Plus size={17} />Conectar número</button></div></header>
      {notice && <div className={`notice ${notice.type}`} onClick={() => setNotice(null)}>{notice.type === 'ok' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}<span>{notice.text}</span><X size={15} /></div>}

      {!dashboard ? <div className="center-loading"><Loader2 className="spin" /><span>Carregando operação...</span></div> : <div className="content">
        {tab === 'overview' && <>
          <section className="hero-card"><div><p className="eyebrow green">PAINEL DE MATURAÇÃO</p><h2>{dashboard.metrics.warming ? `${dashboard.metrics.warming} números em aquecimento` : 'Pronto para iniciar o primeiro slot'}</h2><p>Distribuição gradual, conversas bidirecionais e rastreabilidade em uma fila durável.</p><div className="hero-actions"><button className="primary-button" onClick={() => setSlotModal(true)}><Plus size={16} />Novo slot</button><button className={`secondary-button ${dashboard.queuePaused ? 'attention' : ''}`} onClick={() => run('queue-toggle', () => api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queuePaused: !dashboard.queuePaused }) }), dashboard.queuePaused ? 'Fila liberada.' : 'Fila pausada imediatamente.')}>{busy === 'queue-toggle' ? <Loader2 size={16} className="spin" /> : dashboard.queuePaused ? <Play size={16} /> : <Pause size={16} />}{dashboard.queuePaused ? 'Liberar fila' : 'Pausar fila'}</button></div></div><div className="radial" style={{ '--value': `${connectedPercent * 3.6}deg` } as any}><div><strong>{connectedPercent}%</strong><span>conectados</span></div></div></section>
          <section className="metric-grid">
            {[
              ['Números conectados', dashboard.metrics.connected, Radio, 'green'],
              ['Em aquecimento', dashboard.metrics.warming, Flame, 'orange'],
              ['Prontos para uso', dashboard.metrics.ready, CheckCircle2, 'blue'],
              ['Na fila hoje', dashboard.metrics.queued, Clock3, 'purple'],
              ['Mensagens enviadas', dashboard.metrics.sentToday, Send, 'green'],
              ['Mensagens recebidas', dashboard.metrics.receivedToday, MessageCircle, 'blue'],
              ['Saúde média', averageHealth, Activity, 'purple'],
            ].map(([label, value, Icon, color]: any) => <article className="metric-card" key={label}><div className={`metric-icon ${color}`}><Icon size={18} /></div><div><span>{label}</span><strong>{value}</strong></div></article>)}
          </section>
          <section className="two-columns"><div className="panel"><div className="panel-head"><div><p className="eyebrow">NÚMEROS</p><h3>Progresso do aquecimento</h3></div><button className="text-button" onClick={() => setTab('numbers')}>Ver todos <ArrowRight size={14} /></button></div><div className="number-list">{dashboard.numbers.length ? dashboard.numbers.slice(0, 5).map((number) => <NumberRow key={number._id} number={number} />) : <Empty icon={Smartphone} title="Nenhum número conectado" text="Crie uma instância e escaneie o QR Code." />}</div></div>
            <div className="panel"><div className="panel-head"><div><p className="eyebrow">ATIVIDADE</p><h3>Eventos recentes</h3></div><Activity size={18} /></div><div className="timeline">{dashboard.events.length ? dashboard.events.map((event) => <div className="event" key={event._id}><span className={event.level} /><div><strong>{event.title}</strong><p>{event.detail || event.type}</p></div><time>{timeAgo(event.createdAt)}</time></div>) : <Empty icon={Activity} title="Sem eventos" text="As conexões e mensagens aparecerão aqui." />}</div></div></section>
        </>}

        {tab === 'numbers' && <section className="panel full"><div className="panel-head"><div><p className="eyebrow">INSTÂNCIAS UAZAPI</p><h3>Números conectados</h3><p className="panel-subtitle">Cada número tem credencial isolada e só conversa com pares do mesmo slot.</p></div><button className="primary-button" onClick={() => setNumberModal(true)}><Plus size={16} />Adicionar</button></div><div className="cards-grid">{dashboard.numbers.map((number) => <article className="number-card" key={number._id}><div className="number-card-head"><div className="avatar">{number.profilePicUrl ? <img src={number.profilePicUrl} /> : number.name.slice(0, 1).toUpperCase()}</div><div><h4>{number.name}</h4><p>{formatPhone(number.phoneNumber)}</p></div><StatusPill status={number.connectionState} /></div><div className="profile-line"><span>{profileLabel[number.profile]} · {number.warmupDays} dias</span><b>{number.progress}%</b></div><div className="progress-track"><i style={{ width: `${number.progress}%` }} /></div><div className="number-stats"><div><span>Enviadas hoje</span><strong>{number.sentToday}</strong></div><div><span>Recebidas hoje</span><strong>{number.receivedToday}</strong></div><div><span>Falhas</span><strong>{number.failedSends}</strong></div></div>{number.lastError && <p className="inline-error">{number.lastError}</p>}<div className="card-actions"><button className="icon-button" title="Editar nome" onClick={() => setEditNumber(number)}><Pencil size={15} /></button><button className="icon-button danger" title="Excluir número" onClick={() => { if (window.confirm(`Excluir ${number.name} do aquecedor? Os envios pendentes serão cancelados.`)) void run(`delete-number-${number._id}`, () => api(`/api/numbers/${number._id}`, { method: 'DELETE' }), 'Número removido do aquecedor.'); }}><Trash2 size={15} /></button><button className="secondary-button" onClick={() => run(`status-${number._id}`, () => api(`/api/numbers/${number._id}/status`), 'Status atualizado.')}>{busy === `status-${number._id}` ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}Status</button>{number.connectionState !== 'connected' && <button className="primary-button" onClick={async () => { const result = await run(`connect-${number._id}`, () => api<any>(`/api/numbers/${number._id}/connect`, { method: 'POST' })); if (result?.qrcode) setQr({ name: number.name, value: result.qrcode }); }}><QrCode size={15} />Gerar QR</button>}</div></article>)}{!dashboard.numbers.length && <Empty icon={Smartphone} title="Nenhuma instância" text="Conecte o primeiro número próprio para começar." />}</div></section>}

        {tab === 'slots' && <section className="panel full"><div className="panel-head"><div><p className="eyebrow">ORQUESTRAÇÃO</p><h3>Slots de aquecimento</h3><p className="panel-subtitle">Agrupe dois ou mais números para distribuir mensagens somente entre eles.</p></div><button className="primary-button" onClick={() => setSlotModal(true)}><Plus size={16} />Novo slot</button></div><div className="slot-grid">{dashboard.slots.map((slot) => <SlotCard key={slot._id} slot={slot} numbers={dashboard.numbers} busy={busy} run={run} onEdit={setEditSlot} onAgenda={setAgendaSlot} onDelete={() => { if (window.confirm(`Excluir o slot ${slot.name}? Os números serão liberados e os envios pendentes cancelados.`)) void run(`delete-slot-${slot._id}`, () => api(`/api/slots/${slot._id}`, { method: 'DELETE' }), 'Slot removido.'); }} />)}{!dashboard.slots.length && <Empty icon={Users} title="Nenhum slot criado" text="Crie um slot e adicione pelo menos dois números conectados." />}</div></section>}

        {tab === 'queue' && <section className="panel full"><div className="panel-head"><div><p className="eyebrow">FILA DURÁVEL</p><h3>Próximos envios e histórico</h3><p className="panel-subtitle">Jobs persistidos no MongoDB, com idempotência e retry controlado.</p></div><div className="queue-summary"><span><i className="queued" />{dashboard.metrics.queued} aguardando</span><span><i className="failed" />{dashboard.metrics.failed} falhas</span></div></div><div className="table-wrap"><table><thead><tr><th>Horário</th><th>Origem</th><th>Destino</th><th>Mensagem</th><th>Status</th><th>Tentativas</th></tr></thead><tbody>{queueJobs.map((job) => <tr key={job._id}><td>{new Date(job.runAt).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</td><td>{job.senderNumberId?.name || '—'}</td><td>{job.recipientNumberId?.name || '—'}</td><td className="message-cell">{job.text}</td><td><StatusPill status={job.status} /></td><td>{job.attempts}</td></tr>)}</tbody></table>{!queueJobs.length && <Empty icon={Inbox} title="Fila vazia" text="Os jobs aparecem quando um slot ativo é planejado." />}</div>{queueJobs.length > 0 && <div className="load-more-row"><span>Exibindo {queueJobs.length} de {queueMeta.total} jobs</span>{queueMeta.hasMore && <button className="secondary-button" onClick={loadMoreQueue} disabled={busy === 'queue-more'}>{busy === 'queue-more' ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}Carregar mais 10</button>}</div>}</section>}

        {tab === 'content' && <ContentPanel busy={busy} run={run} />}

        {tab === 'settings' && config && <SettingsPanel config={config} busy={busy} run={run} />}
      </div>}
    </main>

    {numberModal && <NumberModal busy={busy} onClose={() => setNumberModal(false)} onCreate={async (payload) => { const result = await run('create-number', () => api<any>('/api/numbers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })); if (result?.qrcode) { setQr({ name: payload.name, value: result.qrcode }); setNumberModal(false); } }} />}
    {slotModal && <SlotModal busy={busy} onClose={() => setSlotModal(false)} onCreate={async (payload) => { const result = await run('create-slot', () => api('/api/slots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), 'Slot criado.'); if (result) setSlotModal(false); }} />}
    {editNumber && <EditNumberModal number={editNumber} busy={busy} onClose={() => setEditNumber(null)} onSave={async (payload) => { const result = await run(`edit-number-${editNumber._id}`, () => api(`/api/numbers/${editNumber._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), 'Número atualizado.'); if (result) setEditNumber(null); }} />}
    {editSlot && <EditSlotModal slot={editSlot} busy={busy} onClose={() => setEditSlot(null)} onSave={async (payload) => { const result = await run(`edit-slot-${editSlot._id}`, () => api(`/api/slots/${editSlot._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), 'Slot atualizado.'); if (result) setEditSlot(null); }} />}
    {agendaSlot && <AgendaModal slot={agendaSlot} onClose={() => setAgendaSlot(null)} />}
    {qr && <Modal title={`Conectar ${qr.name}`} onClose={() => setQr(null)}><div className="qr-content"><img src={qr.value.startsWith('data:') ? qr.value : `data:image/png;base64,${qr.value}`} /><h3>Escaneie no WhatsApp</h3><p>Aparelhos conectados → Conectar aparelho. O painel reconhecerá a conexão automaticamente.</p></div></Modal>}
  </div>;
}

function NumberRow({ number }: { number: WarmNumber }) {
  return <div className="number-row"><div className="avatar small">{number.profilePicUrl ? <img src={number.profilePicUrl} /> : number.name[0]}</div><div className="number-main"><div><strong>{number.name}</strong><StatusPill status={number.warmupState} /></div><p>{formatPhone(number.phoneNumber)} · {profileLabel[number.profile]} · {number.warmupDays} dias · Saúde {number.healthScore}/100</p></div><div className="row-progress"><span>{number.progress}%</span><div><i style={{ width: `${number.progress}%` }} /></div></div></div>;
}

function Empty({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return <div className="empty"><Icon size={25} /><strong>{title}</strong><p>{text}</p></div>;
}

function SlotCard({ slot, numbers, busy, run, onEdit, onAgenda, onDelete }: { slot: WarmSlot; numbers: WarmNumber[]; busy: string; run: any; onEdit: (slot: WarmSlot) => void; onAgenda: (slot: WarmSlot) => void; onDelete: () => void }) {
  const assignedIds = slot.numberIds.map((item) => typeof item === 'string' ? item : item._id);
  const available = numbers.filter((number) => !assignedIds.includes(number._id));
  const members = numbers.filter((number) => assignedIds.includes(number._id));
  const [selected, setSelected] = useState('');
  return <article className="slot-card"><div className="slot-head"><div className="slot-icon"><Users size={18} /></div><div><h4>{slot.name}</h4><p>{profileLabel[slot.profile]} · {slot.durationDays} dias · {members.length} números</p></div><button className="icon-button" title="Ver agenda do slot" onClick={() => onAgenda(slot)}><CalendarDays size={15} /></button><button className="icon-button" title="Editar slot" onClick={() => onEdit(slot)}><Pencil size={15} /></button><button className="icon-button danger" title="Excluir slot" onClick={onDelete} disabled={slot.status === 'active'}><Trash2 size={15} /></button><StatusPill status={slot.status} /></div><div className="member-stack">{members.map((number) => <div className="member" key={number._id}><span>{number.name[0]}</span><div><strong>{number.name}</strong><small>{formatPhone(number.phoneNumber) || number.connectionState}</small></div><i className={number.connectionState === 'connected' ? 'online' : ''} /></div>)}{!members.length && <p className="muted">Adicione números ao slot.</p>}</div>{slot.status === 'draft' && <div className="assign-row"><select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Selecionar número</option>{available.map((number) => <option value={number._id} key={number._id}>{number.name}</option>)}</select><button disabled={!selected || busy === `assign-${slot._id}`} onClick={() => run(`assign-${slot._id}`, () => api(`/api/slots/${slot._id}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numberId: selected }) }), 'Número adicionado ao slot.').then(() => setSelected(''))}><Plus size={15} /></button></div>}<div className="slot-actions"><button className="secondary-button" onClick={() => onAgenda(slot)}><CalendarDays size={15} />Agenda</button>{slot.status === 'active' ? <button className="secondary-button danger" onClick={() => run(`pause-${slot._id}`, () => api(`/api/slots/${slot._id}/pause`, { method: 'POST' }), 'Slot pausado.')}><CirclePause size={15} />Pausar</button> : <button className="primary-button" disabled={members.length < 2} onClick={() => run(`start-${slot._id}`, () => api(`/api/slots/${slot._id}/start`, { method: 'POST' }))}>{busy === `start-${slot._id}` ? <Loader2 className="spin" size={15} /> : <Play size={15} />}Iniciar aquecimento</button>}</div></article>;
}

function AgendaModal({ slot, onClose }: { slot: WarmSlot; onClose: () => void }) {
  const [agenda, setAgenda] = useState<any | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<any>(`/api/slots/${slot._id}/agenda?limit=100`).then(setAgenda).catch((reason) => setError(reason.message));
  }, [slot._id]);
  const days = agenda?.days || [];
  return <Modal title={`Roadmap · ${slot.name}`} onClose={onClose}><div className="agenda-modal"><p className="panel-subtitle">Visão completa do cronograma. Cada coluna representa um dia de 24 horas a partir do instante em que o slot foi iniciado.</p>{error && <p className="inline-error">{error}</p>}{!agenda && !error && <div className="loading-state"><Loader2 className="spin" size={20} />Montando roadmap…</div>}{agenda && !days.length && <Empty icon={CalendarDays} title="Roadmap sem números" text="Adicione números ao slot para visualizar os envios." />}{days.length > 0 && <div className="roadmap-grid">{days.map((day: any) => <section className={`roadmap-day ${day.status}`} key={day.day}><div className="roadmap-day-head"><div><span> DIA {day.day}</span><strong>{new Date(day.date).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</strong></div><div><b>{day.totalMessages}</b><small>mensagens</small></div></div><p className="roadmap-limit">Até {day.limitPerNumber} por número · {day.status === 'current' ? 'em andamento' : day.status === 'completed' ? 'concluído' : 'programado'}</p><div className="roadmap-messages">{day.messages.map((message: any, index: number) => <div className="roadmap-message" key={`${day.day}-${index}`}><time>{new Date(message.runAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time><div><strong>{message.sender.name} → {message.recipient.name} · {message.kind}</strong><p>{message.kind === 'text' ? message.text : message.contentLabel || 'Mídia da biblioteca'}</p></div></div>)}</div></section>)}</div>}</div></Modal>;
}

function NumberModal({ busy, onClose, onCreate }: { busy: string; onClose: () => void; onCreate: (payload: any) => void }) {
  const [name, setName] = useState(''); const [owned, setOwned] = useState(false);
  return <Modal title="Conectar novo número" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onCreate({ name, ownedAndAuthorized: owned }); }} className="form"><label>Nome da linha<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Comercial 02" required /></label><div className="info-box"><CalendarDays size={17} /><p>A intensidade e o cronograma serão definidos no slot depois que o número estiver conectado.</p></div><label className="check"><input type="checkbox" checked={owned} onChange={(event) => setOwned(event.target.checked)} /><span>Confirmo que este número é próprio ou autorizado e será usado somente com outros números do mesmo ambiente.</span></label><div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!owned || busy === 'create-number'}>{busy === 'create-number' ? <Loader2 className="spin" size={16} /> : <QrCode size={16} />}Criar e gerar QR</button></div></form></Modal>;
}

function SlotModal({ busy, onClose, onCreate }: { busy: string; onClose: () => void; onCreate: (payload: any) => void }) {
  const [name, setName] = useState(''); const [profile, setProfile] = useState<Profile>('light'); const [durationDays, setDurationDays] = useState(7);
  return <Modal title="Criar slot de aquecimento" onClose={onClose}><form className="form" onSubmit={(event) => { event.preventDefault(); onCreate({ name, profile, durationDays }); }}><label>Nome do slot<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Slot Norte 01" required /></label><label>Intensidade<select value={profile} onChange={(event) => setProfile(event.target.value as Profile)}><option value="light">Leve · crescimento gradual</option><option value="moderate">Moderado · ritmo intermediário</option><option value="intensive">Intenso controlado · limite maior</option><option value="aggressive">Agressivo controlado · até 48/dia</option></select><small>O limite aumenta progressivamente. Use o agressivo somente em números próprios e autorizados.</small></label><label><span className="form-label">Cronograma</span><select value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))}><option value={7}>7 dias · recomendado</option><option value={14}>14 dias · gradual</option><option value={30}>30 dias · conservador</option></select><small>O primeiro dia começa no instante em que você clicar em iniciar; cada dia dura 24 horas.</small></label><div className="info-box"><CalendarDays size={17} /><p>O slot começa com dois números conectados e distribui conversas somente entre os membros.</p></div><div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy === 'create-slot'}>{busy === 'create-slot' && <Loader2 className="spin" size={16} />}Criar slot</button></div></form></Modal>;
}

function EditNumberModal({ number, busy, onClose, onSave }: { number: WarmNumber; busy: string; onClose: () => void; onSave: (payload: any) => void }) {
  const [name, setName] = useState(number.name);
  return <Modal title="Editar número" onClose={onClose}><form className="form" onSubmit={(event) => { event.preventDefault(); onSave({ name }); }}><label>Nome exibido<input value={name} onChange={(event) => setName(event.target.value)} required /></label><div className="info-box"><Smartphone size={17} /><p>O telefone real é controlado pela UazAPI e não é alterado manualmente. Aqui você edita o nome usado no painel.</p></div><div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy === `edit-number-${number._id}`}>{busy === `edit-number-${number._id}` && <Loader2 className="spin" size={16} />}Salvar</button></div></form></Modal>;
}

function EditSlotModal({ slot, busy, onClose, onSave }: { slot: WarmSlot; busy: string; onClose: () => void; onSave: (payload: any) => void }) {
  const [name, setName] = useState(slot.name); const [profile, setProfile] = useState<Profile>(slot.profile); const [durationDays, setDurationDays] = useState<7 | 14 | 30>(slot.durationDays || 7);
  return <Modal title="Editar slot" onClose={onClose}><form className="form" onSubmit={(event) => { event.preventDefault(); onSave({ name, profile, durationDays }); }}><label>Nome do slot<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Intensidade<select value={profile} onChange={(event) => setProfile(event.target.value as Profile)}><option value="light">Leve · crescimento gradual</option><option value="moderate">Moderado · ritmo intermediário</option><option value="intensive">Intenso controlado · limite maior</option><option value="aggressive">Agressivo controlado · até 48/dia</option></select></label><label>Cronograma<select value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value) as 7 | 14 | 30)}><option value={7}>7 dias · recomendado</option><option value={14}>14 dias · gradual</option><option value={30}>30 dias · conservador</option></select></label><div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy === `edit-slot-${slot._id}`}>{busy === `edit-slot-${slot._id}` && <Loader2 className="spin" size={16} />}Salvar alterações</button></div></form></Modal>;
}

function ContentPanel({ busy, run }: { busy: string; run: any }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [kind, setKind] = useState<ContentKind>('text');
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const load = () => api<ContentItem[]>('/api/content').then(setItems).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const createRemote = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await run('content-create', () => api('/api/content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, label, text, url }) }), 'Conteúdo adicionado.');
    if (result) { setLabel(''); setText(''); setUrl(''); await load(); }
  };
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    const body = new FormData(); body.append('kind', kind); body.append('label', label); body.append('file', file);
    const result = await run('content-upload', () => api('/api/content/upload', { method: 'POST', body }), 'Arquivo adicionado.');
    if (result) { setLabel(''); setFile(null); await load(); }
  };
  const kindLabel: Record<ContentKind, string> = { text: 'Texto', audio: 'Áudio', image: 'Imagem', video: 'Vídeo', sticker: 'Figurinha' };
  return <section className="panel full content-panel"><div className="panel-head"><div><p className="eyebrow">BIBLIOTECA DE AQUECIMENTO</p><h3>Conteúdo e mídias</h3><p className="panel-subtitle">O scheduler mistura texto, áudio, imagem, vídeo e figurinha conforme o dia do perfil, com fallback para texto quando não houver mídia.</p></div><Library size={19} /></div><div className="content-forms"><form className="form content-form" onSubmit={createRemote}><h4>Adicionar por URL ou texto</h4><label>Tipo<select value={kind} onChange={(event) => setKind(event.target.value as ContentKind)}>{Object.entries(kindLabel).map(([value, labelValue]) => <option value={value} key={value}>{labelValue}</option>)}</select></label><label>Nome<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Foto do produto 01" required /></label>{kind === 'text' ? <label>Texto<textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Mensagem usada nas conversas" required /></label> : <label>URL pública HTTPS<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://cdn.seudominio.com/midia.jpg" required /></label>}<button className="primary-button" disabled={busy === 'content-create'}>{busy === 'content-create' ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}Adicionar conteúdo</button></form><form className="form content-form" onSubmit={upload}><h4>Enviar arquivo</h4><label>Tipo de mídia<select value={kind === 'text' ? 'image' : kind} onChange={(event) => setKind(event.target.value as ContentKind)}><option value="image">Imagem</option><option value="video">Vídeo</option><option value="audio">Áudio</option><option value="sticker">Figurinha</option></select></label><label>Nome<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Áudio conversa 01" required /></label><label className="file-input">Arquivo<input type="file" accept="image/*,video/*,audio/*" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label><small>O arquivo precisa ficar acessível pela URL pública do aquecedor para a UazAPI baixá-lo.</small><button className="secondary-button" disabled={!file || busy === 'content-upload'}>{busy === 'content-upload' ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}Enviar para biblioteca</button></form></div><div className="content-grid">{items.map((item) => <article className="content-card" key={item._id}><div className="content-card-head"><span className={`content-kind ${item.kind}`}>{kindLabel[item.kind]}</span><button className="icon-button danger" title="Remover conteúdo" onClick={() => { if (window.confirm(`Remover ${item.label}?`)) void run(`content-delete-${item._id}`, () => api(`/api/content/${item._id}`, { method: 'DELETE' }), 'Conteúdo removido.').then(load); }}><Trash2 size={15} /></button></div><h4>{item.label}</h4>{item.kind === 'text' ? <p>{item.text}</p> : <a href={item.url} target="_blank" rel="noreferrer">{item.fileName || item.url}</a>}<small>{item.usageCount || 0} usos · {item.active ? 'ativo' : 'pausado'}</small></article>)}{!items.length && <Empty icon={Library} title="Biblioteca vazia" text="Adicione textos ou mídias para o scheduler poder variar as ações." />}</div></section>;
}

function SettingsPanel({ config, busy, run }: { config: Config; busy: string; run: any }) {
  const [form, setForm] = useState({ ...config, adminToken: '' });
  useEffect(() => setForm({ ...config, adminToken: '' }), [config]);
  const update = (key: string, value: any) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="settings-grid"><section className="panel"><div className="panel-head"><div><p className="eyebrow">INTEGRAÇÃO</p><h3>Servidor UazAPI</h3></div><Server size={19} /></div><form className="form" onSubmit={(event) => { event.preventDefault(); run('save-config', () => api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }), 'Configuração salva.'); }}><label>Server URL<input value={form.serverUrl} onChange={(event) => update('serverUrl', event.target.value)} placeholder="https://seu-servidor.uazapi.com" /></label><label>Admin Token<input type="password" value={form.adminToken} onChange={(event) => update('adminToken', event.target.value)} placeholder={config.hasAdminToken ? 'Token salvo — deixe vazio para manter' : 'Cole o admin token'} /></label><label>URL pública do aquecedor<input value={form.publicBaseUrl} onChange={(event) => update('publicBaseUrl', event.target.value)} placeholder="https://aquecedor.seudominio.com" /><small>Webhook: {form.publicBaseUrl ? `${form.publicBaseUrl.replace(/\/$/, '')}/api/webhooks/uazapi` : 'configure uma URL HTTPS'}</small></label><div className="form-actions left"><button type="button" className="secondary-button" onClick={() => run('test-config', () => api('/api/config/test', { method: 'POST' }))}>{busy === 'test-config' ? <Loader2 className="spin" size={16} /> : <Radio size={16} />}Testar servidor</button><button className="primary-button">Salvar integração</button></div></form></section><section className="panel"><div className="panel-head"><div><p className="eyebrow">SEGURANÇA OPERACIONAL</p><h3>Fila e descanso</h3></div><ShieldCheck size={19} /></div><div className="form"><label>Início do descanso<select value={form.quietStartHour} onChange={(event) => update('quietStartHour', Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label><label>Fim do descanso<select value={form.quietEndHour} onChange={(event) => update('quietEndHour', Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label><label>Concorrência do worker<select value={form.workerConcurrency} onChange={(event) => update('workerConcurrency', Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value} envio{value > 1 ? 's' : ''} simultâneo{value > 1 ? 's' : ''}</option>)}</select></label><div className="database-card"><BarChart3 size={18} /><div><span>Banco dedicado</span><strong>{config.databaseName}</strong></div></div><div className="database-card"><Inbox size={18} /><div><span>Fila RabbitMQ</span><strong>{config.rabbitMqEnabled ? 'Configurada no ambiente' : 'Fallback MongoDB ativo'}</strong></div></div><button className="primary-button" onClick={() => run('save-queue', () => api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quietStartHour: form.quietStartHour, quietEndHour: form.quietEndHour, workerConcurrency: form.workerConcurrency }) }), 'Política da fila atualizada.')}>Salvar política</button></div></section></div>;
}
