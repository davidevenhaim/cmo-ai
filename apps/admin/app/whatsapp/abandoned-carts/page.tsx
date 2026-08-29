import { fetchJson } from "../../lib/api";
import {
  card,
  EmptyState,
  fmtDate,
  MetricCard,
  PageHeader,
  sectionLabel,
  StatusBadge,
  tableStyle,
  td,
  th,
} from "../../components/ui";
import WhatsAppTabs from "../WhatsAppTabs";

interface CartRow {
  opportunityId: string;
  contactId: string | null;
  contactName: string | null;
  consent: string;
  products: Array<{ title?: string; name?: string }> | null;
  cartValue: number | null;
  currencyCode: string;
  abandonedAt: string | null;
  journeyStatus: string;
  currentStep: number | null;
  currentStepScheduledAt: string | null;
  offer: string | null;
  messagesSent: number;
  recovered: boolean;
  recoveredValue: number | null;
  attributedRevenue: number;
  attributedProfit: number;
}

interface CartView {
  currencyCode: string;
  windowDays: number;
  kpis: {
    abandonedValue: number;
    eligibleValue: number;
    customersContacted: number;
    recoveryRate: number | null;
    recoveredRevenue: number;
    discountCost: number;
    attributedRecoveredProfit: number;
    attributionNote: string;
  };
  rows: CartRow[];
}

export const dynamic = "force-dynamic";

/** Always renders the store's own currency code — never a hardcoded symbol. */
function money(value: number | null | undefined, currency: string): string {
  if (value == null) return "—";
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default async function AbandonedCartsPage() {
  const view = await fetchJson<CartView>("/whatsapp/abandoned-carts");

  if (!view) {
    return (
      <>
        <PageHeader title="WhatsApp — Abandoned Carts" />
        <WhatsAppTabs active="carts" />
        <EmptyState message="Abandoned cart data is unavailable." />
      </>
    );
  }

  const c = view.currencyCode;

  return (
    <>
      <PageHeader
        title="WhatsApp — Abandoned Carts"
        subtitle={`Last ${view.windowDays} days. All values in ${c}.`}
      />
      <WhatsAppTabs active="carts" />

      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <MetricCard
          label="Abandoned value"
          value={money(view.kpis.abandonedValue, c)}
        />
        <MetricCard
          label="Eligible value"
          value={money(view.kpis.eligibleValue, c)}
          sub="carts with marketing consent"
        />
        <MetricCard
          label="Customers contacted"
          value={String(view.kpis.customersContacted)}
        />
        <MetricCard
          label="Recovery rate"
          value={
            view.kpis.recoveryRate == null
              ? "—"
              : `${(view.kpis.recoveryRate * 100).toFixed(1)}%`
          }
          sub="recovered / contacted"
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <MetricCard
          label="Recovered revenue"
          value={money(view.kpis.recoveredRevenue, c)}
          status="ATTRIBUTED"
        />
        <MetricCard
          label="Discount cost"
          value={money(view.kpis.discountCost, c)}
        />
        <MetricCard
          label="Recovered profit"
          value={money(view.kpis.attributedRecoveredProfit, c)}
          status="ATTRIBUTED"
        />
      </div>

      {/* The attributed/incremental distinction is stated, not implied. */}
      <div style={{ ...card, background: "#fdf3d7", marginBottom: "1.25rem" }}>
        <div style={{ ...sectionLabel, color: "#8a6d1a" }}>
          How to read these numbers
        </div>
        <p style={{ fontSize: "0.82rem", color: "#8a6d1a" }}>
          {view.kpis.attributionNote}
        </p>
      </div>

      <div style={sectionLabel}>Carts</div>
      {view.rows.length === 0 ? (
        <EmptyState
          message="No abandoned carts in this window."
          hint="Carts appear here once commerce sync has recorded abandoned checkouts."
        />
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>Customer</th>
              <th style={th}>Consent</th>
              <th style={th}>Items</th>
              <th style={th}>Value</th>
              <th style={th}>Abandoned</th>
              <th style={th}>Journey</th>
              <th style={th}>Step</th>
              <th style={th}>Offer</th>
              <th style={th}>Sent</th>
              <th style={th}>Recovered</th>
              <th style={th}>Attr. revenue</th>
              <th style={th}>Attr. profit</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.opportunityId}>
                <td style={td}>{r.contactName ?? "—"}</td>
                <td style={td}>
                  <StatusBadge
                    status={
                      r.consent === "SUBSCRIBED" ? "AVAILABLE" : "NOT_CONFIGURED"
                    }
                  />
                </td>
                <td style={{ ...td, maxWidth: 200 }}>
                  {Array.isArray(r.products) && r.products.length > 0
                    ? r.products
                        .map((p) => p.title ?? p.name ?? "item")
                        .slice(0, 3)
                        .join(", ")
                    : "—"}
                </td>
                <td style={td}>{money(r.cartValue, r.currencyCode)}</td>
                <td style={{ ...td, fontSize: "0.75rem", color: "#888" }}>
                  {fmtDate(r.abandonedAt)}
                </td>
                <td style={td}>
                  <StatusBadge status={r.journeyStatus} />
                </td>
                <td style={td}>{r.currentStep ?? "—"}</td>
                <td style={td}>{r.offer ?? "—"}</td>
                <td style={td}>{r.messagesSent}</td>
                <td style={td}>
                  {r.recovered ? <StatusBadge status="RECOVERED" /> : "—"}
                </td>
                <td style={td}>{money(r.attributedRevenue, r.currencyCode)}</td>
                <td style={td}>{money(r.attributedProfit, r.currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
