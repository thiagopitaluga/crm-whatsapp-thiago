import type { MetadataRoute } from "next";

/**
 * Makes the CRM installable from a supported browser. The PWA always opens
 * in the normal authenticated application, not in a separate mobile build.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OrganiZAP — CRM para WhatsApp",
    short_name: "OrganiZAP",
    description: "CRM para atendimento, vendas e automação pelo WhatsApp.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#020617",
    icons: [
      {
        src: "/pwa/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
