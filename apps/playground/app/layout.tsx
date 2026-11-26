import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DataGhost Playground",
  description: "Realistic test data. Zero real identities. Runs locally in your browser; nothing is uploaded.",
  robots: { index: false },
};

// Production policy: scripts and styles from this origin only, and no network
// connections anywhere else, so imported data cannot leave the page.
// (Next.js inlines its bootstrap scripts, which needs 'unsafe-inline'; dev mode also needs 'unsafe-eval'.)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {process.env.NODE_ENV === "production" ? <meta httpEquiv="Content-Security-Policy" content={CSP} /> : null}
        <meta name="referrer" content="no-referrer" />
      </head>
      <body>{children}</body>
    </html>
  );
}
