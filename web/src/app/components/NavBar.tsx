"use client";

import { useNetwork, type Network } from "../context/NetworkContext";

export default function NavBar() {
  const { network, setNetwork } = useNetwork();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setNetwork(e.target.value as Network);
  }

  return (
    <nav className="nav" aria-label="Site navigation">
      <a href="/" className="nav-logo">
        🪂 Merkle Airdrop
      </a>
      <span className="nav-tagline" aria-hidden="true">
        Powered by Soroban · Stellar
      </span>

      {/* ── Network switcher + badge ── */}
      <div className="network-switcher">
        <label htmlFor="network-select" className="network-label">
          Network:
        </label>
        <select
          id="network-select"
          value={network}
          onChange={handleChange}
          className="network-select"
          aria-label="Select network"
        >
          <option value="testnet">Testnet</option>
          <option value="mainnet">Mainnet</option>
        </select>

        {/* Visual badge — announces the currently active network */}
        <span
          className={`network-badge network-badge--${network}`}
          role="status"
          aria-live="polite"
          aria-label={`Active network: ${network}`}
          data-testid="network-badge"
        >
          {network}
        </span>
      </div>
    </nav>
  );
}
