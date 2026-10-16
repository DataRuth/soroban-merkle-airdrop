"use client";

import React, { createContext, useContext, useState } from "react";

export type Network = "testnet" | "mainnet";

const CONTRACT_IDS: Record<Network, string> = {
  testnet: process.env.NEXT_PUBLIC_AIRDROP_CONTRACT_ID_TESTNET ??
           process.env.NEXT_PUBLIC_AIRDROP_CONTRACT_ID ?? "",
  mainnet: process.env.NEXT_PUBLIC_AIRDROP_CONTRACT_ID_MAINNET ?? "",
};

const BUILD_TIME_DEFAULT: Network =
  (process.env.NEXT_PUBLIC_NETWORK as Network | undefined) === "mainnet"
    ? "mainnet"
    : "testnet";

interface NetworkContextValue {
  network: Network;
  setNetwork: (n: Network) => void;
  contractId: string;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetwork] = useState<Network>(BUILD_TIME_DEFAULT);

  const value: NetworkContextValue = {
    network,
    setNetwork,
    contractId: CONTRACT_IDS[network],
  };

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    throw new Error("useNetwork must be used inside <NetworkProvider>");
  }
  return ctx;
}
