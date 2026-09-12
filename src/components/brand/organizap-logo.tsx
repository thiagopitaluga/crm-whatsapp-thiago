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
  sm: { mark: "size-6", text: "text-base" },
  md: { mark: "size-8", text: "text-xl" },
  lg: { mark: "size-10", text: "text-2xl" },
};

/** The consistent product mark used across OrganiZAP-owned screens and navigation. */
export function OrganiZAPLogo({
  className,
  priority = false,
  size = "md",
  onDark = false,
  compact = false,
}: OrganiZAPLogoProps) {
  const classes = sizeClasses[size];

  return (
    <div aria-label="OrganiZAP" className={cn("flex shrink-0 items-center gap-2.5", className)}>
      <span className={cn("relative shrink-0", classes.mark)}>
        <Image
          src="/organizap-mark.png"
          alt=""
          fill
          priority={priority}
          sizes="40px"
          className="object-contain"
        />
      </span>
      <span className={cn("font-bold leading-none tracking-[-0.055em]", classes.text, compact && "sr-only")}>
        <span className={onDark ? "text-white" : "text-foreground"}>Organi</span>
        <span className="text-[#15AC5A]">ZAP</span>
      </span>
    </div>
  );
}
