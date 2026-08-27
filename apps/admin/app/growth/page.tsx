import { SyncButton } from "./SyncButton";

const API =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3001";

async function getOverview() {
  try {
    const res = await fetch(`${API}/growth/overview`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getAbandoned() {
  try {
    const res = await fetch(`${API}/growth/abandoned`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function getSegments() {
  try {
    const res = await fetch(`${API}/growth/segments`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function getCampaigns() {
  try {
    const res = await fetch(`${API}/growth/campaigns`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function getSyncStatus() {
  try {
    const res = await fetch(`${API}/growth/sync/status`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getCrossSell() {
  try {
    const res = await fetch(`${API}/growth/cross-sell`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

const card: React.CSSProperties = {
  padding: "1.25rem",
  background: "#fff",
  borderRadius: 8,
  border: "1px solid #e5e5e5",
  marginBottom: "1rem",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#888",
  textTransform: "uppercase",
  marginBottom: "0.75rem",
};

const badge: (color: string) => React.CSSProperties = (color) => ({
  display: "inline-block",
  padding: "0.15rem 0.45rem",
  borderRadius: 4,
  fontSize: "0.7rem",
  fontWeight: 600,
  background: color,
  color: "#fff",
  marginRight: "0.4rem",
});

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  DRAFT: "#888",
  PENDING_APPROVAL: "#e07b00",
  APPROVED: "#2a7",
  QUEUED: "#6c63ff",
  SENT: "#1877f2",
  CANCELLED: "#c44",
};

const SEGMENT_COLORS: Record<string, string> = {
  VIP: "#c13584",
  PROSPECT: "#1877f2",
  FIRST_TIME_CUSTOMER: "#2a7",
  REPEAT_CUSTOMER: "#6c63ff",
  RECENT_CUSTOMER: "#2a7",
  LAPSED_CUSTOMER: "#c44",
  ABANDONED_CHECKOUT: "#e07b00",
  HIGH_VALUE_ABANDONMENT: "#c13584",
};

function fmtCurrency(value: number, code: string) {
  return `${code} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtAge(abandonedAt: string) {
  const hours = Math.floor(
    (Date.now() - new Date(abandonedAt).getTime()) / (1000 * 60 * 60),
  );
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const EVIDENCE_COLORS: Record<string, string> = {
  AVAILABLE: "#2a7",
  STALE: "#e07b00",
  UNAVAILABLE: "#c44",
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default async function GrowthPage() {
  const [overview, abandoned, segments, campaigns, crossSell, syncStatus] =
    await Promise.all([
      getOverview(),
      getAbandoned(),
      getSegments(),
      getCampaigns(),
      getCrossSell(),
      getSyncStatus(),
    ]);

  const ac = overview?.abandonedCheckouts;
  const recovery =
    ac?.recoveryRate != null ? `${Math.round(ac.recoveryRate * 100)}%` : "n/a";

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "2rem 1rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "2rem",
        }}
      >
        <a
          href="/"
          style={{ color: "#888", textDecoration: "none", fontSize: "0.85rem" }}
        >
          ← Dashboard
        </a>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
          Growth Engine
        </h1>
      </div>

      {/* Sync status */}
      <div
        style={{
          ...card,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div>
            <div style={sectionTitle}>Shopify Sync</div>
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <span
                style={badge(
                  EVIDENCE_COLORS[overview?.evidenceStatus ?? "UNAVAILABLE"],
                )}
              >
                {overview?.evidenceStatus ?? "UNAVAILABLE"}
              </span>
              <span style={{ fontSize: "0.8rem", color: "#888" }}>
                Last sync:{" "}
                {fmtDate(syncStatus?.completedAt ?? overview?.lastSyncAt)}
              </span>
            </div>
          </div>
          {syncStatus && (
            <div
              style={{
                display: "flex",
                gap: "1.25rem",
                fontSize: "0.78rem",
                color: "#555",
              }}
            >
              <span>
                <strong>{syncStatus.contactsCreated ?? 0}</strong> created
              </span>
              <span>
                <strong>{syncStatus.contactsUpdated ?? 0}</strong> updated
              </span>
              <span>
                <strong>{syncStatus.checkoutsCreated ?? 0}</strong> checkouts
              </span>
              <span>
                <strong>{syncStatus.recovered ?? 0}</strong> recovered
              </span>
            </div>
          )}
        </div>
        <SyncButton />
      </div>

      {/* Overview metrics */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={sectionTitle}>Abandoned Checkouts</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            {ac?.activeCount ?? 0}
          </div>
          <div style={{ color: "#888", fontSize: "0.8rem" }}>
            {ac ? fmtCurrency(ac.activeTotalValue, ac.currencyCode) : "—"}
          </div>
        </div>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={sectionTitle}>Recovery Rate</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{recovery}</div>
          <div style={{ color: "#888", fontSize: "0.8rem" }}>
            recovered / closed
          </div>
        </div>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={sectionTitle}>Lapsed Customers</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            {overview?.lapsedCustomerCount ?? 0}
          </div>
          <div style={{ color: "#888", fontSize: "0.8rem" }}>
            180d+ no order
          </div>
        </div>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={sectionTitle}>Campaigns</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            {campaigns.length}
          </div>
          <div style={{ color: "#888", fontSize: "0.8rem" }}>total</div>
        </div>
      </div>

      {/* Segments */}
      <div style={card}>
        <div style={sectionTitle}>Audience Segments</div>
        {segments.length === 0 ? (
          <p style={{ color: "#888", margin: 0 }}>
            No segments. Trigger a CMO run to populate.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Type
                </th>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Members
                </th>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s: any) => (
                <tr key={s.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "0.4rem 0.5rem" }}>
                    <span style={badge(SEGMENT_COLORS[s.type] ?? "#888")}>
                      {s.type}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "0.4rem 0.5rem",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                    }}
                  >
                    {s.memberCount.toLocaleString()}
                  </td>
                  <td
                    style={{
                      padding: "0.4rem 0.5rem",
                      color: "#888",
                      fontSize: "0.8rem",
                    }}
                  >
                    {s.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Abandoned Checkouts */}
      <div style={card}>
        <div style={sectionTitle}>
          Active Abandoned Checkouts ({abandoned.length})
        </div>
        {abandoned.length === 0 ? (
          <p style={{ color: "#888", margin: 0 }}>
            No active abandoned checkouts.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Value
                </th>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Abandoned
                </th>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Status
                </th>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Email
                </th>
              </tr>
            </thead>
            <tbody>
              {abandoned.slice(0, 20).map((c: any) => (
                <tr key={c.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td
                    style={{
                      padding: "0.4rem 0.5rem",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                    }}
                  >
                    {fmtCurrency(c.totalValue, c.currencyCode)}
                  </td>
                  <td
                    style={{
                      padding: "0.4rem 0.5rem",
                      color: "#888",
                      fontSize: "0.8rem",
                    }}
                  >
                    {fmtAge(c.abandonedAt)}
                  </td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>
                    <span
                      style={badge(c.status === "ACTIVE" ? "#e07b00" : "#888")}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "0.4rem 0.5rem",
                      color: "#888",
                      fontSize: "0.8rem",
                    }}
                  >
                    {c.email ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Campaigns */}
      <div style={card}>
        <div style={sectionTitle}>Campaigns ({campaigns.length})</div>
        {campaigns.length === 0 ? (
          <p style={{ color: "#888", margin: 0 }}>No campaigns yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Name
                </th>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Type
                </th>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c: any) => (
                <tr key={c.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td
                    style={{
                      padding: "0.4rem 0.5rem",
                      fontWeight: 500,
                      fontSize: "0.85rem",
                    }}
                  >
                    {c.name}
                  </td>
                  <td
                    style={{
                      padding: "0.4rem 0.5rem",
                      color: "#888",
                      fontSize: "0.8rem",
                    }}
                  >
                    {c.type}
                  </td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>
                    <span
                      style={badge(CAMPAIGN_STATUS_COLORS[c.status] ?? "#888")}
                    >
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Cross-sell */}
      {crossSell.length > 0 && (
        <div style={card}>
          <div style={sectionTitle}>
            Cross-sell Opportunities ({crossSell.length})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Source
                </th>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Target
                </th>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Strength
                </th>
                <th style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {crossSell.slice(0, 15).map((r: any) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "0.4rem 0.5rem", fontSize: "0.85rem" }}>
                    {r.sourceProduct?.name ?? r.sourceProductId}
                  </td>
                  <td style={{ padding: "0.4rem 0.5rem", fontSize: "0.85rem" }}>
                    {r.targetProduct?.name ?? r.targetProductId}
                  </td>
                  <td
                    style={{
                      padding: "0.4rem 0.5rem",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                    }}
                  >
                    {r.strength != null
                      ? `${Math.round(r.strength * 100)}%`
                      : "manual"}
                  </td>
                  <td
                    style={{
                      padding: "0.4rem 0.5rem",
                      color: "#888",
                      fontSize: "0.8rem",
                    }}
                  >
                    {r.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Replenishment */}
      {overview?.replenishmentCandidates?.length > 0 && (
        <div style={card}>
          <div style={sectionTitle}>Replenishment Candidates</div>
          {overview.replenishmentCandidates.map((r: any) => (
            <div
              key={r.productName}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "0.4rem 0",
                borderBottom: "1px solid #f5f5f5",
              }}
            >
              <span style={{ fontSize: "0.85rem" }}>{r.productName}</span>
              <span style={{ fontSize: "0.85rem", color: "#888" }}>
                {r.candidateCount} candidates · {r.windowDays}d window
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
