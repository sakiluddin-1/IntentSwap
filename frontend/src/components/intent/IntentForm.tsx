"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { useIntentSwap } from "@/hooks/useIntentSwap";
import { useQuote } from "@/hooks/useQuote";
import { KNOWN_TOKENS } from "@/types";
import type { Intent, TokenInfo } from "@/types";

const TOKEN_LIST = Object.values(KNOWN_TOKENS);

interface Props {
  onIntentSubmitted: (intent: Intent, intentId: `0x${string}`) => void;
}

export function IntentForm({ onIntentSubmitted }: Props) {
  const { address, isConnected } = useAccount();
  const { step, error, submitIntent, reset } = useIntentSwap();

  const [inputToken, setInputToken] = useState<TokenInfo>(KNOWN_TOKENS.ETH);
  const [outputToken, setOutputToken] = useState<TokenInfo>(KNOWN_TOKENS.USDC);
  const [inputAmount, setInputAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50); // 0.5%
  const [deadlineMinutes, setDeadlineMinutes] = useState(30);
  const [showSettings, setShowSettings] = useState(false);

  const { quote, isLoading: quoteLoading } = useQuote({
    inputToken,
    outputToken,
    inputAmount,
    enabled: Boolean(inputAmount && Number(inputAmount) > 0),
  });

  const handleSwapTokens = () => {
    setInputToken(outputToken);
    setOutputToken(inputToken);
    setInputAmount("");
  };

  const handleSubmit = useCallback(async () => {
    if (!isConnected || !address || !inputAmount || !quote) return;

    try {
      const result = await submitIntent({
        inputToken: inputToken.address,
        outputToken: outputToken.address,
        inputAmount: quote.inputAmount,
        minOutput: quote.minOutput,
        deadlineMinutes,
        solverTip: parseUnits("0.001", 18),
      });

      if (result?.intent && result?.intentId) {
        onIntentSubmitted(result.intent, result.intentId);
      }
    } catch {}
  }, [isConnected, address, inputAmount, quote, inputToken, outputToken, deadlineMinutes, submitIntent, onIntentSubmitted]);

  const isSubmitting = ["approving", "signing", "submitting"].includes(step);
  const canSubmit = isConnected && inputAmount && Number(inputAmount) > 0 && quote && !isSubmitting;

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>
          Swap <span style={{ color: "var(--accent)" }}>Intent</span>
        </h2>
        <button
          onClick={() => setShowSettings(!showSettings)}
          style={iconBtnStyle}
          title="Settings"
        >
          ⚙
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div style={{
          marginBottom: 20,
          padding: "14px 16px",
          background: "var(--bg-void)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          animation: "slide-up 0.2s ease",
        }}>
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Slippage Tolerance</label>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                {[25, 50, 100].map((bps) => (
                  <button
                    key={bps}
                    onClick={() => setSlippageBps(bps)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 6,
                      border: `1px solid ${slippageBps === bps ? "var(--accent)" : "var(--border)"}`,
                      background: slippageBps === bps ? "var(--accent-glow)" : "transparent",
                      color: slippageBps === bps ? "var(--accent)" : "var(--text-secondary)",
                      cursor: "pointer",
                      fontSize: 13,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {bps / 100}%
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Deadline</label>
              <select
                value={deadlineMinutes}
                onChange={(e) => setDeadlineMinutes(Number(e.target.value))}
                style={{ ...inputFieldStyle, marginTop: 6, cursor: "pointer" }}
              >
                {[10, 20, 30, 60].map((m) => (
                  <option key={m} value={m}>{m} minutes</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Input token */}
      <div style={fieldGroupStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={labelStyle}>You Send</label>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            Balance: —
          </span>
        </div>
        <div style={amountRowStyle}>
          <input
            type="number"
            placeholder="0.0"
            value={inputAmount}
            onChange={(e) => setInputAmount(e.target.value)}
            style={amountInputStyle}
          />
          <TokenSelector
            selected={inputToken}
            tokens={TOKEN_LIST.filter(t => t.symbol !== outputToken.symbol)}
            onChange={setInputToken}
          />
        </div>
      </div>

      {/* Swap arrow */}
      <div style={{ textAlign: "center", margin: "12px 0" }}>
        <button
          onClick={handleSwapTokens}
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "2px solid var(--border-bright)",
            background: "var(--bg-elevated)",
            cursor: "pointer",
            color: "var(--text-secondary)",
            fontSize: 16,
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            (e.target as HTMLElement).style.borderColor = "var(--accent)";
            (e.target as HTMLElement).style.color = "var(--accent)";
          }}
          onMouseLeave={e => {
            (e.target as HTMLElement).style.borderColor = "var(--border-bright)";
            (e.target as HTMLElement).style.color = "var(--text-secondary)";
          }}
        >
          ↕
        </button>
      </div>

      {/* Output token */}
      <div style={fieldGroupStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={labelStyle}>You Receive (Est.)</label>
          {quote && (
            <span style={{ fontSize: 12, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
              Min: {formatUnits(quote.minOutput, outputToken.decimals)} {outputToken.symbol}
            </span>
          )}
        </div>
        <div style={amountRowStyle}>
          <div style={{ ...amountInputStyle, color: "var(--text-secondary)", display: "flex", alignItems: "center" }}>
            {quoteLoading ? (
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Fetching quote…</span>
            ) : quote ? (
              <span style={{ fontSize: 20, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                {Number(formatUnits(quote.estimatedOutput, outputToken.decimals)).toFixed(4)}
              </span>
            ) : (
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>—</span>
            )}
          </div>
          <TokenSelector
            selected={outputToken}
            tokens={TOKEN_LIST.filter(t => t.symbol !== inputToken.symbol)}
            onChange={setOutputToken}
          />
        </div>
      </div>

      {/* Quote details */}
      {quote && (
        <div style={{
          marginTop: 12,
          padding: "10px 14px",
          borderRadius: 10,
          background: "var(--bg-void)",
          border: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--text-secondary)",
          fontFamily: "var(--font-mono)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span>Price Impact</span>
            <span style={{ color: quote.priceImpact > 1 ? "var(--warning)" : "var(--accent)" }}>
              {quote.priceImpact.toFixed(3)}%
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span>Slippage Tolerance</span>
            <span>{slippageBps / 100}%</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Gas Estimate</span>
            <span>~{quote.gasEstimate.toLocaleString()} units</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 12,
          padding: "10px 14px",
          borderRadius: 8,
          background: "rgba(255,77,106,0.08)",
          border: "1px solid rgba(255,77,106,0.3)",
          color: "var(--error)",
          fontSize: 13,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Step progress */}
      {isSubmitting && (
        <div style={{
          marginTop: 12,
          padding: "10px 14px",
          borderRadius: 8,
          background: "var(--accent-glow)",
          border: "1px solid rgba(0,255,179,0.3)",
          color: "var(--accent)",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span style={{ animation: "spin-slow 1s linear infinite", display: "inline-block" }}>⟳</span>
          {step === "approving" && "Approving token…"}
          {step === "signing" && "Sign intent in wallet…"}
          {step === "submitting" && "Submitting to chain…"}
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          marginTop: 16,
          width: "100%",
          padding: "14px 20px",
          borderRadius: 12,
          border: "none",
          cursor: canSubmit ? "pointer" : "not-allowed",
          fontSize: 15,
          fontWeight: 700,
          fontFamily: "var(--font-display)",
          letterSpacing: "0.01em",
          transition: "all 0.2s",
          background: canSubmit
            ? "linear-gradient(135deg, var(--accent), var(--accent-dim))"
            : "var(--bg-elevated)",
          color: canSubmit ? "#0A0A0F" : "var(--text-muted)",
          boxShadow: canSubmit ? "0 0 20px var(--accent-glow)" : "none",
        }}
      >
        {!isConnected
          ? "Connect Wallet"
          : !inputAmount
          ? "Enter Amount"
          : quoteLoading
          ? "Fetching Quote…"
          : isSubmitting
          ? "Processing…"
          : "Submit Intent →"}
      </button>

      {/* How it works */}
      <div style={{ marginTop: 16, fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
        Sign once off-chain → solvers compete → best execution wins
      </div>
    </div>
  );
}

// ── Token Selector ──────────────────────────────────────────────────────────

function TokenSelector({
  selected,
  tokens,
  onChange,
}: {
  selected: TokenInfo;
  tokens: TokenInfo[];
  onChange: (t: TokenInfo) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 10,
          border: "1px solid var(--border-bright)",
          background: "var(--bg-elevated)",
          cursor: "pointer",
          color: "var(--text-primary)",
          fontWeight: 600,
          fontSize: 14,
          whiteSpace: "nowrap",
          fontFamily: "var(--font-display)",
        }}
      >
        <TokenIcon symbol={selected.symbol} />
        {selected.symbol}
        <span style={{ color: "var(--text-muted)", fontSize: 10, marginLeft: 2 }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          zIndex: 50,
          minWidth: 180,
          background: "var(--bg-card)",
          border: "1px solid var(--border-bright)",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          animation: "slide-up 0.15s ease",
        }}>
          {tokens.map((token) => (
            <button
              key={token.symbol}
              onClick={() => { onChange(token); setOpen(false); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "10px 14px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "var(--font-display)",
                textAlign: "left",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-elevated)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <TokenIcon symbol={token.symbol} />
              <div>
                <div style={{ fontWeight: 600 }}>{token.symbol}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{token.name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TokenIcon({ symbol }: { symbol: string }) {
  const colors: Record<string, string> = {
    ETH: "#627EEA", USDC: "#2775CA", USDT: "#26A17B",
    WBTC: "#F7931A", DAI: "#F5AC37",
  };
  return (
    <div style={{
      width: 24, height: 24, borderRadius: "50%",
      background: colors[symbol] || "#555",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 10, fontWeight: 700, color: "white",
    }}>
      {symbol.charAt(0)}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 24,
};

const fieldGroupStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "14px 16px",
};

const amountRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const amountInputStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  fontSize: 22,
  fontWeight: 700,
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
};

const inputFieldStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "var(--font-display)",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-secondary)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const iconBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  cursor: "pointer",
  color: "var(--text-secondary)",
  fontSize: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
