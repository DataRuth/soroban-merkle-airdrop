import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { renderWithNetwork } from "../../test/test-utils";
import NavBar from "./NavBar";

expect.extend(toHaveNoViolations);

vi.mock("@soroban-merkle-airdrop/sdk", () => ({
  NETWORKS: {},
  createAirdropClient: vi.fn(),
  verifyProof: vi.fn(),
}));

vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn(),
  getPublicKey: vi.fn(),
  signTransaction: vi.fn(),
}));

describe("NavBar — network switcher (#81)", () => {
  it("renders with testnet selected by default", () => {
    renderWithNetwork(<NavBar />);
    const select = screen.getByRole("combobox", { name: /select network/i });
    expect(select).toHaveValue("testnet");
  });

  it("shows TESTNET badge by default", () => {
    renderWithNetwork(<NavBar />);
    const badge = screen.getByTestId("network-badge");
    expect(badge).toHaveTextContent(/testnet/i);
  });

  it("switches to mainnet when selected", async () => {
    renderWithNetwork(<NavBar />);
    const select = screen.getByRole("combobox", { name: /select network/i });
    await userEvent.selectOptions(select, "mainnet");
    expect(select).toHaveValue("mainnet");
    const badge = screen.getByTestId("network-badge");
    expect(badge).toHaveTextContent(/mainnet/i);
  });

  it("badge has role=status for live region announcement", () => {
    renderWithNetwork(<NavBar />);
    const badge = screen.getByRole("status", { name: /active network/i });
    expect(badge).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = renderWithNetwork(<NavBar />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
