/**
 * Blockchain Listener
 * Connects to the RPC, subscribes to IntentSubmitted events,
 * and pipes them through to the SolverEngine for processing.
 */

import { ethers } from "ethers";
import { config, INTENT_SWAP_ABI } from "./config/config.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("listener");

export class BlockchainListener {
  constructor(solverEngine) {
    this.solverEngine = solverEngine;
    this.provider = null;
    this.contract = null;
    this.running = false;
    this.processedIntents = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  async start() {
    await this._connect();
    this.running = true;
    this._startStatsLogger();
  }

  async stop() {
    this.running = false;
    if (this.contract) {
      this.contract.removeAllListeners();
    }
    if (this.statsInterval) clearInterval(this.statsInterval);
    logger.info("Listener stopped.");
  }

  async _connect() {
    logger.info(`Connecting to ${config.network.rpcUrl.split("/")[2]}...`);

    // Use WebSocket for real-time events if available
    const wsUrl = config.network.rpcUrl.replace("https://", "wss://").replace("http://", "ws://");
    try {
      this.provider = new ethers.WebSocketProvider(wsUrl);
      await this.provider.getBlockNumber(); // health check
      logger.info("WebSocket connection established");
    } catch {
      // Fallback to polling via HTTP
      logger.info("WebSocket unavailable, using HTTP polling");
      this.provider = new ethers.JsonRpcProvider(config.network.rpcUrl);
    }

    this.contract = new ethers.Contract(
      config.contracts.intentSwap,
      INTENT_SWAP_ABI,
      this.provider
    );

    this._attachListeners();
    await this._catchUpOnMissedIntents();

    // Handle reconnection
    if (this.provider instanceof ethers.WebSocketProvider) {
      this.provider.websocket.on("close", () => {
        if (this.running) this._handleDisconnect();
      });
    }
  }

  _attachListeners() {
    // Listen for new intents
    this.contract.on(
      "IntentSubmitted",
      (intentId, user, inputToken, outputToken, inputAmount, minOutput, deadline, nonce, solverTip, event) => {
        this._handleNewIntent({
          intentId,
          user,
          inputToken,
          outputToken,
          inputAmount,
          minOutput,
          deadline,
          nonce,
          solverTip,
          blockNumber: event.log.blockNumber,
          txHash: event.log.transactionHash,
        });
      }
    );

    // Track executions (to avoid double-processing)
    this.contract.on("IntentExecuted", (intentId) => {
      this.processedIntents.add(intentId);
    });

    this.contract.on("IntentCancelled", (intentId) => {
      this.processedIntents.add(intentId);
    });

    logger.info(`Listening on contract: ${config.contracts.intentSwap}`);
  }

  async _catchUpOnMissedIntents() {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 1000); // look back ~1000 blocks

      logger.info(`Scanning blocks ${fromBlock} → ${currentBlock} for missed intents...`);

      const filter = this.contract.filters.IntentSubmitted();
      const events = await this.contract.queryFilter(filter, fromBlock, currentBlock);

      let missed = 0;
      for (const event of events) {
        const { intentId } = event.args;
        if (!this.processedIntents.has(intentId)) {
          const state = await this.contract.getIntentState(intentId);
          if (state.status === 1n) {
            // Status.Pending
            await this._handleNewIntent({
              intentId: event.args.intentId,
              user: event.args.user,
              inputToken: event.args.inputToken,
              outputToken: event.args.outputToken,
              inputAmount: event.args.inputAmount,
              minOutput: event.args.minOutput,
              deadline: event.args.deadline,
              nonce: event.args.nonce,
              solverTip: event.args.solverTip,
              blockNumber: event.blockNumber,
              txHash: event.transactionHash,
              recovered: true,
            });
            missed++;
          }
        }
      }

      if (missed > 0) logger.info(`Recovered ${missed} pending intents from history`);
    } catch (err) {
      logger.warn("Failed to catch up on missed intents:", err.message);
    }
  }

  async _handleNewIntent(intentData) {
    const id = intentData.intentId;
    if (this.processedIntents.has(id)) return;
    this.processedIntents.add(id);

    const now = Math.floor(Date.now() / 1000);
    const deadline = Number(intentData.deadline);
    const timeRemaining = deadline - now;

    if (timeRemaining <= 0) {
      logger.debug(`Ignoring expired intent ${id.slice(0, 10)}...`);
      return;
    }

    logger.info(
      `🎯 New intent: ${id.slice(0, 10)}... ` +
      `amount=${ethers.formatUnits(intentData.inputAmount, 18)} ` +
      `deadline=${timeRemaining}s`
    );

    // Hand off to solver engine (non-blocking)
    this.solverEngine.processIntent(intentData).catch((err) => {
      logger.error(`Failed to process intent ${id.slice(0, 10)}...:`, err.message);
      // Allow retry
      this.processedIntents.delete(id);
    });
  }

  async _handleDisconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error("Max reconnection attempts reached. Exiting.");
      process.exit(1);
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;
    logger.warn(`Disconnected. Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    await new Promise((r) => setTimeout(r, delay));
    await this._connect();
    this.reconnectAttempts = 0;
  }

  _startStatsLogger() {
    this.statsInterval = setInterval(() => {
      const stats = this.solverEngine.getStats();
      logger.info("📊 Solver Stats:", stats);
    }, config.monitoring.statsIntervalMs);
  }
}
