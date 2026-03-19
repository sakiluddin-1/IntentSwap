// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IntentSwap.sol";

/**
 * @title IntentSwapRouter
 * @notice Atomic helper that lets a solver:
 *   1. Receive input tokens from IntentSwap escrow
 *   2. Execute a DEX swap inline
 *   3. Deliver output tokens back — all in one transaction.
 *
 * This prevents solvers needing pre-funded balances. The router acts
 * as an intermediary with a callback-style atomic execution.
 */
contract IntentSwapRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IntentSwap public immutable intentSwap;

    event AtomicExecutionCompleted(bytes32 indexed intentId, address indexed solver, uint256 output);

    error SwapFailed(bytes reason);
    error SlippageExceeded(uint256 received, uint256 minimum);

    constructor(address _intentSwap) {
        intentSwap = IntentSwap(payable(_intentSwap));
    }

    /**
     * @notice Execute an intent atomically via an external DEX.
     * @param intent     The intent to execute
     * @param dex        The DEX router address to call
     * @param swapData   Encoded calldata for the DEX (pre-computed off-chain)
     * @param minOutput  Minimum output to enforce (should match intent.minOutput)
     */
    function atomicExecute(
        IntentSwap.Intent calldata intent,
        address dex,
        bytes calldata swapData,
        uint256 minOutput
    ) external nonReentrant {
        // Approve IntentSwap to pull input from this router
        if (intent.inputToken != address(0)) {
            IERC20(intent.inputToken).approve(address(intentSwap), 0);
        }

        uint256 outputBefore = intent.outputToken == address(0)
            ? address(this).balance
            : IERC20(intent.outputToken).balanceOf(address(this));

        // Execute swap via DEX
        (bool success, bytes memory result) = dex.call(swapData);
        if (!success) revert SwapFailed(result);

        uint256 outputAfter = intent.outputToken == address(0)
            ? address(this).balance
            : IERC20(intent.outputToken).balanceOf(address(this));

        uint256 received = outputAfter - outputBefore;
        if (received < minOutput) revert SlippageExceeded(received, minOutput);

        // Approve IntentSwap to pull output tokens from this router
        if (intent.outputToken != address(0)) {
            IERC20(intent.outputToken).approve(address(intentSwap), received);
        }

        // Call executeIntent — transfers output to user, releases input to solver
        if (intent.outputToken == address(0)) {
            intentSwap.executeIntent{value: received}(intent, received);
        } else {
            intentSwap.executeIntent(intent, received);
        }

        emit AtomicExecutionCompleted(keccak256(abi.encode(intent)), msg.sender, received);
    }

    receive() external payable {}
}
