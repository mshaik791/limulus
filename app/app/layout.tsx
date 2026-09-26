import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/shell";

// Three voices. Inter for everything read at 12 to 14px: neutral, dense,
// tabular figures. JetBrains Mono for ids, hashes and payloads. Bricolage
// Grotesque for headings and the big figures: a grotesque with a jaw, so a
// verdict reads like a statement and not like a template.
const body = Inter({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Bricolage_Grotesque({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"] });

const DESCRIPTION = "Test financial agents before you trust them — continuous, signed, deterministic assurance with no model in the control path.";

export const metadata: Metadata = {
  title: { default: "Limulus — Financial Agent Assurance", template: "%s · Limulus" },
  description: DESCRIPTION,
  applicationName: "Limulus",
  openGraph: { title: "Limulus — Financial Agent Assurance", description: DESCRIPTION, siteName: "Limulus", type: "website" },
  twitter: { card: "summary", title: "Limulus — Financial Agent Assurance", description: DESCRIPTION },
};

// Every screen reads live records from the engine; nothing here is prerendered.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${mono.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
