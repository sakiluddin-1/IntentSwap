"use client";

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { formatUnits } from "viem";
import type { SwapQuote, TokenInfo } from "@/types";

interface UseQuoteParams {
  inputToken: TokenInfo | null;
  outputToken: TokenInfo | null;
  inputAmount: string; // human-readable
  enabled?: boolean;
}

interface QuoteResult {
  quote: SwapQuote | null;
  quotes: { source: string; output: bigint; gasEstimate: bigint }[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useQuote({
  inputToken,
  outputToken,
  inputAmount,
  enabled = true,
}: UseQuoteParams): QuoteResult {
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quotes, setQuotes] = useState<{ source: string; output: bigint; gasEstimate: bigint }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (!enabled || !inputToken || !outputToken || !inputAmount || Number(inputAmount) <= 0) {
      setQuote(null);
      setQuotes([]);
      return;
    }

    const controller = new AbortController();

    const fetchQuote = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Convert human amount to raw bigint
        const amountIn = BigInt(
          Math.floor(Number(inputAmount) * 10 ** inputToken.decimals)
        ).toString();

        const chainId = 1; // mainnet; derive from wagmi in real app
        const src = inputToken.address;
        const dst = outputToken.address;

        // Fetch from 1inch quote API (public endpoint, no auth needed for quotes)
        const response = await axios.get(
          `https://api.1inch.dev/swap/v6.0/${chainId}/quote`,
          {
            params: { src, dst, amount: amountIn },
            signal: controller.signal,
            timeout: 6000,
          }
        );

        const outputRaw = BigInt(response.data.dstAmount);
        const slippageBps = 50n; // 0.5%
        const minOutput = (outputRaw * (10000n - slippageBps)) / 10000n;
        const priceImpact = calculatePriceImpact(
          Number(amountIn),
          Number(outputRaw),
          inputToken,
          outputToken
        );

        const bestQuote: SwapQuote = {
          inputToken,
          outputToken,
          inputAmount: BigInt(amountIn),
          estimatedOutput: outputRaw,
          minOutput,
          priceImpact,
          gasEstimate: BigInt(response.data.gas || 200000),
          route: ["1inch"],
        };

        setQuote(bestQuote);
        setQuotes([
          { source: "1inch", output: outputRaw, gasEstimate: BigInt(response.data.gas || 200000) },
        ]);
      } catch (err: any) {
        if (err.name === "CanceledError" || err.name === "AbortError") return;
        setError(err.response?.data?.description || err.message || "Failed to fetch quote");
        // Generate a mock quote as fallback for UI demonstration
        setQuote(getMockQuote(inputToken, outputToken, inputAmount));
      } finally {
        setIsLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchQuote, 500);
    return () => {
      clearTimeout(debounceTimer);
      controller.abort();
    };
  }, [inputToken, outputToken, inputAmount, enabled, trigger]);

  return { quote, quotes, isLoading, error, refetch };
}

function calculatePriceImpact(
  amountIn: number,
  amountOut: number,
  inputToken: TokenInfo,
  outputToken: TokenInfo
): number {
  // Simplified price impact calculation
  // In production: compare against spot price from price feed
  const inputUsd = amountIn * (inputToken.priceUsd || 1) / 10 ** inputToken.decimals;
  const outputUsd = amountOut * (outputToken.priceUsd || 1) / 10 ** outputToken.decimals;
  if (inputUsd <= 0) return 0;
  return Math.abs((inputUsd - outputUsd) / inputUsd) * 100;
}

function getMockQuote(
  inputToken: TokenInfo,
  outputToken: TokenInfo,
  inputAmount: string
): SwapQuote {
  const amountIn = BigInt(Math.floor(Number(inputAmount) * 10 ** inputToken.decimals));
  // Mock: 1 ETH ≈ 2500 USDC
  const mockRate = 2500n;
  const estimatedOutput =
    inputToken.symbol === "ETH" && outputToken.symbol === "USDC"
      ? (amountIn * mockRate * BigInt(10 ** outputToken.decimals)) / BigInt(10 ** inputToken.decimals)
      : (amountIn * 99n) / 100n;

  return {
    inputToken,
    outputToken,
    inputAmount: amountIn,
    estimatedOutput,
    minOutput: (estimatedOutput * 995n) / 1000n,
    priceImpact: 0.05,
    gasEstimate: 180000n,
    route: ["Uniswap V3"],
  };
}
