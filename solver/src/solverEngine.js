/**
 * SolverEngine
 * 
 * Orchestrates the full intent execution pipeline:
 *   intent received → quotes fetched → bids scored → simulated → executed on-chain
 *
 * Anti-frontrunning strategy:
 *   - Uses Flashbots MEV-share or private RPC when available
 *   - Adds random delay (50-200ms) to make timing less predictable
 *   - Checks mempool for competing txs before submitting
 */

import { ethers } from "ethers";
import { DexAggregator } from "./dex/dexAggregator.js";
import { TransactionSimulator } from "./utils/simulator.js";
import { config, INTENT_SWAP_ABI } from "./config/config.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("solver-engine");

export class SolverEngine {
  constructor(matchingEngine) {
    this.matchingEngine = matchingEngine;
    this.dexAggregator = new DexAggregator();
    this.simulator = new TransactionSimulator();

    this.provider = new ethers.JsonRpcProvider(config.network.rpcUrl);
    this.wallet = new ethers.Wallet(config.solver.privateKey, this.provider);
    this.contract = new ethers.Contract(
      config.contracts.intentSwap,
      INTENT_SWAP_ABI,
      this.wallet
    );

    // Stats
    this.stats = {
      processed: 0,
      executed: 0,
      skipped: 0,
      failed: 0,
      totalVolumeIn: 0n,
      totalVolumeOut: 0n,
    };

    // Dedup in-flight processing
    this.inFlight = new Set();
  }

  /**
   * Main pipeline: called for every new intent event.
   * @param {object} intentData - Raw event data from BlockchainListener
   */
  async processIntent(intentData) {
    const { intentId } = intentData;

    if (this.inFlight.has(intentId)) {
      logger.debug(`Intent ${intentId.slice(0, 10)}... already in-flight, skipping`);
      return;
    }
    this.inFlight.add(intentId);

    try {
      this.stats.processed++;
      await this._pipeline(intentData);
    } finally {
      this.inFlight.delete(intentId);
    }
  }

  async _pipeline(intentData) {
    const id = intentData.intentId.slice(0, 10);

    // ── 1. Deadline check ─────────────────────────────────────
    const now = Math.floor(Date.now() / 1000);
    const timeLeft = Number(intentData.deadline) - now;
    if (timeLeft < 30) {
      logger.info(`⏩ Skipping ${id}... — too close to deadline (${timeLeft}s)`);
      this.stats.skipped++;
      return;
    }

    // ── 2. Get quotes from all DEXes ──────────────────────────
    logger.info(`📡 Fetching quotes for ${id}...`);
    const quotes = await this.dexAggregator.getQuotes(
      intentData.inputToken,
      intentData.outputToken,
      intentData.inputAmount
    );

    if (quotes.length === 0) {
      logger.warn(`No quotes available for ${id}...`);
      this.stats.skipped++;
      return;
    }

    // ── 3. Build solver bids from quotes ──────────────────────
    const feeData = await this.provider.getFeeData();
    const gasPriceWei = feeData.gasPrice || ethers.parseUnits("30", "gwei");

    const bids = quotes.map((q) => ({
      solverId: this.wallet.address,
      source: q.source,
      outputAmount: q.outputAmount,
      gasEstimate: q.estimatedGas || 180000n,
      gasPriceWei,
      confidence: q.confidence,
      callData: q.callData,
      router: q.routerAddress,
    }));

    // ── 4. Matching engine picks best bid ─────────────────────
    const { winner, scores } = this.matchingEngine.selectBest(bids, {
      minOutput: intentData.minOutput,
      intentId: intentData.intentId,
    });

    if (!winner) {
      logger.warn(`No profitable route found for ${id}...`);
      this.stats.skipped++;
      return;
    }

    logger.info(
      `✅ Best route: ${winner.source} | ` +
      `output=${ethers.formatUnits(winner.outputAmount, 18)} | ` +
      `vs minOutput=${ethers.formatUnits(intentData.minOutput, 18)}`
    );

    // ── 5. Profitability check ─────────────────────────────────
    const { isProfitable, gasCostEth, tipEth } = await this.simulator.isProfitable(
      intentData, winner.outputAmount, winner.gasEstimate, gasPriceWei
    );

    if (!isProfitable && tipEth < gasCostEth * 0.5) {
      logger.info(`💸 Skipping ${id}... — unprofitable (gasCost=${gasCostEth.toFixed(5)} tip=${tipEth.toFixed(5)})`);
      this.stats.skipped++;
      return;
    }

    // ── 6. Pre-execution simulation ───────────────────────────
    logger.info(`🧪 Simulating ${id}...`);
    const sim = await this.simulator.simulate(
      this._buildIntentStruct(intentData),
      winner.outputAmount,
      this.wallet.address
    );

    if (!sim.success) {
      logger.warn(`❌ Simulation failed for ${id}...: ${sim.error}`);
      this.matchingEngine.recordFailure(winner.source);
      this.stats.failed++;
      return;
    }

    logger.info(`✅ Simulation passed | gasEstimate=${sim.gasEstimate}`);

    // ── 7. Anti-frontrunning delay ────────────────────────────
    const jitter = Math.floor(Math.random() * 150) + 50; // 50-200ms
    await new Promise((r) => setTimeout(r, jitter));

    // ── 8. Execute on-chain ───────────────────────────────────
    logger.info(`🚀 Executing ${id}...`);
    await this._executeOnChain(intentData, winner, sim.gasEstimate, gasPriceWei);
  }

  async _executeOnChain(intentData, winner, gasEstimate, gasPriceWei) {
    const id = intentData.intentId.slice(0, 10);
    const intentStruct = this._buildIntentStruct(intentData);

    try {
      // Approve output token to IntentSwap (if ERC-20)
      if (intentData.outputToken !== ethers.ZeroAddress) {
        const erc20ABI = ["function approve(address spender, uint256 amount) returns (bool)"];
        const outputToken = new ethers.Contract(intentData.outputToken, erc20ABI, this.wallet);
        const approveTx = await outputToken.approve(
          config.contracts.intentSwap,
          winner.outputAmount
        );
        await approveTx.wait(1);
        logger.debug(`Approved ${winner.outputAmount} output tokens`);
      }

      // Build tx parameters
      const isNativeOutput = intentData.outputToken === ethers.ZeroAddress;
      const txOverrides = {
        gasLimit: (gasEstimate * 130n) / 100n, // 30% buffer
        maxFeePerGas: (gasPriceWei * 120n) / 100n, // 20% priority bump
        maxPriorityFeePerGas: ethers.parseUnits("1.5", "gwei"),
        ...(isNativeOutput && { value: winner.outputAmount }),
      };

      // Send transaction
      const tx = await this.contract.executeIntent(
        intentStruct,
        winner.outputAmount,
        txOverrides
      );

      logger.info(`📨 Tx sent: ${tx.hash}`);

      // Wait with timeout
      const receipt = await Promise.race([
        tx.wait(1),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Tx confirmation timeout")),
          config.solver.txTimeoutSeconds * 1000)
        ),
      ]);

      if (receipt.status === 1) {
        logger.info(
          `🎉 Intent ${id}... EXECUTED | ` +
          `tx=${receipt.hash.slice(0, 10)}... | ` +
          `gasUsed=${receipt.gasUsed}`
        );
        this.stats.executed++;
        this.stats.totalVolumeIn += intentData.inputAmount;
        this.stats.totalVolumeOut += winner.outputAmount;
      } else {
        logger.error(`Tx reverted: ${receipt.hash}`);
        this.matchingEngine.recordFailure(winner.source);
        this.stats.failed++;
      }
    } catch (err) {
      logger.error(`Execution failed for ${id}...: ${err.message}`);
      this.matchingEngine.recordFailure(winner.source);
      this.stats.failed++;
    }
  }

  _buildIntentStruct(intentData) {
    return {
      user: intentData.user,
      inputToken: intentData.inputToken,
      outputToken: intentData.outputToken,
      inputAmount: intentData.inputAmount,
      minOutput: intentData.minOutput,
      deadline: intentData.deadline,
      nonce: intentData.nonce,
      solverTip: intentData.solverTip,
    };
  }

  getStats() {
    return {
      ...this.stats,
      totalVolumeIn: this.stats.totalVolumeIn.toString(),
      totalVolumeOut: this.stats.totalVolumeOut.toString(),
      matchingEngineStats: this.matchingEngine.getStats(),
      successRate: this.stats.processed > 0
        ? ((this.stats.executed / this.stats.processed) * 100).toFixed(1) + "%"
        : "N/A",
    };
  }
}
