"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LOCALE_COOKIE = "wacrm.locale";

const options = [
  { locale: "pt-BR", flag: "/flags/br.svg", labelKey: "portuguese", flagAlt: "Brasil" },
  { locale: "en", flag: "/flags/us.svg", labelKey: "english", flagAlt: "United States" },
] as const;

/** Per-browser language picker for the CRM header. */
export function LanguageToggle() {
  const locale = useLocale();
  const t = useTranslations("LanguageToggle");
  const current = options.find((option) => option.locale === locale) ?? options[0];

  function changeLocale(nextLocale: "pt-BR" | "en") {
    if (nextLocale === locale) return;

    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-10 w-10 items-center justify-center rounded-md text-base transition-colors hover:bg-muted focus:outline-none data-popup-open:bg-muted"
        aria-label={t("menuLabel")}
        title={t("menuLabel")}
      >
        <img src={current.flag} alt={current.flagAlt} className="h-5 w-7 rounded-sm object-cover shadow-sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.locale}
            onClick={() => changeLocale(option.locale)}
            className="justify-between text-popover-foreground focus:bg-accent focus:text-accent-foreground"
          >
            <img src={option.flag} alt="" className="mr-2 h-4 w-6 rounded-sm object-cover shadow-sm" />
            <span className="flex-1">{t(option.labelKey)}</span>
            {locale === option.locale ? <Check className="h-4 w-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
