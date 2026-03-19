/**
 * DEX Aggregator
 * Queries multiple DEX APIs and returns normalised quote objects.
 * Solvers use this to determine how much output they can deliver.
 */

import axios from "axios";
import { ethers } from "ethers";
import { config } from "../config/config.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("dex-aggregator");

// Native ETH placeholder used by 1inch
const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/**
 * @typedef {Object} Quote
 * @property {string} source          - DEX name ("uniswap_v3" | "1inch" | ...)
 * @property {bigint} outputAmount    - Raw output in token's decimals
 * @property {bigint} estimatedGas    - Gas estimate
 * @property {string} [callData]      - Encoded swap calldata (for execution)
 * @property {string} [routerAddress] - DEX router to call
 * @property {number} confidence      - 0-1 confidence in quote accuracy
 */

export class DexAggregator {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.network.rpcUrl);
  }

  /**
   * Get best quotes from all available DEXes for a token swap.
   * @param {string} tokenIn
   * @param {string} tokenOut
   * @param {bigint} amountIn
   * @returns {Promise<Quote[]>} Sorted by outputAmount descending
   */
  async getQuotes(tokenIn, tokenOut, amountIn) {
    const normalizedIn  = tokenIn  === ethers.ZeroAddress ? ETH_ADDRESS : tokenIn;
    const normalizedOut = tokenOut === ethers.ZeroAddress ? ETH_ADDRESS : tokenOut;

    const quotePromises = [
      this.getUniswapV3Quote(normalizedIn, normalizedOut, amountIn),
      this.get1inchQuote(normalizedIn, normalizedOut, amountIn),
      this.getUniswapV2Quote(normalizedIn, normalizedOut, amountIn),
    ];

    const results = await Promise.allSettled(quotePromises);
    const quotes = results
      .filter(r => r.status === "fulfilled" && r.value !== null)
      .map(r => r.value)
      .sort((a, b) => (b.outputAmount > a.outputAmount ? 1 : -1));

    logger.debug(`Got ${quotes.length} quotes for ${amountIn} ${tokenIn} → ${tokenOut}`);
    return quotes;
  }

  // ─────────────────────────────────────────────────────────────
  // Uniswap V3 — Quoter Contract
  // ─────────────────────────────────────────────────────────────

  async getUniswapV3Quote(tokenIn, tokenOut, amountIn) {
    try {
      const QUOTER_ABI = [
        "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)",
      ];
      const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
      const quoter = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, this.provider);

      // Try the most liquid fee tiers: 0.05%, 0.3%, 1%
      const feeTiers = [500, 3000, 10000];
      let bestOutput = 0n;
      let bestFee = 3000;

      for (const fee of feeTiers) {
        try {
          const output = await quoter.quoteExactInputSingle.staticCall(
            tokenIn === ETH_ADDRESS ? config.contracts.weth : tokenIn,
            tokenOut === ETH_ADDRESS ? config.contracts.weth : tokenOut,
            fee,
            amountIn,
            0
          );
          if (output > bestOutput) {
            bestOutput = output;
            bestFee = fee;
          }
        } catch {}
      }

      if (bestOutput === 0n) return null;

      // Encode calldata for execution
      const routerABI = [
        "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) returns (uint256)",
      ];
      const routerInterface = new ethers.Interface(routerABI);
      const callData = routerInterface.encodeFunctionData("exactInputSingle", [{
        tokenIn: tokenIn === ETH_ADDRESS ? config.contracts.weth : tokenIn,
        tokenOut: tokenOut === ETH_ADDRESS ? config.contracts.weth : tokenOut,
        fee: bestFee,
        recipient: config.contracts.intentSwap,
        deadline: Math.floor(Date.now() / 1000) + 300,
        amountIn,
        amountOutMinimum: (bestOutput * 95n) / 100n, // 5% slippage on execution
        sqrtPriceLimitX96: 0,
      }]);

      return {
        source: "uniswap_v3",
        outputAmount: bestOutput,
        estimatedGas: 150000n,
        callData,
        routerAddress: config.contracts.uniswapV3Router,
        confidence: 0.95,
        feeTier: bestFee,
      };
    } catch (err) {
      logger.warn("Uniswap V3 quote failed:", err.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 1inch API
  // ─────────────────────────────────────────────────────────────

  async get1inchQuote(tokenIn, tokenOut, amountIn) {
    try {
      const chainId = config.network.chainId;
      const url = `${config.dex.oneInchBaseUrl}/${chainId}/quote`;

      const response = await axios.get(url, {
        params: {
          src: tokenIn,
          dst: tokenOut,
          amount: amountIn.toString(),
          includeGas: true,
        },
        headers: {
          Authorization: `Bearer ${config.dex.oneInchApiKey}`,
        },
        timeout: 5000,
      });

      const data = response.data;
      return {
        source: "1inch",
        outputAmount: BigInt(data.dstAmount),
        estimatedGas: BigInt(data.gas || 200000),
        confidence: 0.9,
        callData: null, // Requires separate /swap call for executable calldata
        routerAddress: config.contracts.oneInchRouter,
      };
    } catch (err) {
      logger.warn("1inch quote failed:", err.message);
      return null;
    }
  }

  /**
   * Get executable 1inch swap calldata (requires separate API call).
   */
  async get1inchSwapData(tokenIn, tokenOut, amountIn, recipient, slippageBps) {
    try {
      const chainId = config.network.chainId;
      const url = `${config.dex.oneInchBaseUrl}/${chainId}/swap`;

      const response = await axios.get(url, {
        params: {
          src: tokenIn,
          dst: tokenOut,
          amount: amountIn.toString(),
          from: config.solver.address,
          receiver: recipient,
          slippage: (slippageBps / 100).toString(),
          disableEstimate: false,
        },
        headers: { Authorization: `Bearer ${config.dex.oneInchApiKey}` },
        timeout: 8000,
      });

      return {
        callData: response.data.tx.data,
        toAmount: BigInt(response.data.dstAmount),
        routerAddress: response.data.tx.to,
        value: BigInt(response.data.tx.value || 0),
      };
    } catch (err) {
      logger.error("1inch swap data failed:", err.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Uniswap V2 — On-chain router
  // ─────────────────────────────────────────────────────────────

  async getUniswapV2Quote(tokenIn, tokenOut, amountIn) {
    try {
      const ROUTER_ABI = [
        "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)",
      ];
      const router = new ethers.Contract(
        config.contracts.uniswapV2Router, ROUTER_ABI, this.provider
      );

      const tokenInAddr = tokenIn === ETH_ADDRESS ? config.contracts.weth : tokenIn;
      const tokenOutAddr = tokenOut === ETH_ADDRESS ? config.contracts.weth : tokenOut;

      // Try direct path, then WETH-routed path
      let amounts;
      try {
        amounts = await router.getAmountsOut(amountIn, [tokenInAddr, tokenOutAddr]);
      } catch {
        amounts = await router.getAmountsOut(amountIn, [tokenInAddr, config.contracts.weth, tokenOutAddr]);
      }

      const outputAmount = amounts[amounts.length - 1];
      return {
        source: "uniswap_v2",
        outputAmount,
        estimatedGas: 120000n,
        confidence: 0.85,
        callData: null,
        routerAddress: config.contracts.uniswapV2Router,
      };
    } catch (err) {
      logger.warn("Uniswap V2 quote failed:", err.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Price oracle (for profitability calculation)
  // ─────────────────────────────────────────────────────────────

  async getTokenPriceUsd(tokenAddress) {
    try {
      const addr = tokenAddress === ETH_ADDRESS
        ? "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
        : tokenAddress;
      const url = `https://api.coingecko.com/api/v3/simple/token_price/ethereum`;
      const response = await axios.get(url, {
        params: { contract_addresses: addr, vs_currencies: "usd" },
        headers: config.dex.coinGeckoApiKey
          ? { "x-cg-demo-api-key": config.dex.coinGeckoApiKey }
          : {},
        timeout: 4000,
      });
      const price = response.data[addr.toLowerCase()]?.usd;
      return price || null;
    } catch {
      return null;
    }
  }
}
