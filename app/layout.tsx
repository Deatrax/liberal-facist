import type { Metadata, Viewport } from "next";
import "@fontsource/jost/500.css";
import "@fontsource/jost/600.css";
import "@fontsource/jost/700.css";
import "@fontsource/jost/800.css";
import "@fontsource/unifrakturmaguntia/400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Secret Hitler",
  description: "A private online table for Secret Hitler.",
  icons: { icon: "/cards/emblem-neutral.webp" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fcfcfb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <div className="flex min-h-dvh flex-col">
          <div className="flex-1">{children}</div>
          <footer className="px-4 pb-4 pt-6 text-center text-[11px] leading-snug text-ink-soft">
            <a className="underline underline-offset-2" href="https://secrethitler.com" target="_blank" rel="noreferrer">
              Secret Hitler
            </a>{" "}
            by Goat, Wolf &amp; Cabbage,{" "}
            <a
              className="underline underline-offset-2"
              href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-NC-SA 4.0
            </a>
          </footer>
        </div>
      </body>
    </html>
  );
}
