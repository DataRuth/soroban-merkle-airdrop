import Link from "next/link";

export default function HomePage() {
  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 56 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }} aria-hidden="true">🪂</div>
        <h1 style={{ fontSize: "clamp(28px, 6vw, 40px)", fontWeight: 800, marginBottom: 12 }}>
          Token Airdrop
        </h1>
        <p style={{ color: "#aaa", fontSize: "clamp(15px, 3vw, 18px)", maxWidth: 540, margin: "0 auto 32px" }}>
          Check if your address is eligible and claim your tokens using a
          cryptographic Merkle proof — verified on-chain.
        </p>
        <Link
          href="/claim"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "14px 36px",
            background: "#8ae4ff",
            color: "#000",
            fontWeight: 700,
            fontSize: 16,
            borderRadius: 10,
            textDecoration: "none",
            minHeight: 44,
          }}
        >
          Check Eligibility →
        </Link>
      </div>

      {/* ── Feature grid — 3 col on desktop, 2 col on tablet, 1 col on mobile ── */}
      <div className="feature-grid" role="list">
        {[
          {
            icon: "🌲",
            title: "Merkle Proof",
            desc: "Only a 32-byte root is stored on-chain. Recipients prove inclusion with a compact proof.",
          },
          {
            icon: "⚡",
            title: "Gas Efficient",
            desc: "No batch transfers. Each user claims independently — costs only their own transaction fee.",
          },
          {
            icon: "🔒",
            title: "No Double Claims",
            desc: "The contract tracks each claimed address. Once claimed, it cannot be claimed again.",
          },
        ].map(({ icon, title, desc }) => (
          <div
            key={title}
            role="listitem"
            style={{ border: "1px solid #222", borderRadius: 12, padding: 24, background: "#111" }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }} aria-hidden="true">{icon}</div>
            <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>{title}</h3>
            <p style={{ margin: 0, color: "#888", fontSize: 13, lineHeight: 1.6 }}>{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
