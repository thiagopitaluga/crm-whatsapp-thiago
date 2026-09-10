"use client";

import { Check, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LOCALE_COOKIE = "wacrm.locale";

const options = [
  { locale: "pt-BR", code: "PT", labelKey: "portuguese" },
  { locale: "en", code: "EN", labelKey: "english" },
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
        className="flex h-10 items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none data-popup-open:bg-muted sm:px-2.5"
        aria-label={t("menuLabel")}
        title={t("menuLabel")}
      >
        <Languages className="h-4 w-4" />
        <span>{current.code}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.locale}
            onClick={() => changeLocale(option.locale)}
            className="justify-between text-popover-foreground focus:bg-accent focus:text-accent-foreground"
          >
            {t(option.labelKey)}
            {locale === option.locale ? <Check className="h-4 w-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
