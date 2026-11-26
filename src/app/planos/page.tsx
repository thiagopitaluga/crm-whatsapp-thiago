import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRight,
  MessageCircle,
  Camera,
  LayoutDashboard,
} from 'lucide-react';
import { PlanComparison } from '@/components/settings/plan-comparison';

export const metadata: Metadata = {
  title: 'Organizap | Seu próximo cliente merece uma resposta',
  description:
    'Organize leads, acompanhe vendas e automatize conversas no WhatsApp e Instagram. Planos a partir de R$ 57 por mês por empresa.',
};

export default function PlansPage() {
  return (
    <main className="min-h-screen bg-[#f5f5ee] text-[#24301d]">
      <nav className="mx-auto flex max-w-6xl items-center justify-between border-b border-[#d9dfce] px-6 py-7">
        <Link href="/planos" className="text-2xl font-extrabold tracking-tight">
          Organizap<span className="text-[#6c903c]">●</span>
        </Link>
        <div className="flex gap-6 text-sm">
          <a href="#planos">Planos</a>
          <Link href="/login">Entrar</Link>
        </div>
      </nav>
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-20 lg:grid-cols-2 lg:py-28">
        <div>
          <p className="mb-6 text-xs font-semibold tracking-[0.18em]">
            DO PRIMEIRO OLÁ AO NEGÓCIO FECHADO
          </p>
          <h1 className="text-5xl leading-[1.06] font-bold tracking-tight sm:text-6xl">
            Seu próximo cliente merece uma{' '}
            <em className="font-serif font-normal text-[#607c38]">resposta.</em>
          </h1>
          <p className="mt-7 max-w-lg text-lg text-[#66705d]">
            Conversa perdida, follow-up esquecido, lead sem responsável. Coloque
            sua operação de vendas em ordem com o Organizap.
          </p>
          <a
            href="#planos"
            className="mt-8 inline-flex items-center gap-4 rounded-lg bg-[#c6f07a] px-6 py-4 font-semibold transition-colors hover:bg-[#b5e360]"
          >
            Encontrar meu plano <ArrowRight size={19} />
          </a>
          <p className="mt-4 text-xs text-[#75806a]">
            A partir de R$ 57/mês por empresa. Até 2 usuários no Essencial.
          </p>
        </div>
        <div className="rounded-2xl border border-[#46573c] bg-[#26331f] p-6 text-white shadow-2xl shadow-[#31442220] lg:-rotate-2">
          <div className="mb-7 flex items-center justify-between gap-3 text-sm">
            <strong>Seu comercial, organizado.</strong>
            <span className="text-xs text-[#c6f07a]">WhatsApp + CRM</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Novo lead', 'Primeiro contato', 'WhatsApp'],
              ['Atendimento', 'Proposta enviada', 'Follow-up'],
              ['Fechamento', 'Negociação', 'Próximo passo'],
            ].map(([stage, title, tag]) => (
              <div key={stage}>
                <p className="mb-3 min-h-8 text-xs text-[#c6f07a]">{stage}</p>
                <div className="min-h-40 rounded-lg border border-[#4b5b3e] bg-[#35442b] p-3">
                  <span className="mb-5 block h-7 w-7 rounded-full bg-[#596d47]" />
                  <strong className="text-xs">{title}</strong>
                  <p className="mt-5 text-[10px] text-[#bccfaa]">{tag}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-7 text-xs text-[#c4d4b6]">
            A conversa e o próximo passo, no mesmo lugar.
          </p>
          <p className="mt-3 text-[10px] text-[#93a684]">
            Exemplo ilustrativo de um funil.
          </p>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-9 px-6 pb-20 md:grid-cols-3">
        {[
          {
            icon: LayoutDashboard,
            title: 'Saiba quem precisa de você.',
            text: 'Funis, tarefas, notas e responsáveis para acompanhar cada oportunidade.',
          },
          {
            icon: Camera,
            title: 'Transforme interesse em conversa.',
            text: 'No Pro, reúna Instagram e WhatsApp e monte automações para sua operação.',
          },
          {
            icon: MessageCircle,
            title: 'Dê continuidade ao atendimento.',
            text: 'Configure agentes com o contexto da empresa e use sua própria chave de API de IA.',
          },
        ].map(({ icon: Icon, title, text }) => (
          <article key={title}>
            <Icon className="mb-5 text-[#6a8646]" />
            <h2 className="mb-3 text-lg font-semibold">{title}</h2>
            <p className="text-[#66705d]">{text}</p>
          </article>
        ))}
      </section>
      <section id="planos" className="mx-auto max-w-6xl scroll-mt-8 px-6 py-16">
        <p className="text-center text-xs tracking-widest">
          UM PLANO PARA O SEU MOMENTO
        </p>
        <h2 className="my-5 text-center text-4xl font-bold tracking-tight">
          Comece organizado.
          <br />
          Cresça com espaço.
        </h2>
        <p className="mb-10 text-center text-[#66705d]">
          Escolha pela estrutura da sua equipe.
        </p>
        <PlanComparison commercial />
        <p className="mt-6 text-center text-xs text-[#66705d]">
          O cadastro inicia sua conta no CRM. A contratação depende da ativação
          da cobrança.
        </p>
      </section>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="mb-6 text-3xl font-semibold">Antes de começar</h2>
        {[
          [
            'O preço é por usuário?',
            'A mensalidade é por empresa. O Essencial inclui até 2 usuários, o Pro até 5 e o Ilimitado permite usuários ilimitados.',
          ],
          [
            'Posso conectar meu Instagram?',
            'Sim. A conexão com perfis profissionais e as automações de Instagram estão disponíveis a partir do Pro, mediante autorização dos acessos na Meta.',
          ],
          [
            'Como funciona a inteligência artificial?',
            'Você cadastra a chave de API da sua empresa e configura seus agentes. O provedor de IA cobra o consumo diretamente na sua conta.',
          ],
          [
            'O que está ilimitado?',
            'Contatos, negócios, tarefas, notas e os demais recursos incluídos no plano. No Ilimitado, também há usuários, WhatsApps, perfis de Instagram e funis ilimitados. Serviços externos mantêm seus próprios limites técnicos.',
          ],
        ].map(([q, a]) => (
          <details key={q} className="border-b border-[#d9dfce] py-5">
            <summary className="cursor-pointer font-medium">{q}</summary>
            <p className="mt-4 text-[#66705d]">{a}</p>
          </details>
        ))}
      </section>
      <section className="bg-[#26331f] px-6 py-20 text-center text-white">
        <h2 className="text-4xl font-semibold tracking-tight">
          O próximo passo do seu lead
          <br />
          pode começar aqui.
        </h2>
        <a
          href="#planos"
          className="mt-8 inline-flex items-center gap-4 rounded-lg bg-[#c6f07a] px-6 py-4 font-semibold text-[#26331f]"
        >
          Escolher meu plano <ArrowRight size={18} />
        </a>
      </section>
      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-5 px-6 py-9 text-sm text-[#66705d]">
        <span>Organizap</span>
        <span>Conversas que avançam. Vendas organizadas.</span>
        <Link href="/login">Acessar minha conta</Link>
      </footer>
    </main>
  );
}
