/**
 * IntentSwap Solver — Entry Point
 * 
 * Starts the full solver pipeline:
 *   1. Listens for IntentSubmitted events on-chain
 *   2. Queries DEX APIs for best execution routes
 *   3. Runs through the matching engine to pick best quote
 *   4. Submits executeIntent() transaction on-chain
 */

import dotenv from "dotenv";
import { createLogger } from "./utils/logger.js";
import { SolverEngine } from "./solverEngine.js";
import { BlockchainListener } from "./blockchainListener.js";
import { MatchingEngine } from "./matching/matchingEngine.js";
import { config } from "./config/config.js";

dotenv.config();

const logger = createLogger("main");

async function main() {
  logger.info("════════════════════════════════════════");
  logger.info("   IntentSwap Solver v1.0.0 Starting   ");
  logger.info("════════════════════════════════════════");
  logger.info(`Network:  ${config.network.name}`);
  logger.info(`Contract: ${config.contracts.intentSwap}`);
  logger.info(`Solver:   ${config.solver.address}`);

  const matchingEngine = new MatchingEngine();
  const solverEngine = new SolverEngine(matchingEngine);
  const listener = new BlockchainListener(solverEngine);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("Shutting down gracefully...");
    await listener.stop();
    process.exit(0);
  });

  await listener.start();
  logger.info("✅ Solver is running. Listening for intents...\n");
}

main().catch((err) => {
  logger.error("Fatal error:", err);
  process.exit(1);
});
