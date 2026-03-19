export const INTENT_SWAP_ADDRESS =
  (process.env.NEXT_PUBLIC_INTENTSWAP_ADDRESS as `0x${string}`) ||
  "0x0000000000000000000000000000000000000000";

export const INTENT_SWAP_ABI = [
  // Events
  {
    type: "event",
    name: "IntentSubmitted",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "inputToken", type: "address", indexed: false },
      { name: "outputToken", type: "address", indexed: false },
      { name: "inputAmount", type: "uint256", indexed: false },
      { name: "minOutput", type: "uint256", indexed: false },
      { name: "deadline", type: "uint256", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "solverTip", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "IntentExecuted",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "solver", type: "address", indexed: true },
      { name: "actualOutput", type: "uint256", indexed: false },
      { name: "protocolFee", type: "uint256", indexed: false },
      { name: "solverTip", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "IntentCancelled",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
    ],
  },
  // Read
  {
    type: "function",
    name: "getCurrentNonce",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getIntentState",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "status", type: "uint8" },
          { name: "submittedAt", type: "uint256" },
          { name: "executingSolver", type: "address" },
          { name: "actualOutput", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getDigest",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "inputToken", type: "address" },
          { name: "outputToken", type: "address" },
          { name: "inputAmount", type: "uint256" },
          { name: "minOutput", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "solverTip", type: "uint256" },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  // Write
  {
    type: "function",
    name: "submitIntent",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "inputToken", type: "address" },
          { name: "outputToken", type: "address" },
          { name: "inputAmount", type: "uint256" },
          { name: "minOutput", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "solverTip", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "intentId", type: "bytes32" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "cancelIntent",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "inputToken", type: "address" },
          { name: "outputToken", type: "address" },
          { name: "inputAmount", type: "uint256" },
          { name: "minOutput", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "solverTip", type: "uint256" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const EIP712_DOMAIN = {
  name: "IntentSwap",
  version: "1",
};

export const INTENT_TYPE = {
  Intent: [
    { name: "user", type: "address" },
    { name: "inputToken", type: "address" },
    { name: "outputToken", type: "address" },
    { name: "inputAmount", type: "uint256" },
    { name: "minOutput", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "solverTip", type: "uint256" },
  ],
};
