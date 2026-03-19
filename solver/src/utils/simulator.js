/**
 * Transaction Simulator
 * 
 * Simulates executeIntent() transactions before broadcasting
 * to catch failures early and avoid wasted gas.
 *
 * Supports:
 *   - Tenderly Simulation API (rich traces + state diffs)
 *   - Alchemy eth_call simulation (lighter weight)
 */

import axios from "axios";
import { ethers } from "ethers";
import { config, INTENT_SWAP_ABI } from "../config/config.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("simulator");

export class TransactionSimulator {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.network.rpcUrl);
    this.intentSwap = new ethers.Contract(
      config.contracts.intentSwap, INTENT_SWAP_ABI, this.provider
    );
  }

  /**
   * Simulate an executeIntent() transaction before sending.
   * @param {object} intent
   * @param {bigint} outputAmount
   * @param {string} solverAddress
   * @returns {{ success: boolean, gasEstimate: bigint, error?: string, trace?: object }}
   */
  async simulate(intent, outputAmount, solverAddress) {
    // Try Tenderly first (richest simulation), fall back to eth_call
    if (config.network.tenderlyKey && config.network.tenderlyUser) {
      try {
        return await this.simulateWithTenderly(intent, outputAmount, solverAddress);
      } catch (err) {
        logger.warn("Tenderly simulation failed, falling back to eth_call:", err.message);
      }
    }

    return await this.simulateWithEthCall(intent, outputAmount, solverAddress);
  }

  // ─────────────────────────────────────────────────────────────
  // Tenderly Simulation
  // ─────────────────────────────────────────────────────────────

  async simulateWithTenderly(intent, outputAmount, solverAddress) {
    const iface = new ethers.Interface(INTENT_SWAP_ABI);
    const callData = iface.encodeFunctionData("executeIntent", [intent, outputAmount]);

    const body = {
      network_id: config.network.chainId.toString(),
      from: solverAddress,
      to: config.contracts.intentSwap,
      input: callData,
      gas: 500000,
      gas_price: "0",
      value: intent.outputToken === ethers.ZeroAddress ? outputAmount.toString() : "0",
      save: false,
      save_if_fails: true,
    };

    const url = `https://api.tenderly.co/api/v1/account/${config.network.tenderlyUser}/project/${config.network.tenderlyProject}/simulate`;

    const response = await axios.post(url, body, {
      headers: {
        "X-Access-Key": config.network.tenderlyKey,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const sim = response.data.simulation;
    if (!sim.status) {
      return {
        success: false,
        gasEstimate: BigInt(sim.gas_used || 0),
        error: sim.error_message || "Simulation failed",
        trace: response.data,
      };
    }

    logger.debug(`Tenderly simulation: ✅ gas=${sim.gas_used}`);
    return {
      success: true,
      gasEstimate: BigInt(sim.gas_used),
      trace: response.data,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Alchemy / generic eth_call simulation
  // ─────────────────────────────────────────────────────────────

  async simulateWithEthCall(intent, outputAmount, solverAddress) {
    try {
      // Use provider's call() with state overrides
      const iface = new ethers.Interface(INTENT_SWAP_ABI);
      const callData = iface.encodeFunctionData("executeIntent", [intent, outputAmount]);

      await this.provider.call({
        from: solverAddress,
        to: config.contracts.intentSwap,
        data: callData,
        value: intent.outputToken === ethers.ZeroAddress ? outputAmount : 0n,
      });

      // Estimate gas separately
      const gasEstimate = await this.provider.estimateGas({
        from: solverAddress,
        to: config.contracts.intentSwap,
        data: callData,
        value: intent.outputToken === ethers.ZeroAddress ? outputAmount : 0n,
      });

      logger.debug(`eth_call simulation: ✅ gasEstimate=${gasEstimate}`);
      return { success: true, gasEstimate };
    } catch (err) {
      const decodedError = this._decodeRevertReason(err);
      logger.warn(`eth_call simulation: ❌ ${decodedError}`);
      return { success: false, gasEstimate: 0n, error: decodedError };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Profitability check
  // ─────────────────────────────────────────────────────────────

  async isProfitable(intent, outputAmount, gasEstimate, gasPriceWei) {
    const gasCostWei = gasEstimate * gasPriceWei;
    const gasCostEth = Number(gasCostWei) / 1e18;

    // Solver tip covers gas?
    const tipEth = Number(intent.solverTip) / 1e18;
    const netProfitEth = tipEth - gasCostEth;

    // If tip doesn't cover gas, check if output excess covers it
    // (This requires price feed — simplified here)
    const isProfitable = netProfitEth >= 0 || tipEth > gasCostEth * 0.8;

    logger.debug(`Profitability: gasCost=${gasCostEth.toFixed(5)} ETH | tip=${tipEth.toFixed(5)} ETH | profitable=${isProfitable}`);
    return { isProfitable, gasCostEth, tipEth, netProfitEth };
  }

  _decodeRevertReason(err) {
    if (err.data) {
      try {
        const iface = new ethers.Interface(INTENT_SWAP_ABI);
        return iface.parseError(err.data)?.name || err.message;
      } catch {}
    }
    return err.message || "Unknown error";
  }
}
