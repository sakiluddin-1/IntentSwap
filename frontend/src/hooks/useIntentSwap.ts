"use client";

import { useState, useCallback } from "react";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { parseUnits, formatUnits, keccak256, encodePacked } from "viem";
import { INTENT_SWAP_ADDRESS, INTENT_SWAP_ABI, EIP712_DOMAIN, INTENT_TYPE } from "@/lib/contracts";
import type { Intent, IntentStatus, SwapQuote } from "@/types";

export type IntentStep =
  | "idle"
  | "approving"
  | "signing"
  | "submitting"
  | "pending"
  | "executed"
  | "failed"
  | "cancelled";

export function useIntentSwap() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [step, setStep] = useState<IntentStep>("idle");
  const [intentId, setIntentId] = useState<`0x${string}` | null>(null);
  const [currentIntent, setCurrentIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const reset = useCallback(() => {
    setStep("idle");
    setIntentId(null);
    setCurrentIntent(null);
    setError(null);
    setTxHash(null);
  }, []);

  /**
   * Full flow: approve ERC-20 → sign EIP-712 → submitIntent on-chain
   */
  const submitIntent = useCallback(
    async (params: {
      inputToken: `0x${string}`;
      outputToken: `0x${string}`;
      inputAmount: bigint;
      minOutput: bigint;
      deadlineMinutes?: number;
      solverTip?: bigint;
    }) => {
      if (!address || !walletClient || !publicClient) {
        throw new Error("Wallet not connected");
      }

      setError(null);

      try {
        const deadline =
          BigInt(Math.floor(Date.now() / 1000)) +
          BigInt((params.deadlineMinutes ?? 30) * 60);

        const solverTip = params.solverTip ?? parseUnits("0.001", 18);

        // ── Get current nonce ────────────────────────────────
        const nonce = (await publicClient.readContract({
          address: INTENT_SWAP_ADDRESS,
          abi: INTENT_SWAP_ABI,
          functionName: "getCurrentNonce",
          args: [address],
        })) as bigint;

        const intent: Intent = {
          user: address,
          inputToken: params.inputToken,
          outputToken: params.outputToken,
          inputAmount: params.inputAmount,
          minOutput: params.minOutput,
          deadline,
          nonce,
          solverTip,
        };

        setCurrentIntent(intent);

        // ── Approve ERC-20 (skip for ETH) ────────────────────
        const isNativeInput =
          params.inputToken.toLowerCase() ===
          "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

        if (!isNativeInput) {
          setStep("approving");
          await approveToken(
            params.inputToken,
            INTENT_SWAP_ADDRESS,
            params.inputAmount + solverTip,
            walletClient,
            publicClient,
            address
          );
        }

        // ── Sign intent (EIP-712) ────────────────────────────
        setStep("signing");

        const signature = await walletClient.signTypedData({
          domain: {
            ...EIP712_DOMAIN,
            chainId,
            verifyingContract: INTENT_SWAP_ADDRESS,
          },
          types: INTENT_TYPE,
          primaryType: "Intent",
          message: {
            user: intent.user,
            inputToken: intent.inputToken,
            outputToken: intent.outputToken,
            inputAmount: intent.inputAmount,
            minOutput: intent.minOutput,
            deadline: intent.deadline,
            nonce: intent.nonce,
            solverTip: intent.solverTip,
          },
        });

        // ── Submit on-chain ──────────────────────────────────
        setStep("submitting");

        const totalEscrow =
          isNativeInput ? params.inputAmount + solverTip : 0n;

        const hash = await walletClient.writeContract({
          address: INTENT_SWAP_ADDRESS,
          abi: INTENT_SWAP_ABI,
          functionName: "submitIntent",
          args: [intent, signature],
          value: totalEscrow,
        });

        setTxHash(hash);
        setStep("pending");

        // Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });

        // Extract intentId from logs
        const submittedLog = receipt.logs.find((log) =>
          log.topics[0] ===
          "0x" + keccak256(encodePacked(
            ["string"],
            ["IntentSubmitted(bytes32,address,address,address,uint256,uint256,uint256,uint256,uint256)"]
          )).slice(2)
        );

        const id = submittedLog?.topics[1] as `0x${string}` | undefined;
        setIntentId(id ?? null);

        return { intent, signature, txHash: hash, intentId: id };
      } catch (err: any) {
        const message = err.shortMessage || err.message || "Unknown error";
        setError(message);
        setStep("failed");
        throw err;
      }
    },
    [address, chainId, walletClient, publicClient]
  );

  /**
   * Poll intent state from the contract.
   */
  const getIntentState = useCallback(
    async (id: `0x${string}`): Promise<IntentStatus | null> => {
      if (!publicClient) return null;
      try {
        const state = (await publicClient.readContract({
          address: INTENT_SWAP_ADDRESS,
          abi: INTENT_SWAP_ABI,
          functionName: "getIntentState",
          args: [id],
        })) as { status: number; submittedAt: bigint; executingSolver: `0x${string}`; actualOutput: bigint };

        const statusMap: Record<number, IntentStatus["status"]> = {
          0: "pending",
          1: "pending",
          2: "executed",
          3: "cancelled",
        };

        return {
          intentId: id,
          status: statusMap[state.status] ?? "pending",
          submittedAt: Number(state.submittedAt),
          executingSolver:
            state.executingSolver !== "0x0000000000000000000000000000000000000000"
              ? state.executingSolver
              : undefined,
          actualOutput: state.actualOutput > 0n ? state.actualOutput : undefined,
        };
      } catch {
        return null;
      }
    },
    [publicClient]
  );

  /**
   * Cancel a pending intent.
   */
  const cancelIntent = useCallback(
    async (intent: Intent) => {
      if (!walletClient || !publicClient) throw new Error("Wallet not connected");
      setStep("submitting");
      try {
        const hash = await walletClient.writeContract({
          address: INTENT_SWAP_ADDRESS,
          abi: INTENT_SWAP_ABI,
          functionName: "cancelIntent",
          args: [intent],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        setStep("cancelled");
      } catch (err: any) {
        setError(err.message);
        setStep("failed");
        throw err;
      }
    },
    [walletClient, publicClient]
  );

  return {
    step,
    intentId,
    currentIntent,
    error,
    txHash,
    submitIntent,
    getIntentState,
    cancelIntent,
    reset,
  };
}

// ─── Helper: ERC-20 approval ───────────────────────────────────────────────

const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

async function approveToken(
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
  walletClient: any,
  publicClient: any,
  owner: `0x${string}`
) {
  const allowance = (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;

  if (allowance >= amount) return; // Already approved

  const hash = await walletClient.writeContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
  });

  await publicClient.waitForTransactionReceipt({ hash });
}
