import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import "./globals.css";

// Fonts are vendored (SIL OFL) so builds never depend on a font CDN.
const plex = localFont({
  variable: "--font-plex",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

const caveat = localFont({
  variable: "--font-caveat",
  display: "swap",
  src: [{ path: "./fonts/caveat-latin-600-normal.woff2", weight: "600", style: "normal" }],
});

export const metadata: Metadata = {
  title: { default: "Probewise | System design interview practice", template: "%s | Probewise" },
  description:
    "Practice system design interviews that follow up like a real interviewer, tailored to your role, level and domain.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8f7" },
    { media: "(prefers-color-scheme: dark)", color: "#12171e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plex.variable} ${caveat.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-board-raised focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
