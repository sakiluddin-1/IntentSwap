"use client";

import { useState, useEffect, useCallback } from "react";
import { formatUnits } from "viem";
import { useIntentSwap } from "@/hooks/useIntentSwap";
import type { Intent, IntentStatus } from "@/types";

interface Props {
  intent: Intent;
  intentId: `0x${string}`;
  onDismiss: () => void;
}

const STEPS = [
  { key: "signed",     label: "Intent Signed",       desc: "EIP-712 signature created" },
  { key: "submitted",  label: "Funds Escrowed",       desc: "Tokens locked in contract" },
  { key: "competing",  label: "Solvers Competing",    desc: "Finding best execution route" },
  { key: "executing",  label: "Executing Swap",       desc: "Transaction in flight" },
  { key: "complete",   label: "Intent Fulfilled",     desc: "Tokens delivered to wallet" },
];

export function IntentTracker({ intent, intentId, onDismiss }: Props) {
  const { getIntentState, cancelIntent } = useIntentSwap();
  const [state, setState] = useState<IntentStatus | null>(null);
  const [activeStep, setActiveStep] = useState(1); // starts at "submitted"
  const [elapsed, setElapsed] = useState(0);
  const [isCancelling, setIsCancelling] = useState(false);

  // Poll intent state every 2 seconds
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const poll = async () => {
      const s = await getIntentState(intentId);
      if (s) {
        setState(s);
        if (s.status === "executed") setActiveStep(4);
        else if (s.status === "cancelled") setActiveStep(0);
        else setActiveStep(2); // competing
      }
    };
    poll();
    interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [intentId, getIntentState]);

  // Elapsed timer
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  // Simulate solver competition progression (UI demo)
  useEffect(() => {
    if (activeStep === 2) {
      const t = setTimeout(() => setActiveStep(3), 3000);
      return () => clearTimeout(t);
    }
    if (activeStep === 3 && state?.status !== "executed") {
      const t = setTimeout(() => {
        if (state?.status === "executed") setActiveStep(4);
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [activeStep, state?.status]);

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      await cancelIntent(intent);
    } catch {}
    setIsCancelling(false);
  };

  const isComplete = state?.status === "executed";
  const isCancelled = state?.status === "cancelled";
  const deadline = Number(intent.deadline);
  const timeLeft = Math.max(0, deadline - Math.floor(Date.now() / 1000));

  return (
    <div style={{
      background: "var(--bg-surface)",
      border: `1px solid ${isComplete ? "var(--accent)" : isCancelled ? "var(--error)" : "var(--border)"}`,
      borderRadius: 16,
      padding: 20,
      transition: "border-color 0.3s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: isComplete ? "var(--accent)" : "var(--text-primary)" }}>
            {isComplete ? "✅ Swap Executed!" : isCancelled ? "❌ Intent Cancelled" : "⏳ Intent Pending"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 3 }}>
            {intentId.slice(0, 10)}…{intentId.slice(-6)} · {elapsed}s elapsed
          </div>
        </div>
        <button
          onClick={onDismiss}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18, lineHeight: 1 }}
        >×</button>
      </div>

      {/* Step progress */}
      <div style={{ marginBottom: 20 }}>
        {STEPS.map((step, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          return (
            <div key={step.key} style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700,
                  background: done ? "var(--accent)" : active ? "var(--accent-glow)" : "var(--bg-elevated)",
                  border: `2px solid ${done ? "var(--accent)" : active ? "var(--accent)" : "var(--border)"}`,
                  color: done ? "#0A0A0F" : active ? "var(--accent)" : "var(--text-muted)",
                  transition: "all 0.3s",
                  ...(active && { animation: "pulse-glow 1.5s ease-in-out infinite" }),
                }}>
                  {done ? "✓" : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{
                    width: 2, height: 16, marginTop: 4,
                    background: done ? "var(--accent)" : "var(--border)",
                    transition: "background 0.3s",
                  }} />
                )}
              </div>
              <div style={{ paddingTop: 3 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  color: done || active ? "var(--text-primary)" : "var(--text-muted)",
                  transition: "color 0.3s",
                }}>
                  {step.label}
                </div>
                {(done || active) && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                    {step.desc}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Execution result */}
      {isComplete && state?.actualOutput && (
        <div style={{
          padding: "12px 14px",
          background: "var(--accent-glow)",
          border: "1px solid rgba(0,255,179,0.3)",
          borderRadius: 10,
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>Received</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
            {formatUnits(state.actualOutput, 6)} USDC
          </div>
          {state.executingSolver && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              by solver {state.executingSolver.slice(0, 8)}…
            </div>
          )}
        </div>
      )}

      {/* Deadline countdown */}
      {!isComplete && !isCancelled && (
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          background: "var(--bg-void)",
          borderRadius: 8,
          marginBottom: 12,
          fontSize: 12,
          fontFamily: "var(--font-mono)",
        }}>
          <span style={{ color: "var(--text-muted)" }}>DEADLINE</span>
          <span style={{ color: timeLeft < 120 ? "var(--warning)" : "var(--text-secondary)" }}>
            {Math.floor(timeLeft / 60)}m {timeLeft % 60}s
          </span>
        </div>
      )}

      {/* Cancel button */}
      {!isComplete && !isCancelled && timeLeft > 0 && (
        <button
          onClick={handleCancel}
          disabled={isCancelling}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            cursor: "pointer",
            color: "var(--text-secondary)",
            fontSize: 13,
            fontFamily: "var(--font-display)",
          }}
        >
          {isCancelling ? "Cancelling…" : "Cancel Intent"}
        </button>
      )}
    </div>
  );
}
