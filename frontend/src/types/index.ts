export interface Intent {
  user: `0x${string}`;
  inputToken: `0x${string}`;
  outputToken: `0x${string}`;
  inputAmount: bigint;
  minOutput: bigint;
  deadline: bigint;
  nonce: bigint;
  solverTip: bigint;
}

export interface SolverBid {
  source: string;
  outputAmount: bigint;
  gasEstimate: bigint;
  confidence: number;
  timestamp: number;
}

export interface IntentStatus {
  intentId: `0x${string}`;
  status: "pending" | "executed" | "cancelled" | "expired";
  submittedAt: number;
  executingSolver?: `0x${string}`;
  actualOutput?: bigint;
  bids?: SolverBid[];
}

export interface TokenInfo {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  priceUsd?: number;
}

export interface SwapQuote {
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  inputAmount: bigint;
  estimatedOutput: bigint;
  minOutput: bigint;
  priceImpact: number;
  gasEstimate: bigint;
  route: string[];
}

export const KNOWN_TOKENS: Record<string, TokenInfo> = {
  ETH: {
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    symbol: "ETH",
    name: "Ethereum",
    decimals: 18,
    logoURI: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  },
  USDC: {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoURI: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
  },
  USDT: {
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    logoURI: "https://assets.coingecko.com/coins/images/325/small/Tether.png",
  },
  WBTC: {
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
    logoURI: "https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png",
  },
  DAI: {
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
    logoURI: "https://assets.coingecko.com/coins/images/9956/small/4943.png",
  },
};
