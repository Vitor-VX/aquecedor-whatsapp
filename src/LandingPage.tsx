import {
  Activity, ArrowRight, CalendarDays, CheckCircle2, Clock3, Flame, Layers3,
  MessageCircle, QrCode, ShieldCheck, Sparkles, Users,
} from 'lucide-react';

const features = [
  { icon: CalendarDays, title: 'Cronograma progressivo', text: 'Escolha 7, 14 ou 30 dias. O limite cresce gradualmente conforme o perfil escolhido.' },
  { icon: Layers3, title: 'Slots privados', text: 'Organize pares de números próprios em ambientes separados, com fila e métricas por slot.' },
  { icon: Activity, title: 'Operação observável', text: 'Acompanhe conexão, progresso, mensagens, falhas e eventos recentes em um único painel.' },
  { icon: QrCode, title: 'Conexão por QR Code', text: 'Conecte e reconecte instâncias UazAPI sem perder o controle do ciclo de operação.' },
  { icon: Clock3, title: 'Fila durável', text: 'Envios planejados no MongoDB, com pausa global, descanso noturno e retry controlado.' },
  { icon: ShieldCheck, title: 'Uso responsável', text: 'O sistema trabalha com números próprios ou autorizados e não promete burlar políticas.' },
];

const plans = [
  { days: '7 dias', label: 'Recomendado', text: 'Evolução mais rápida para o primeiro ciclo de aquecimento.', tone: 'featured' },
  { days: '14 dias', label: 'Gradual', text: 'Crescimento mais espaçado para operações que preferem ritmo moderado.', tone: '' },
  { days: '30 dias', label: 'Conservador', text: 'Ciclo longo para distribuir a progressão ao máximo.', tone: '' },
];

export default function LandingPage() {
  return <div className="landing-page">
    <header className="landing-nav"><a className="landing-brand" href="/"><span><Flame size={19} /></span><strong>WarmFlow</strong></a><nav><a href="#recursos">Recursos</a><a href="#como-funciona">Como funciona</a><a href="#cronogramas">Cronogramas</a></nav><a className="secondary-button landing-login" href="/app">Abrir painel <ArrowRight size={15} /></a></header>

    <main>
      <section className="landing-hero"><div className="landing-hero-copy"><p className="eyebrow green"><Sparkles size={13} /> AQUECIMENTO CONTROLADO</p><h1>Mais clareza para amadurecer seus números.</h1><p className="landing-lead">Conecte números próprios, organize slots e acompanhe um cronograma progressivo em uma operação simples, observável e responsável.</p><div className="landing-actions"><a className="primary-button" href="/app">Abrir o painel <ArrowRight size={16} /></a><a className="landing-text-link" href="#como-funciona">Ver como funciona</a></div><div className="landing-proof"><span><CheckCircle2 size={15} /> Sem mensalidade obrigatória</span><span><CheckCircle2 size={15} /> Banco dedicado</span><span><CheckCircle2 size={15} /> UazAPI</span></div></div><div className="landing-visual"><div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" /><div className="landing-dashboard-card"><div className="mini-card-top"><div><span className="mini-eyebrow">PAINEL DE MATURAÇÃO</span><strong>Operação em andamento</strong></div><span className="mini-live"><i /> online</span></div><div className="mini-score"><div><span>Progresso do slot</span><strong>68%</strong><small>dia 5 de 7</small></div><div className="mini-ring"><b>68</b></div></div><div className="mini-bars"><span style={{ '--bar': '42%' } as any}><i /></span><span style={{ '--bar': '64%' } as any}><i /></span><span style={{ '--bar': '82%' } as any}><i /></span><span style={{ '--bar': '58%' } as any}><i /></span></div><div className="mini-footer"><span><Users size={13} /> 4 números</span><span><MessageCircle size={13} /> 38 eventos</span></div></div></div></section>

      <section id="recursos" className="landing-section"><div className="section-intro"><p className="eyebrow green">RECURSOS</p><h2>O essencial para operar sem adivinhação.</h2><p>Uma base enxuta para conectar, planejar, acompanhar e ajustar o aquecimento dos seus próprios números.</p></div><div className="feature-grid">{features.map(({ icon: Icon, title, text }) => <article className="feature-card" key={title}><span className="feature-icon"><Icon size={19} /></span><h3>{title}</h3><p>{text}</p></article>)}</div></section>

      <section id="como-funciona" className="landing-section steps-section"><div className="section-intro"><p className="eyebrow green">COMO FUNCIONA</p><h2>Do QR Code ao acompanhamento diário.</h2><p>O fluxo foi desenhado para começar pequeno e crescer com dados reais da operação.</p></div><div className="steps-grid"><article><b>01</b><QrCode size={22} /><h3>Conecte</h3><p>Crie uma instância UazAPI e pareie o número pelo QR Code.</p></article><article><b>02</b><Layers3 size={22} /><h3>Organize</h3><p>Monte um slot com números autorizados e escolha perfil e duração.</p></article><article><b>03</b><Activity size={22} /><h3>Acompanhe</h3><p>Libere a fila, observe os eventos e ajuste o ritmo quando necessário.</p></article></div></section>

      <section id="cronogramas" className="landing-section schedule-section"><div className="section-intro"><p className="eyebrow green">CRONOGRAMAS</p><h2>Um ritmo para cada operação.</h2><p>Todos os perfis crescem gradualmente. A diferença está no espaçamento e no volume de cada etapa.</p></div><div className="schedule-grid">{plans.map((plan) => <article className={`schedule-card ${plan.tone}`} key={plan.days}><span>{plan.label}</span><strong>{plan.days}</strong><p>{plan.text}</p><a href="/app">Escolher no painel <ArrowRight size={14} /></a></article>)}</div></section>

      <section className="landing-safety"><div><ShieldCheck size={24} /><div><p className="eyebrow green">OPERAÇÃO RESPONSÁVEL</p><h2>Transparência antes de promessa.</h2><p>O WarmFlow não garante imunidade contra bloqueios. Ele oferece controle, limites, pausas e rastreabilidade para você operar números próprios de forma consciente.</p></div></div><a className="primary-button" href="/app">Conhecer o painel <ArrowRight size={16} /></a></section>
    </main>
    <footer className="landing-footer"><span>WarmFlow · Aquecedor de números</span><span>Feito para operações próprias e autorizadas.</span></footer>
  </div>;
}
