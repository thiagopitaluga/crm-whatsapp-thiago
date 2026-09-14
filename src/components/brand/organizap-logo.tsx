import Image from "next/image";
import { cn } from "@/lib/utils";

interface OrganiZAPLogoProps {
  className?: string;
  priority?: boolean;
  size?: "sm" | "md" | "lg";
  /** Use when the mark sits on a deliberately dark surface outside the app theme. */
  onDark?: boolean;
  compact?: boolean;
}

const sizeClasses = {
  sm: "h-7 w-24",
  md: "h-9 w-32",
  lg: "h-12 w-44",
};

/** The consistent product mark used across product screens and navigation. */
export function OrganiZAPLogo({
  className,
  priority = false,
  size = "md",
  onDark = false,
  compact = false,
}: OrganiZAPLogoProps) {
  return (
    <div
      aria-label="Você Digital CRM"
      className={cn(
        "flex shrink-0 items-center",
        onDark && "rounded-md bg-white/95 px-2 py-1",
        className,
      )}
    >
      {compact ? (
        <span className="relative size-6 shrink-0">
          <Image
            src="/organizap-mark.png"
            alt="Você Digital CRM"
            fill
            priority={priority}
            sizes="24px"
            className="object-contain"
          />
        </span>
      ) : (
        <span className={cn("relative shrink-0", sizeClasses[size])}>
          <Image
            src="/voce-digital-crm-logo-cropped.png"
            alt="Você Digital CRM"
            fill
            priority={priority}
            sizes={size === "lg" ? "176px" : size === "md" ? "128px" : "96px"}
            className="object-contain"
          />
        </span>
      )}
    </div>
  );
}
