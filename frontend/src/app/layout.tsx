import type { Metadata } from "next";
import { Web3Provider } from "@/lib/providers";
import { IntentSwapApp } from "@/components/intent/IntentSwapApp";
import "./globals.css";

export const metadata: Metadata = {
  title: "IntentSwap — Intent-Based DEX",
  icons: {
    icon: "/favicon.svg",
  },
  description: "Submit swap intents and let solvers compete for best execution",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
