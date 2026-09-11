import Image from "next/image";
import { cn } from "@/lib/utils";

interface OrganiZAPLogoProps {
  className?: string;
  priority?: boolean;
}

/** The product mark used for OrganiZAP-owned screens and navigation. */
export function OrganiZAPLogo({ className, priority = false }: OrganiZAPLogoProps) {
  return (
    <div className={cn("relative h-8 w-32 shrink-0", className)}>
      <Image
        src="/organizap-logo.png"
        alt="OrganiZAP"
        fill
        priority={priority}
        sizes="(max-width: 640px) 128px, 160px"
        className="object-contain"
      />
    </div>
  );
}
