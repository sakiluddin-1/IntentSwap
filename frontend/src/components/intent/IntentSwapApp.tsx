"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { IntentForm } from "./IntentForm";
import { IntentTracker } from "./IntentTracker";
import { SolverCompetition } from "../solver/SolverCompetition";
import { ActivityFeed } from "../solver/ActivityFeed";
import type { Intent, IntentStatus } from "@/types";

type Tab = "swap" | "activity";

export function IntentSwapApp() {
  const { isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<Tab>("swap");
  const [pendingIntent, setPendingIntent] = useState<{
    intent: Intent;
    intentId: `0x${string}`;
  } | null>(null);

  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>
      {/* ── Header ──────────────────────────────────────────── */}
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "20px 32px",
        borderBottom: "1px solid var(--border)",
        backdropFilter: "blur(12px)",
        background: "rgba(5,5,8,0.8)",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Logo */}
          <div style={{
            width: 36,
            height: 36,
            borderRadius: "10px",
            background: "linear-gradient(135deg, var(--accent), #0088FF)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 16,
            color: "#0A0A0F",
            fontFamily: "var(--font-mono)",
          }}>IS</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em" }}>
              Intent<span style={{ color: "var(--accent)" }}>Swap</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
              INTENT-BASED DEX
            </div>
          </div>
        </div>

        {/* Tab nav */}
        <nav style={{ display: "flex", gap: 4, background: "var(--bg-surface)", padding: 4, borderRadius: 10, border: "1px solid var(--border)" }}>
          {(["swap", "activity"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "7px 18px",
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 500,
                fontFamily: "var(--font-display)",
                transition: "all 0.2s",
                background: activeTab === tab ? "var(--bg-elevated)" : "transparent",
                color: activeTab === tab ? "var(--text-primary)" : "var(--text-secondary)",
                boxShadow: activeTab === tab ? "0 1px 3px rgba(0,0,0,0.4)" : "none",
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>

        <ConnectButton />
      </header>

      {/* ── Main Content ─────────────────────────────────────── */}
      <main style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "40px 24px",
      }}>
        {activeTab === "swap" && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
            gap: 24,
            alignItems: "start",
          }}>
            {/* Left: swap form */}
            <div className="animate-slide-up">
              <IntentForm
                onIntentSubmitted={(intent, intentId) =>
                  setPendingIntent({ intent, intentId })
                }
              />
            </div>

            {/* Right: solver competition + tracker */}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}
              className="animate-slide-up" >
              <SolverCompetition intentId={pendingIntent?.intentId ?? null} />
              {pendingIntent && (
                <IntentTracker
                  intent={pendingIntent.intent}
                  intentId={pendingIntent.intentId}
                  onDismiss={() => setPendingIntent(null)}
                />
              )}
            </div>
          </div>
        )}

        {activeTab === "activity" && (
          <div className="animate-slide-up">
            <ActivityFeed />
          </div>
        )}

        {/* Not connected banner */}
        {!isConnected && activeTab === "swap" && (
          <div style={{
            marginTop: 32,
            padding: "20px 24px",
            borderRadius: 12,
            background: "linear-gradient(135deg, rgba(0,255,179,0.05), rgba(0,136,255,0.05))",
            border: "1px solid var(--border-bright)",
            textAlign: "center",
            color: "var(--text-secondary)",
            fontSize: 14,
          }}>
            🔌 Connect your wallet to submit swap intents
          </div>
        )}
      </main>

      {/* ── Protocol stats bar ───────────────────────────────── */}
      <footer style={{
        borderTop: "1px solid var(--border)",
        padding: "14px 32px",
        display: "flex",
        gap: 32,
        justifyContent: "center",
        background: "rgba(5,5,8,0.6)",
        backdropFilter: "blur(8px)",
      }}>
        {[
          { label: "Protocol Fee", value: "0.3%" },
          { label: "Avg Fill Time", value: "~4s" },
          { label: "Active Solvers", value: "12" },
          { label: "24h Volume", value: "$2.4M" },
        ].map(({ label, value }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.06em", marginBottom: 2 }}>
              {label.toUpperCase()}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
              {value}
            </div>
          </div>
        ))}
      </footer>
    </div>
  );
}
