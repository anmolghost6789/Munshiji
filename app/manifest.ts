import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Munshiji — Business Ka Hisab, Aasaan",
    short_name: "Munshiji",
    description: "WhatsApp orders, GST invoices and faster payments for Indian manufacturers.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#fbf8f1",
    theme_color: "#05362a",
    icons: [
      { src: "/brand/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
