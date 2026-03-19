/**
 * Matching Engine
 * 
 * Accepts multiple solver bids for a given intent and selects
 * the best one based on a scoring model that considers:
 *   1. Net output to user (primary)
 *   2. Gas cost (secondary)
 *   3. Source reliability confidence
 *
 * In production, bids from competing external solvers would be submitted
 * via a signed off-chain message system (e.g., a public orderbook RPC endpoint).
 * Here we model multi-source bids within one solver to pick the best route.
 */

import { ethers } from "ethers";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("matching-engine");

/**
 * @typedef {Object} SolverBid
 * @property {string}  solverId      - Unique identifier (address or name)
 * @property {string}  source        - Quote source (uniswap_v3 | 1inch | uniswap_v2)
 * @property {bigint}  outputAmount  - Raw output tokens the solver can deliver
 * @property {bigint}  gasEstimate   - Estimated gas units
 * @property {bigint}  gasPriceWei   - Gas price at time of bid
 * @property {number}  confidence    - 0-1 reliability score
 * @property {string}  [callData]    - Ready-to-execute swap calldata
 * @property {string}  [router]      - DEX router address
 */

export class MatchingEngine {
  constructor() {
    // Historical execution stats per source (for confidence weighting)
    this.executionStats = new Map();
    this.totalMatches = 0;
    this.totalVolume = 0n;
  }

  /**
   * Select the best bid from a list of competing solver bids.
   * 
   * Scoring formula:
   *   score = netOutput - gasCostInOutputToken
   *         × confidence × historicalReliability
   *
   * @param {SolverBid[]} bids
   * @param {object}      intent  - Original intent (for context)
   * @returns {{ winner: SolverBid, scores: Array, rejected: Array }}
   */
  selectBest(bids, intent) {
    if (!bids || bids.length === 0) {
      return { winner: null, scores: [], rejected: [] };
    }

    logger.debug(`Evaluating ${bids.length} bids for intent ${intent.intentId?.slice(0, 10)}...`);

    const scored = bids
      .filter(bid => this._isEligible(bid, intent))
      .map(bid => ({
        bid,
        score: this._score(bid, intent),
        eligible: true,
      }));

    const rejected = bids.filter(b => !scored.find(s => s.bid === b)).map(b => ({
      bid: b,
      reason: this._rejectionReason(b, intent),
    }));

    if (scored.length === 0) {
      logger.warn("No eligible bids found");
      return { winner: null, scores: scored, rejected };
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0].bid;

    logger.info(`Best bid: ${winner.source} | output=${ethers.formatUnits(winner.outputAmount, 18)} | score=${scored[0].score.toFixed(4)}`);

    this._recordStats(winner);
    this.totalMatches++;
    this.totalVolume += winner.outputAmount;

    return { winner, scores: scored, rejected };
  }

  // ─────────────────────────────────────────────────────────────
  // Eligibility checks (hard constraints)
  // ─────────────────────────────────────────────────────────────

  _isEligible(bid, intent) {
    // Must meet minimum output
    if (bid.outputAmount < intent.minOutput) {
      return false;
    }
    // Must have non-zero output
    if (bid.outputAmount === 0n) {
      return false;
    }
    // Gas price sanity check (in gwei)
    const gasPriceGwei = Number(bid.gasPriceWei) / 1e9;
    if (gasPriceGwei > 500) {
      return false; // Reject absurd gas prices
    }
    return true;
  }

  _rejectionReason(bid, intent) {
    if (bid.outputAmount < intent.minOutput) return "output_below_minimum";
    if (bid.outputAmount === 0n) return "zero_output";
    if (Number(bid.gasPriceWei) / 1e9 > 500) return "gas_price_too_high";
    return "unknown";
  }

  // ─────────────────────────────────────────────────────────────
  // Scoring model
  // ─────────────────────────────────────────────────────────────

  _score(bid, intent) {
    // Baseline: raw output normalised to 0-1 range against minOutput
    const minOut = Number(intent.minOutput);
    const output = Number(bid.outputAmount);
    const outputScore = (output - minOut) / minOut; // excess over minimum

    // Gas cost penalty: convert gas to output-token equivalent
    // Using a rough ETH price in output token terms (simplified)
    const gasUnits = Number(bid.gasEstimate || 150000n);
    const gasPriceGwei = Number(bid.gasPriceWei || 30n * 10n**9n) / 1e9;
    const gasCostEth = (gasUnits * gasPriceGwei) / 1e9;
    // Penalty proportional to output (lower is better)
    const gasPenalty = gasCostEth * 1000; // scale factor

    // Source confidence (0-1)
    const confidence = bid.confidence || 0.8;

    // Historical reliability for this source
    const reliability = this._getReliability(bid.source);

    // Composite score
    const score = (outputScore - gasPenalty * 0.1) * confidence * reliability;

    logger.debug(`  ${bid.source}: output=${output} gasPenalty=${gasPenalty.toFixed(4)} confidence=${confidence} → score=${score.toFixed(4)}`);

    return score;
  }

  _getReliability(source) {
    const stats = this.executionStats.get(source);
    if (!stats || stats.attempts === 0) return 1.0; // No history = neutral
    return stats.successes / stats.attempts;
  }

  _recordStats(bid) {
    if (!this.executionStats.has(bid.source)) {
      this.executionStats.set(bid.source, { attempts: 0, successes: 0 });
    }
    const s = this.executionStats.get(bid.source);
    s.attempts++;
    s.successes++; // Updated to failure on tx revert (wired up in SolverEngine)
  }

  recordFailure(source) {
    const s = this.executionStats.get(source);
    if (s && s.successes > 0) s.successes--;
  }

  getStats() {
    return {
      totalMatches: this.totalMatches,
      totalVolume: this.totalVolume.toString(),
      sourceReliability: Object.fromEntries(
        Array.from(this.executionStats.entries()).map(([k, v]) => [k, {
          attempts: v.attempts,
          successes: v.successes,
          reliability: v.attempts > 0 ? (v.successes / v.attempts).toFixed(3) : "N/A",
        }])
      ),
    };
  }
}
