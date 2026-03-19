"use client";

import { useState, useEffect } from "react";

interface Execution {
  id: string;
  intentId: string;
  user: string;
  solver: string;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount: string;
  executedAt: number;
  txHash: string;
  source: string;
  savings: number; // % saved vs naive swap
}

const MOCK_EXECUTIONS: Execution[] = [
  {
    id: "1", intentId: "0xd4e5f6", user: "0x7aB2...4f3C", solver: "AlphaSolver",
    inputToken: "ETH", outputToken: "USDC", inputAmount: "1.5", outputAmount: "3,742.18",
    executedAt: Date.now() - 45000, txHash: "0xaaaa...bbbb", source: "Uniswap V3", savings: 0.23,
  },
  {
    id: "2", intentId: "0xa1b2c3", user: "0x3cD4...8e9F", solver: "BetaFill",
    inputToken: "USDC", outputToken: "WBTC", inputAmount: "5,000", outputAmount: "0.07823",
    executedAt: Date.now() - 120000, txHash: "0xcccc...dddd", source: "1inch", savings: 0.41,
  },
  {
    id: "3", intentId: "0xf7g8h9", user: "0x9eF0...2a3B", solver: "GammaRoute",
    inputToken: "ETH", outputToken: "DAI", inputAmount: "0.5", outputAmount: "1,248.92",
    executedAt: Date.now() - 300000, txHash: "0xeeee...ffff", source: "Uniswap V3", savings: 0.18,
  },
  {
    id: "4", intentId: "0xc4d5e6", user: "0x5gH6...7I8J", solver: "AlphaSolver",
    inputToken: "WBTC", outputToken: "ETH", inputAmount: "0.1", outputAmount: "6.4213",
    executedAt: Date.now() - 600000, txHash: "0xgggg...hhhh", source: "1inch", savings: 0.56,
  },
];

export function ActivityFeed() {
  const [executions, setExecutions] = useState<Execution[]>(MOCK_EXECUTIONS);

  const formatTimeAgo = (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>
          Recent <span style={{ color: "var(--accent)" }}>Executions</span>
        </h2>
        <div style={{
          padding: "4px 12px",
          borderRadius: 6,
          background: "var(--accent-glow)",
          border: "1px solid rgba(0,255,179,0.3)",
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "var(--font-mono)",
          color: "var(--accent)",
        }}>
          LIVE
        </div>
      </div>

      {/* Stats row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 16,
        marginBottom: 24,
      }}>
        {[
          { label: "Total Intents", value: "14,832", delta: "+48 today" },
          { label: "Total Volume", value: "$42.1M", delta: "+$2.4M today" },
          { label: "Avg Savings", value: "0.38%", delta: "vs market" },
          { label: "Avg Fill Time", value: "3.8s", delta: "across solvers" },
        ].map(stat => (
          <div key={stat.label} style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "16px 18px",
          }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.06em", marginBottom: 6 }}>
              {stat.label.toUpperCase()}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-primary)", marginBottom: 3 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 11, color: "var(--accent)" }}>{stat.delta}</div>
          </div>
        ))}
      </div>

      {/* Execution table */}
      <div style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        overflow: "hidden",
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.5fr 1.5fr 1fr 1fr 0.8fr",
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          letterSpacing: "0.06em",
        }}>
          <span>INTENT</span>
          <span>SWAP</span>
          <span>AMOUNT</span>
          <span>SOLVER</span>
          <span>SAVINGS</span>
          <span>TIME</span>
        </div>

        {executions.map((ex, i) => (
          <div
            key={ex.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.5fr 1.5fr 1fr 1fr 0.8fr",
              padding: "14px 20px",
              borderBottom: i < executions.length - 1 ? "1px solid var(--border)" : "none",
              alignItems: "center",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-elevated)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              0x{ex.intentId}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <TokenPill symbol={ex.inputToken} />
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>→</span>
              <TokenPill symbol={ex.outputToken} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                {ex.inputAmount} {ex.inputToken}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                → {ex.outputAmount} {ex.outputToken}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{ex.solver}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{ex.source}</div>
            </div>
            <div style={{
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              color: "var(--accent)",
              fontWeight: 600,
            }}>
              +{ex.savings.toFixed(2)}%
            </div>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {formatTimeAgo(ex.executedAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TokenPill({ symbol }: { symbol: string }) {
  const colors: Record<string, string> = {
    ETH: "#627EEA", USDC: "#2775CA", USDT: "#26A17B", WBTC: "#F7931A", DAI: "#F5AC37",
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 6,
      background: `${colors[symbol] || "#555"}22`,
      border: `1px solid ${colors[symbol] || "#555"}44`,
      fontSize: 12, fontWeight: 600, color: colors[symbol] || "#aaa",
    }}>
      {symbol}
    </div>
  );
}

function formatTimeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
