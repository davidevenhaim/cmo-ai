import { fetchJson } from "../lib/api";
import {
  card,
  sectionLabel,
  MetricCard,
  StatusBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  fmtMoney,
  fmtDate,
  tableStyle,
  th,
  td,
} from "../components/ui";

export const dynamic = "force-dynamic";

interface Segment {
  id: string;
  type: string;
  name: string;
  description: string | null;
  memberCount: number;
  lastRefreshedAt: string | null;
}

interface Member {
  id: string;
  orderCount: number;
  lifetimeRevenue: number | null;
  currencyCode: string | null;
  lastOrderAt: string | null;
  emailMarketingStatus: string | null;
  whatsappMarketingStatus: string | null;
}

interface Replenishment {
  productId: string;
  productName: string;
  windowDays: number;
  contacts: Array<{ id: string }>;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: { segment?: string };
}) {
  const [segments, count, replenishment] = await Promise.all([
    fetchJson<Segment[]>("/growth/segments"),
    fetchJson<{ count: number }>("/growth/contacts/count"),
    fetchJson<Replenishment[]>("/growth/replenishment"),
  ]);

  if (!segments) {
    return (
      <ErrorState message="Backend unreachable — cannot read customer segments." />
    );
  }

  const selected = searchParams.segment ?? null;
  const members = selected
    ? await fetchJson<Member[]>(`/growth/segments/${selected}/members`)
    : null;

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Aggregated segments — not a CRM. PII is minimized and never sent to Claude."
      />

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <MetricCard label="Total contacts" value={`${count?.count ?? "—"}`} />
      </div>

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>Segments</div>
      {segments.length === 0 ? (
        <EmptyState
          message="No segments computed yet."
          hint="Run POST /growth/segments/refresh after a Shopify sync."
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "0.75rem",
          }}
        >
          {segments.map((s) => (
            <a
              key={s.id}
              href={`/customers?segment=${encodeURIComponent(s.type)}`}
              style={{
                ...card,
                padding: "0.9rem 1.1rem",
                textDecoration: "none",
                color: "inherit",
                borderColor: selected === s.type ? "#1a1a1a" : undefined,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>
                  {s.name}
                </span>
                <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                  {s.memberCount}
                </span>
              </div>
              {s.description && (
                <p
                  style={{
                    fontSize: "0.75rem",
                    color: "#777",
                    marginTop: "0.3rem",
                  }}
                >
                  {s.description}
                </p>
              )}
              <div
                style={{
                  fontSize: "0.68rem",
                  color: "#aaa",
                  marginTop: "0.3rem",
                }}
              >
                {s.lastRefreshedAt
                  ? `refreshed ${fmtDate(s.lastRefreshedAt)}`
                  : "never refreshed"}
              </div>
            </a>
          ))}
        </div>
      )}

      {selected && (
        <>
          <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
            Members — {selected}{" "}
            <a
              href="/customers"
              style={{ fontWeight: 400, color: "#2a5aa0", fontSize: "0.72rem" }}
            >
              clear
            </a>
          </div>
          {!members ? (
            <ErrorState message="Could not load segment members." />
          ) : members.length === 0 ? (
            <EmptyState message="No members in this segment." />
          ) : (
            <div style={{ ...card, marginTop: "0.5rem" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={th}>Contact</th>
                    <th style={th}>Orders</th>
                    <th style={th}>Lifetime revenue</th>
                    <th style={th}>Last order</th>
                    <th style={th}>Email opt-in</th>
                    <th style={th}>WhatsApp opt-in</th>
                  </tr>
                </thead>
                <tbody>
                  {members.slice(0, 50).map((m) => (
                    <tr key={m.id}>
                      <td style={{ ...td, fontFamily: "monospace" }}>
                        {m.id.slice(0, 10)}…
                      </td>
                      <td style={td}>{m.orderCount}</td>
                      <td style={td}>
                        {fmtMoney(m.lifetimeRevenue, m.currencyCode)}
                      </td>
                      <td style={td}>
                        {m.lastOrderAt ? fmtDate(m.lastOrderAt) : "—"}
                      </td>
                      <td style={td}>
                        <StatusBadge
                          status={m.emailMarketingStatus ?? "UNKNOWN"}
                        />
                      </td>
                      <td style={td}>
                        <StatusBadge
                          status={m.whatsappMarketingStatus ?? "UNKNOWN"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {members.length > 50 && (
                <p
                  style={{
                    fontSize: "0.72rem",
                    color: "#999",
                    marginTop: "0.5rem",
                  }}
                >
                  Showing first 50 of {members.length}.
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
        Replenishment due
      </div>
      {!replenishment || replenishment.length === 0 ? (
        <EmptyState
          message="No replenishment candidates."
          hint="Requires a ReplenishmentConfig per product and contacts inside the due window."
        />
      ) : (
        <div style={{ ...card, marginTop: "0.5rem" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Product</th>
                <th style={th}>Window</th>
                <th style={th}>Contacts due</th>
              </tr>
            </thead>
            <tbody>
              {replenishment.map((r) => (
                <tr key={r.productId}>
                  <td style={td}>{r.productName}</td>
                  <td style={td}>{r.windowDays} days</td>
                  <td style={td}>{r.contacts.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
