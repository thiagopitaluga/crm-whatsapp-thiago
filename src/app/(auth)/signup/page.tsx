"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrganiZAPLogo } from "@/components/brand/organizap-logo";
import {
  ArrowRight,
  CheckCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function AuthBackground({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative isolate flex min-h-[100svh] overflow-hidden bg-[#020706] px-5 py-6 text-white sm:px-8 sm:py-10 lg:items-center lg:px-12 xl:px-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(rgba(110, 231, 183, 0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(110, 231, 183, 0.055) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
          maskImage: "radial-gradient(ellipse at center, black 10%, transparent 74%)",
        }}
      />
      <div className="pointer-events-none absolute -left-32 top-[14%] -z-10 h-80 w-80 rounded-full bg-emerald-400/20 blur-[110px]" />
      <div className="pointer-events-none absolute -right-20 bottom-[-12%] -z-10 h-96 w-96 rounded-full bg-lime-300/10 blur-[130px]" />
      {children}
    </main>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query so it survives the signup → email
  // verification → redirect round-trip. `emailRedirectTo` below
  // points back at /join/<token> so the user lands on the redeem
  // step after verifying instead of being dropped on /dashboard.
  const inviteToken = searchParams.get("invite");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emailAlreadyRegistered, setEmailAlreadyRegistered] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEmailAlreadyRegistered(false);

    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);

    // If we have an invite token, point Supabase's verification
    // email back at the join page so the user can accept after
    // verifying. Without a token, Supabase uses its default
    // redirect (the app root).
    const emailRedirectTo = inviteToken
      ? `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`
      : undefined;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });

    if (error) {
      const isExistingEmail = /already registered|already exists|email.*exists/i.test(error.message);
      setEmailAlreadyRegistered(isExistingEmail);
      setError(
        isExistingEmail
          ? "Este e-mail já possui uma conta. Entre ou redefina a senha para continuar."
          : error.message,
      );
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <AuthBackground>
        <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-[28px] border border-white/[0.13] bg-[#07100c]/80 p-6 shadow-[0_32px_100px_rgba(0,0,0,0.48)] backdrop-blur-2xl sm:p-8">
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
          <div className="relative text-center">
            <span className="inline-flex rounded-xl bg-white px-3 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
              <OrganiZAPLogo className="h-8 w-32" priority />
            </span>
            <div className="mx-auto mt-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-300 text-slate-950">
              <CheckCircle className="h-6 w-6" />
            </div>
            <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-white">
              Verifique seu e-mail
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Enviamos um link de confirmação para <span className="font-medium text-white">{email}</span>. Verifique sua caixa de entrada e clique no link para concluir o cadastro.
            </p>
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : "/login"
              }
              className="mt-7 block"
            >
              <Button className="h-11 w-full bg-emerald-300 font-semibold text-slate-950 hover:bg-emerald-200">
                Voltar para entrar
              </Button>
            </Link>
          </div>
        </div>
      </AuthBackground>
    );
  }

  return (
    <AuthBackground>
      <section className="mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(420px,0.72fr)] lg:items-center lg:gap-20">
        <div className="hidden max-w-xl lg:block">
          <div className="inline-flex rounded-xl bg-white px-3 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
            <OrganiZAPLogo className="h-9 w-36" priority />
          </div>
          <div className="mt-20">
            <p className="text-xs font-semibold tracking-[0.18em] text-emerald-300">COMECE COM O CRM</p>
            <h1 className="mt-5 max-w-lg text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-white xl:text-5xl">
              Organize suas vendas desde a primeira conversa.
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-slate-300">
              Centralize contatos, oportunidades e atendimento pelo WhatsApp em um só lugar.
            </p>
          </div>
          <div className="mt-10 grid max-w-lg gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-4 backdrop-blur-sm">
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
              <p className="mt-3 text-sm font-medium text-white">Sua empresa começa protegida</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-4 backdrop-blur-sm">
              <Sparkles className="h-5 w-5 text-lime-200" />
              <p className="mt-3 text-sm font-medium text-white">Pronto para o seu processo comercial</p>
            </div>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[30rem] overflow-hidden rounded-[28px] border border-white/[0.13] bg-[#07100c]/80 p-5 shadow-[0_32px_100px_rgba(0,0,0,0.48),0_8px_30px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:p-8">
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
          <div className="relative">
            <div className="lg:hidden">
              <span className="inline-flex rounded-xl bg-white px-2.5 py-1.5 shadow-[0_10px_22px_rgba(0,0,0,0.18)]">
                <OrganiZAPLogo className="h-7 w-28" priority />
              </span>
            </div>

            <div className="mt-7 flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-emerald-300 lg:mt-0">
              <LockKeyhole className="h-3.5 w-3.5" />
              {inviteToken ? "CONVITE PARA EQUIPE" : "NOVA CONTA"}
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-white">
              {inviteToken ? "Criar conta e entrar" : "Crie sua conta"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {inviteToken
                ? "Confirme seu e-mail para aceitar o convite e entrar na equipe."
                : "Leva apenas alguns instantes para começar a organizar sua operação."}
            </p>

            <form onSubmit={handleSignup} className="mt-7 flex flex-col gap-4">
              {error && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm leading-5 text-red-200">
                  <p>{error}</p>
                  {emailAlreadyRegistered && (
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                      <Link
                        href={
                          inviteToken
                            ? `/login?invite=${encodeURIComponent(inviteToken)}`
                            : "/login"
                        }
                        className="font-medium text-emerald-200 hover:text-emerald-100"
                      >
                        Entrar na conta
                      </Link>
                      <Link href="/forgot-password" className="font-medium text-emerald-200 hover:text-emerald-100">
                        Redefinir senha
                      </Link>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="fullName" className="text-sm font-medium text-slate-200">Nome completo</Label>
                <Input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  placeholder="João Silva"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="h-11 border-white/10 bg-white/[0.055] px-4 text-base text-white placeholder:text-slate-500 focus-visible:border-emerald-300 focus-visible:ring-emerald-300/20"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-sm font-medium text-slate-200">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="voce@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11 border-white/10 bg-white/[0.055] px-4 text-base text-white placeholder:text-slate-500 focus-visible:border-emerald-300 focus-visible:ring-emerald-300/20"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password" className="text-sm font-medium text-slate-200">Senha</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Mínimo 6 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-11 border-white/10 bg-white/[0.055] px-4 text-base text-white placeholder:text-slate-500 focus-visible:border-emerald-300 focus-visible:ring-emerald-300/20"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="confirmPassword" className="text-sm font-medium text-slate-200">Confirmar senha</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repita a senha"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="h-11 border-white/10 bg-white/[0.055] px-4 text-base text-white placeholder:text-slate-500 focus-visible:border-emerald-300 focus-visible:ring-emerald-300/20"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="group mt-2 h-12 w-full bg-emerald-300 text-base font-semibold text-slate-950 shadow-[0_12px_28px_rgba(52,211,153,0.16)] transition-all hover:bg-emerald-200 hover:shadow-[0_16px_34px_rgba(52,211,153,0.24)] disabled:opacity-50"
              >
                {loading ? "Criando conta..." : "Criar conta"}
                {!loading && <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-400">
              Já tem uma conta? {" "}
              <Link
                href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : "/login"}
                className="font-semibold text-emerald-300 transition-colors hover:text-emerald-200"
              >
                Entrar
              </Link>
            </p>
          </div>
        </div>
      </section>
    </AuthBackground>
  );
}
