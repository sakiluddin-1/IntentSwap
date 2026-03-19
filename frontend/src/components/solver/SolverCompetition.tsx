"use client";

import { useState, useEffect } from "react";

interface Bid {
  id: string;
  solver: string;
  source: string;
  output: number;
  gasEstimate: number;
  confidence: number;
  isWinner?: boolean;
}

const MOCK_SOLVERS = [
  { name: "AlphaSolver", color: "#00FFB3" },
  { name: "BetaFill",    color: "#0088FF" },
  { name: "GammaRoute",  color: "#FF6B35" },
  { name: "DeltaSwap",   color: "#A78BFA" },
];

const MOCK_SOURCES = ["Uniswap V3", "1inch", "Uniswap V2", "Curve"];

export function SolverCompetition({ intentId }: { intentId: `0x${string}` | null }) {
  const [bids, setBids] = useState<Bid[]>([]);
  const [phase, setPhase] = useState<"waiting" | "collecting" | "selecting" | "done">("waiting");
  const [winner, setWinner] = useState<Bid | null>(null);

  useEffect(() => {
    if (!intentId) {
      setBids([]);
      setPhase("waiting");
      setWinner(null);
      return;
    }

    // Simulate solver competition lifecycle
    setPhase("collecting");
    setBids([]);
    setWinner(null);

    // Bids trickle in over 2-4 seconds
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const baseOutput = 2480 + Math.random() * 40; // ~$2480-2520

    MOCK_SOLVERS.forEach((solver, i) => {
      const delay = 300 + i * 600 + Math.random() * 400;
      timeouts.push(setTimeout(() => {
        const bid: Bid = {
          id: solver.name,
          solver: solver.name,
          source: MOCK_SOURCES[i % MOCK_SOURCES.length],
          output: baseOutput - i * 2 + Math.random() * 10, // competitive range
          gasEstimate: 140000 + Math.floor(Math.random() * 60000),
          confidence: 0.85 + Math.random() * 0.12,
        };
        setBids(prev => [...prev, bid].sort((a, b) => b.output - a.output));
      }, delay));
    });

    // Selection phase
    timeouts.push(setTimeout(() => {
      setPhase("selecting");
    }, 3200));

    // Winner announced
    timeouts.push(setTimeout(() => {
      setBids(prev => {
        const sorted = [...prev].sort((a, b) => b.output - a.output);
        const w = { ...sorted[0], isWinner: true };
        setWinner(w);
        setPhase("done");
        return sorted.map((b, i) => ({ ...b, isWinner: i === 0 }));
      });
    }, 4200));

    return () => timeouts.forEach(clearTimeout);
  }, [intentId]);

  return (
    <div style={{
      background: "var(--bg-surface)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: 20,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>
          Solver <span style={{ color: "var(--accent)" }}>Competition</span>
        </h3>
        <PhaseBadge phase={phase} />
      </div>

      {phase === "waiting" && (
        <div style={{
          textAlign: "center",
          padding: "32px 16px",
          color: "var(--text-muted)",
          fontSize: 13,
        }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🏁</div>
          Submit an intent to start solver competition
        </div>
      )}

      {phase !== "waiting" && (
        <>
          {/* Bid list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {bids.length === 0 && phase === "collecting" && (
              <div style={{ textAlign: "center", padding: "16px", color: "var(--text-muted)", fontSize: 13 }}>
                <span style={{ animation: "spin-slow 1s linear infinite", display: "inline-block", marginRight: 8 }}>⟳</span>
                Waiting for solver bids…
              </div>
            )}
            {bids.map((bid, i) => (
              <BidRow key={bid.id} bid={bid} rank={i + 1} isSelecting={phase === "selecting"} />
            ))}
          </div>

          {/* Winner banner */}
          {winner && (
            <div style={{
              padding: "12px 14px",
              background: "var(--accent-glow)",
              border: "1px solid rgba(0,255,179,0.3)",
              borderRadius: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }} className="animate-slide-up">
              <div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>WINNING SOLVER</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>
                  {winner.solver} · {winner.source}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>OUTPUT</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
                  ${winner.output.toFixed(2)}
                </div>
              </div>
            </div>
          )}

          {/* Bid count */}
          <div style={{
            marginTop: 12,
            fontSize: 11,
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            textAlign: "center",
          }}>
            {bids.length} solver{bids.length !== 1 ? "s" : ""} submitted bids
          </div>
        </>
      )}
    </div>
  );
}

function BidRow({ bid, rank, isSelecting }: { bid: Bid; rank: number; isSelecting: boolean }) {
  const isTop = rank === 1;
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 12px",
      borderRadius: 10,
      border: `1px solid ${bid.isWinner ? "var(--accent)" : "var(--border)"}`,
      background: bid.isWinner ? "var(--accent-glow)" : "var(--bg-elevated)",
      transition: "all 0.3s",
      animation: "slide-up 0.2s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 22, height: 22, borderRadius: "50%",
          background: bid.isWinner ? "var(--accent)" : isTop && isSelecting ? "var(--accent-glow)" : "var(--bg-card)",
          border: `1px solid ${bid.isWinner ? "var(--accent)" : "var(--border)"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700,
          color: bid.isWinner ? "#0A0A0F" : "var(--text-muted)",
        }}>
          {rank}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: bid.isWinner ? "var(--accent)" : "var(--text-primary)" }}>
            {bid.solver}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {bid.source} · {(bid.confidence * 100).toFixed(0)}% conf
          </div>
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{
          fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)",
          color: bid.isWinner ? "var(--accent)" : "var(--text-primary)",
        }}>
          ${bid.output.toFixed(2)}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {(bid.gasEstimate / 1000).toFixed(0)}k gas
        </div>
      </div>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    waiting:    { label: "IDLE",       color: "var(--text-muted)",  bg: "var(--bg-elevated)" },
    collecting: { label: "LIVE",       color: "var(--accent)",      bg: "var(--accent-glow)" },
    selecting:  { label: "SELECTING",  color: "var(--warning)",     bg: "rgba(255,184,0,0.1)" },
    done:       { label: "SETTLED",    color: "var(--accent)",      bg: "var(--accent-glow)" },
  };
  const { label, color, bg } = config[phase] || config.waiting;
  return (
    <div style={{
      padding: "3px 10px",
      borderRadius: 6,
      fontSize: 10,
      fontWeight: 700,
      fontFamily: "var(--font-mono)",
      letterSpacing: "0.08em",
      color, background: bg,
      border: `1px solid ${color}`,
    }}>
      {phase === "collecting" && <span style={{ marginRight: 4, animation: "spin-slow 1s linear infinite", display: "inline-block" }}>●</span>}
      {label}
    </div>
  );
}
