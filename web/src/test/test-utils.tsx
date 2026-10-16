import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { NetworkProvider } from "../app/context/NetworkContext";

function AllProviders({ children }: { children: React.ReactNode }) {
  return <NetworkProvider>{children}</NetworkProvider>;
}

export function renderWithNetwork(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export * from "@testing-library/react";
