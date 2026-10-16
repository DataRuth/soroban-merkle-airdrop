import type { Metadata } from "next";
import { NetworkProvider } from "./context/NetworkContext";
import NavBar from "./components/NavBar";

export const metadata: Metadata = {
  title: "Merkle Airdrop — Stellar",
  description: "Claim your token allocation from this Merkle airdrop on Stellar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Responsive viewport meta — ensures mobile scaling */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: system-ui, sans-serif;
            background: #0a0a0a;
            color: #ededed;
            min-height: 100vh;
          }
          /* ── Nav ─────────────────────────────────────── */
          .nav {
            border-bottom: 1px solid #222;
            padding: 16px 24px;
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
          }
          .nav-logo {
            color: #8ae4ff;
            text-decoration: none;
            font-weight: 700;
            font-size: 18px;
            min-height: 44px;
            display: inline-flex;
            align-items: center;
          }
          .nav-tagline {
            color: #555;
            font-size: 13px;
            flex: 1;
          }
          /* ── Network switcher ────────────────────────── */
          .network-switcher {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-left: auto;
          }
          .network-label {
            font-size: 12px;
            color: #888;
            white-space: nowrap;
          }
          .network-select {
            background: #111;
            color: #ededed;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 6px 10px;
            font-size: 13px;
            cursor: pointer;
            min-height: 44px;
            min-width: 130px;
          }
          .network-select:focus {
            outline: 2px solid #8ae4ff;
            outline-offset: 2px;
          }
          /* ── Network badge ───────────────────────────── */
          .network-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            min-height: 24px;
            line-height: 1.5;
          }
          .network-badge--testnet {
            background: #1a3a1a;
            color: #4caf50;
            border: 1px solid #2e5c2e;
          }
          .network-badge--mainnet {
            background: #3a1a1a;
            color: #ff6b6b;
            border: 1px solid #5c2e2e;
          }
          /* ── Main content ────────────────────────────── */
          .main-content {
            max-width: 760px;
            margin: 0 auto;
            padding: 48px 24px;
          }
          /* ── Footer ──────────────────────────────────── */
          .footer {
            text-align: center;
            padding: 24px;
            color: #555;
            font-size: 13px;
            border-top: 1px solid #1a1a1a;
          }
          .footer a { color: #8ae4ff; }

          /* ── Feature grid (landing page) ─────────────── */
          /* Responsive breakpoints (#79):
           *   ≥ 768px  → 3-column grid (default)
           *   600–767px → 2-column grid
           *   < 600px  → single column (mobile-first)
           * All interactive elements have min-height: 44px (touch target).
           */
          .feature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 20px;
            margin-top: 48px;
          }
          @media (max-width: 600px) {
            .feature-grid {
              grid-template-columns: 1fr;
            }
            .nav { padding: 12px 16px; }
            .main-content { padding: 32px 16px; }
          }
          @media (min-width: 601px) and (max-width: 767px) {
            .feature-grid {
              grid-template-columns: 1fr 1fr;
            }
          }

          /* ── Claim page form ─────────────────────────── */
          .claim-form-section {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .claim-input {
            display: block;
            width: 100%;
            padding: 12px 14px;
            margin-top: 6px;
            font-size: 14px;
            background: #111;
            border: 1px solid #333;
            border-radius: 8px;
            color: #ededed;
            outline: none;
            font-family: monospace;
          }
          .claim-input:focus {
            outline: 2px solid #8ae4ff;
            outline-offset: 2px;
            border-color: #8ae4ff;
          }
          .claim-btn {
            padding: 14px 24px;
            font-weight: 700;
            font-size: 15px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            width: 100%;
            min-height: 44px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .claim-btn:focus-visible {
            outline: 2px solid #8ae4ff;
            outline-offset: 2px;
          }
          .claim-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .tab-btn {
            padding: 8px 18px;
            font-size: 13px;
            background: transparent;
            color: #888;
            border: 1px solid #222;
            border-radius: 8px;
            cursor: pointer;
            min-height: 44px;
          }
          .tab-btn[aria-selected="true"] {
            font-weight: 700;
            background: #1e1e1e;
            color: #ededed;
            border-color: #444;
          }
          .tab-btn:focus-visible {
            outline: 2px solid #8ae4ff;
            outline-offset: 2px;
          }
          /* URL row — stacks on mobile */
          .url-row {
            display: flex;
            gap: 8px;
            margin-top: 6px;
          }
          .url-row .claim-input {
            flex: 1;
            margin-top: 0;
          }
          .url-row .claim-btn {
            width: auto;
            padding: 0 20px;
            white-space: nowrap;
          }
          @media (max-width: 480px) {
            .url-row { flex-direction: column; }
            .url-row .claim-btn { width: 100%; padding: 14px 24px; }
          }

          /* Touch-target helper — guarantee 44×44 on interactive elements */
          a, button, [role="tab"] {
            min-height: 44px;
          }
          /* Logo link inline-flex already handles it; override anchors-in-text */
          .footer a, p a { min-height: unset; }
        `}</style>
      </head>
      <body>
        <NetworkProvider>
          <NavBar />
          <main className="main-content" id="main-content">
            {children}
          </main>
          <footer className="footer">
            Built on Stellar ·{" "}
            <a
              href="https://github.com/eogenyi23-creator/soroban-merkle-airdrop"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </footer>
        </NetworkProvider>
      </body>
    </html>
  );
}
