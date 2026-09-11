"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrganiZAPLogo } from "@/components/brand/organizap-logo";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, card frame) while the form hydrates with the query
// string on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("LoginPage");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Full-page navigation so the fresh Supabase session cookies reach
    // middleware before the protected dashboard is requested.
    const destination = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : "/dashboard";
    window.location.href = destination;
  };

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

      <section className="mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(420px,0.72fr)] lg:items-center lg:gap-20">
        <div className="hidden max-w-xl lg:block">
          <div className="inline-flex rounded-xl bg-white px-3 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
            <OrganiZAPLogo className="h-9 w-36" priority />
          </div>

          <div className="mt-20">
            <p className="text-xs font-semibold tracking-[0.18em] text-emerald-300">
              {t("portalLabel")}
            </p>
            <h1 className="mt-5 max-w-lg text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-white xl:text-5xl">
              {t("heroTitle")}
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-slate-300">
              {t("heroDescription")}
            </p>
          </div>

          <div className="mt-10 grid max-w-lg gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-4 backdrop-blur-sm">
              <ShieldCheck className="h-5 w-5 text-emerald-300" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-white">{t("benefitSecure")}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-4 backdrop-blur-sm">
              <Sparkles className="h-5 w-5 text-lime-200" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-white">{t("benefitFocused")}</p>
            </div>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[30rem] overflow-hidden rounded-[28px] border border-white/[0.13] bg-[#07100c]/80 p-5 shadow-[0_32px_100px_rgba(0,0,0,0.48),0_8px_30px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:p-8">
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />

          <div className="relative">
            <div className="flex items-center gap-3 lg:hidden">
              <span className="rounded-xl bg-white px-2.5 py-1.5 shadow-[0_10px_22px_rgba(0,0,0,0.18)]">
                <OrganiZAPLogo className="h-7 w-28" priority />
              </span>
            </div>

            <div className="mt-7 flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-emerald-300 lg:mt-0">
              <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
              {t("secureAccess")}
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-white">
              {inviteToken ? t("titleAccept") : t("titleWelcome")}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {inviteToken ? t("descAccept") : t("formDescription")}
            </p>

            <form onSubmit={handleLogin} className="mt-8 flex flex-col gap-5">
              {error && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-sm font-medium text-slate-200">
                  {t("emailLabel")}
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder={t("emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12 border-white/10 bg-white/[0.055] px-4 text-base text-white placeholder:text-slate-500 focus-visible:border-emerald-300 focus-visible:ring-emerald-300/20"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="password" className="text-sm font-medium text-slate-200">
                    {t("passwordLabel")}
                  </Label>
                  <Link
                    href="/forgot-password"
                    className="text-sm font-medium text-emerald-300 transition-colors hover:text-emerald-200"
                  >
                    {t("forgotPassword")}
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder={t("passwordPlaceholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-12 border-white/10 bg-white/[0.055] px-4 pr-12 text-base text-white placeholder:text-slate-500 focus-visible:border-emerald-300 focus-visible:ring-emerald-300/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="group mt-1 h-12 w-full bg-emerald-300 text-base font-semibold text-slate-950 shadow-[0_12px_28px_rgba(52,211,153,0.16)] transition-all hover:bg-emerald-200 hover:shadow-[0_16px_34px_rgba(52,211,153,0.24)] disabled:opacity-50"
              >
                {loading ? t("signingIn") : t("signIn")}
                {!loading && <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
              </Button>
            </form>

            <p className="mt-7 text-center text-sm text-slate-400">
              {t("noAccount")} {" "}
              <Link
                href={
                  inviteToken
                    ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                    : "/signup"
                }
                className="font-semibold text-emerald-300 transition-colors hover:text-emerald-200"
              >
                {t("createAccount")}
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
