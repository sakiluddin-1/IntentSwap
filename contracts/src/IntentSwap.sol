// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title IntentSwap
 * @notice Intent-based DeFi execution system where solvers compete to fill orders optimally.
 * @dev Uses EIP-712 typed data signing, on-chain escrow, and pull-based solver settlement.
 *
 * Security model:
 *  - Funds escrowed in contract until execution or cancellation
 *  - EIP-712 prevents cross-chain replay attacks
 *  - Per-user nonces prevent same-chain replay attacks
 *  - CEI pattern throughout to prevent reentrancy
 *  - minOutput enforced on-chain (slippage protection)
 *  - Deadline enforced on-chain (stale intent protection)
 */
contract IntentSwap is ReentrancyGuard, Pausable, Ownable, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ─────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────

    struct Intent {
        address user;
        address inputToken;   // address(0) = native ETH
        address outputToken;  // address(0) = native ETH
        uint256 inputAmount;
        uint256 minOutput;
        uint256 deadline;
        uint256 nonce;
        uint256 solverTip;    // bonus paid to winning solver
    }

    enum IntentStatus { NonExistent, Pending, Executed, Cancelled }

    struct IntentState {
        IntentStatus status;
        uint256 submittedAt;
        address executingSolver;
        uint256 actualOutput;
    }

    // ─────────────────────────────────────────────────────────────
    // EIP-712 Type Hash
    // ─────────────────────────────────────────────────────────────

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "Intent(address user,address inputToken,address outputToken,"
        "uint256 inputAmount,uint256 minOutput,uint256 deadline,"
        "uint256 nonce,uint256 solverTip)"
    );

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    mapping(bytes32 => IntentState) public intents;
    mapping(address => uint256) public nonces;
    mapping(address => bool) public approvedSolvers;

    bool public permissionlessSolvers;
    uint16 public protocolFeeBps;
    address public feeRecipient;

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event IntentSubmitted(
        bytes32 indexed intentId,
        address indexed user,
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minOutput,
        uint256 deadline,
        uint256 nonce,
        uint256 solverTip
    );

    event IntentExecuted(
        bytes32 indexed intentId,
        address indexed solver,
        uint256 actualOutput,
        uint256 protocolFee,
        uint256 solverTip
    );

    event IntentCancelled(bytes32 indexed intentId, address indexed user);
    event SolverApproved(address indexed solver, bool approved);
    event ProtocolFeeUpdated(uint16 newFeeBps);

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error IntentExpired();
    error IntentNotPending();
    error IntentAlreadyExists();
    error InvalidSignature();
    error InvalidNonce();
    error OutputBelowMinimum(uint256 actual, uint256 minimum);
    error UnauthorizedSolver();
    error NativeTransferFailed();
    error InvalidFee();
    error ZeroAddress();
    error DeadlineTooShort();
    error IncorrectETHValue();
    error CancelNotAllowed();

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _feeRecipient,
        uint16 _protocolFeeBps
    ) EIP712("IntentSwap", "1") Ownable(msg.sender) {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_protocolFeeBps > 500) revert InvalidFee();
        feeRecipient = _feeRecipient;
        protocolFeeBps = _protocolFeeBps;
        permissionlessSolvers = true;
    }

    // ─────────────────────────────────────────────────────────────
    // Core: submitIntent
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Submit a signed intent and escrow the input funds.
     * @param intent    The Intent struct matching the off-chain signature.
     * @param signature EIP-712 signature produced by intent.user.
     * @return intentId Unique identifier for this intent.
     */
    function submitIntent(
        Intent calldata intent,
        bytes calldata signature
    ) external payable nonReentrant whenNotPaused returns (bytes32 intentId) {
        if (intent.deadline <= block.timestamp) revert IntentExpired();
        if (intent.deadline < block.timestamp + 60) revert DeadlineTooShort();
        if (intent.nonce != nonces[intent.user]) revert InvalidNonce();

        intentId = _intentId(intent);
        if (intents[intentId].status != IntentStatus.NonExistent) revert IntentAlreadyExists();

        // Verify EIP-712 signature
        bytes32 digest = _hashTypedDataV4(_structHash(intent));
        address signer = digest.recover(signature);
        if (signer != intent.user) revert InvalidSignature();

        // Increment nonce before any external calls
        unchecked { nonces[intent.user]++; }

        // Escrow total = inputAmount + solverTip
        uint256 totalEscrow = intent.inputAmount + intent.solverTip;
        if (intent.inputToken == address(0)) {
            if (msg.value != totalEscrow) revert IncorrectETHValue();
        } else {
            IERC20(intent.inputToken).safeTransferFrom(intent.user, address(this), totalEscrow);
        }

        intents[intentId] = IntentState({
            status: IntentStatus.Pending,
            submittedAt: block.timestamp,
            executingSolver: address(0),
            actualOutput: 0
        });

        emit IntentSubmitted(
            intentId, intent.user, intent.inputToken, intent.outputToken,
            intent.inputAmount, intent.minOutput, intent.deadline, intent.nonce, intent.solverTip
        );
    }

    // ─────────────────────────────────────────────────────────────
    // Core: executeIntent
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Execute a pending intent as a solver.
     * @dev Pull model: solver pre-approves outputToken to this contract before calling.
     *      For native ETH output, solver sends msg.value == outputAmount.
     *      Execution order (CEI + pull):
     *        1. Validate
     *        2. Update state
     *        3. Pull outputToken from solver → send to user
     *        4. Push inputToken from escrow → solver (minus fee)
     *
     * @param intent        The original intent struct.
     * @param outputAmount  Amount of outputToken solver will deliver (must >= minOutput).
     */
    function executeIntent(
        Intent calldata intent,
        uint256 outputAmount
    ) external payable nonReentrant whenNotPaused {
        if (!permissionlessSolvers && !approvedSolvers[msg.sender]) revert UnauthorizedSolver();

        bytes32 intentId = _intentId(intent);
        IntentState storage state = intents[intentId];

        if (state.status != IntentStatus.Pending) revert IntentNotPending();

        // Auto-cancel expired intents on execution attempt
        if (intent.deadline < block.timestamp) {
            state.status = IntentStatus.Cancelled;
            _refundUser(intent);
            emit IntentCancelled(intentId, intent.user);
            return;
        }

        if (outputAmount < intent.minOutput) revert OutputBelowMinimum(outputAmount, intent.minOutput);

        // Compute fee split
        uint256 fee = (intent.inputAmount * protocolFeeBps) / 10_000;
        uint256 solverReceives = intent.inputAmount - fee;

        // === State update (CEI) ===
        state.status = IntentStatus.Executed;
        state.executingSolver = msg.sender;
        state.actualOutput = outputAmount;

        // === Transfer output: solver → user ===
        if (intent.outputToken == address(0)) {
            if (msg.value != outputAmount) revert IncorrectETHValue();
            _safeTransferETH(intent.user, outputAmount);
        } else {
            IERC20(intent.outputToken).safeTransferFrom(msg.sender, intent.user, outputAmount);
        }

        // === Release escrowed input: contract → solver ===
        if (intent.inputToken == address(0)) {
            _safeTransferETH(msg.sender, solverReceives);
            if (fee > 0) _safeTransferETH(feeRecipient, fee);
            if (intent.solverTip > 0) _safeTransferETH(msg.sender, intent.solverTip);
        } else {
            IERC20(intent.inputToken).safeTransfer(msg.sender, solverReceives + intent.solverTip);
            if (fee > 0) IERC20(intent.inputToken).safeTransfer(feeRecipient, fee);
        }

        emit IntentExecuted(intentId, msg.sender, outputAmount, fee, intent.solverTip);
    }

    // ─────────────────────────────────────────────────────────────
    // Cancellation
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Cancel an expired intent and reclaim escrowed funds.
     * @dev Users can cancel after deadline. Protocol owner can emergency-cancel.
     */
    function cancelIntent(Intent calldata intent) external nonReentrant {
        bytes32 intentId = _intentId(intent);
        IntentState storage state = intents[intentId];
        if (state.status != IntentStatus.Pending) revert IntentNotPending();

        bool isExpiredAndUser = (block.timestamp >= intent.deadline) && (msg.sender == intent.user);
        bool isProtocolOwner = msg.sender == owner();
        if (!isExpiredAndUser && !isProtocolOwner) revert CancelNotAllowed();

        state.status = IntentStatus.Cancelled;
        _refundUser(intent);
        emit IntentCancelled(intentId, intent.user);
    }

    // ─────────────────────────────────────────────────────────────
    // View functions
    // ─────────────────────────────────────────────────────────────

    function getIntentId(Intent calldata intent) external pure returns (bytes32) {
        return _intentId(intent);
    }

    function getIntentState(bytes32 intentId) external view returns (IntentState memory) {
        return intents[intentId];
    }

    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getDigest(Intent calldata intent) external view returns (bytes32) {
        return _hashTypedDataV4(_structHash(intent));
    }

    function getCurrentNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    // ─────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────

    function setSolverApproval(address solver, bool approved) external onlyOwner {
        approvedSolvers[solver] = approved;
        emit SolverApproved(solver, approved);
    }

    function setPermissionlessSolvers(bool open) external onlyOwner {
        permissionlessSolvers = open;
    }

    function setProtocolFee(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > 500) revert InvalidFee();
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(newFeeBps);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────

    function _intentId(Intent calldata intent) internal pure returns (bytes32) {
        return keccak256(abi.encode(intent));
    }

    function _structHash(Intent calldata intent) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            INTENT_TYPEHASH,
            intent.user, intent.inputToken, intent.outputToken,
            intent.inputAmount, intent.minOutput, intent.deadline,
            intent.nonce, intent.solverTip
        ));
    }

    function _refundUser(Intent calldata intent) internal {
        uint256 total = intent.inputAmount + intent.solverTip;
        if (intent.inputToken == address(0)) {
            _safeTransferETH(intent.user, total);
        } else {
            IERC20(intent.inputToken).safeTransfer(intent.user, total);
        }
    }

    function _safeTransferETH(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }

    receive() external payable {}
}
