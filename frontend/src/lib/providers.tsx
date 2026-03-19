"use client";

import "@rainbow-me/rainbowkit/styles.css";
import {
  RainbowKitProvider,
  darkTheme,
  connectorsForWallets,
} from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  coinbaseWallet,
  walletConnectWallet,
  rainbowWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, sepolia, hardhat } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      wallets: [metaMaskWallet, coinbaseWallet, rainbowWallet, walletConnectWallet],
    },
  ],
  {
    appName: "IntentSwap",
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "intentswap-demo",
  }
);

export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia, hardhat],
  connectors,
  transports: {
    [mainnet.id]: http(process.env.NEXT_PUBLIC_MAINNET_RPC || ""),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC || ""),
    [hardhat.id]: http("http://localhost:8545"),
  },
});

const queryClient = new QueryClient();

const intentSwapTheme = darkTheme({
  accentColor: "#00FFB3",
  accentColorForeground: "#0A0A0F",
  borderRadius: "medium",
  fontStack: "system",
  overlayBlur: "small",
});

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={intentSwapTheme} coolMode>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
