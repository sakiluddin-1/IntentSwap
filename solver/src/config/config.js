export const config = {
  network: {
    name: process.env.NETWORK_NAME || "mainnet",
    rpcUrl: process.env.RPC_URL || "https://eth-mainnet.g.alchemy.com/v2/your-key",
    chainId: parseInt(process.env.CHAIN_ID || "1"),
    alchemyApiKey: process.env.ALCHEMY_API_KEY || "",
    tenderlyKey: process.env.TENDERLY_API_KEY || "",
    tenderlyUser: process.env.TENDERLY_USER || "",
    tenderlyProject: process.env.TENDERLY_PROJECT || "",
  },
  contracts: {
    intentSwap: process.env.INTENTSWAP_ADDRESS || "0x0000000000000000000000000000000000000000",
    uniswapV3Router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    uniswapV2Router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    oneInchRouter: "0x1111111254EEB25477B68fb85Ed929f73A960582",
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  solver: {
    privateKey: process.env.SOLVER_PRIVATE_KEY || "",
    address: process.env.SOLVER_ADDRESS || "",
    minProfitUsd: parseFloat(process.env.MIN_PROFIT_USD || "1.0"),
    maxGasPriceGwei: parseFloat(process.env.MAX_GAS_PRICE_GWEI || "50"),
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || "50"),
    txTimeoutSeconds: parseInt(process.env.TX_TIMEOUT_SECONDS || "120"),
  },
  dex: {
    oneInchApiKey: process.env.ONE_INCH_API_KEY || "",
    oneInchBaseUrl: "https://api.1inch.dev/swap/v6.0",
    coinGeckoApiKey: process.env.COINGECKO_API_KEY || "",
  },
  monitoring: {
    logLevel: process.env.LOG_LEVEL || "info",
    statsIntervalMs: parseInt(process.env.STATS_INTERVAL_MS || "60000"),
  },
};

export const INTENT_SWAP_ABI = [
  "event IntentSubmitted(bytes32 indexed intentId, address indexed user, address inputToken, address outputToken, uint256 inputAmount, uint256 minOutput, uint256 deadline, uint256 nonce, uint256 solverTip)",
  "event IntentExecuted(bytes32 indexed intentId, address indexed solver, uint256 actualOutput, uint256 protocolFee, uint256 solverTip)",
  "event IntentCancelled(bytes32 indexed intentId, address indexed user)",
  "function executeIntent(tuple(address user, address inputToken, address outputToken, uint256 inputAmount, uint256 minOutput, uint256 deadline, uint256 nonce, uint256 solverTip) intent, uint256 outputAmount) payable",
  "function getIntentState(bytes32 intentId) view returns (tuple(uint8 status, uint256 submittedAt, address executingSolver, uint256 actualOutput))",
];
