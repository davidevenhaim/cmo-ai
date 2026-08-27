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

interface Analytics {
  revenueOptimization: {
    currencyCode: string | null;
    abandonedValueOpen: number;
    recoveredLast30: number;
    attributedRevenueLast30: number;
    attributedProfitLast30: number;
    incrementalEstimateLast30: number;
    incentiveCostLast30: number;
    recoveryRate: number | null;
  };
}

interface Eligible {
  count: number;
  totalValue: number;
}

interface Opportunity {
  id: string;
  type: string;
  stage: string;
  status: string;
  cartValue: number | null;
  abandonedAt: string | null;
  createdAt: string;
}

interface Affinity {
  id: string;
  productATitle: string;
  productBTitle: string;
  coOccurrences: number;
  confidence: number;
  lift: number;
}

interface Bundle {
  id: string;
  name: string;
  normalPrice: number;
  bundlePrice: number;
  discountPct: number;
  estimatedMargin: number | null;
  inventoryOk: boolean;
  approved: boolean;
  source: string;
}

interface Replenishment {
  productId: string;
  productName: string;
  windowDays: number;
  contacts: Array<{ id: string }>;
}

interface Segment {
  id: string;
  type: string;
  name: string;
  memberCount: number;
}

interface AttributionSummary {
  totalRevenue: number;
  totalContributionProfit: number;
  totalIncentiveCost: number;
  totalAttributions: number;
  byType: Record<string, { count: number; revenue: number; profit: number }>;
  byAttributionType: Record<
    string,
    { count: number; revenue: number; profit: number }
  >;
}

export default async function RevenuePage() {
  const [
    analytics,
    eligible,
    opportunities,
    affinity,
    bundles,
    replenishment,
    segments,
    attribution,
  ] = await Promise.all([
    fetchJson<Analytics>("/operator/analytics"),
    fetchJson<Eligible>("/operator/recovery/eligible"),
    fetchJson<Opportunity[]>("/revenue/opportunities?limit=25"),
    fetchJson<Affinity[]>("/revenue/affinity"),
    fetchJson<Bundle[]>("/revenue/bundles"),
    fetchJson<Replenishment[]>("/growth/replenishment"),
    fetchJson<Segment[]>("/growth/segments"),
    fetchJson<AttributionSummary>("/revenue/attribution/summary"),
  ]);

  if (!analytics) {
    return (
      <ErrorState message="Backend unreachable — revenue data unavailable." />
    );
  }

  const ro = analytics.revenueOptimization;
  const cc = ro.currencyCode;
  const winBack = segments?.find((s) => s.type === "LAPSED_CUSTOMER");
  const vip = segments?.find((s) => s.type === "VIP");

  return (
    <div>
      <PageHeader
        title="Revenue"
        subtitle="Attributed figures are last-touch and correlational. Incremental estimates come only from experiments. Sends always pass the messaging safety gates."
      />

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <MetricCard
          label="Abandoned value (open)"
          value={fmtMoney(ro.abandonedValueOpen, cc)}
        />
        <MetricCard
          label="Eligible recovery value"
          value={eligible ? fmtMoney(eligible.totalValue, cc) : "—"}
          sub={
            eligible
              ? `${eligible.count} opportunities pass pre-send gates`
              : "unavailable"
          }
        />
        <MetricCard
          label="Attributed recovery revenue (30d)"
          value={fmtMoney(ro.attributedRevenueLast30, cc)}
          sub="last-touch attribution — not incremental"
        />
        <MetricCard
          label="Attributed profit (30d)"
          value={fmtMoney(ro.attributedProfitLast30, cc)}
          sub={`incentive cost ${fmtMoney(ro.incentiveCostLast30, cc)}`}
        />
        <MetricCard
          label="Incremental estimate (30d)"
          value={fmtMoney(ro.incrementalEstimateLast30, cc)}
          sub="experiment-backed only"
        />
      </div>

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }} id="abandoned">
        Abandoned checkouts / recovery opportunities
      </div>
      {!opportunities || opportunities.length === 0 ? (
        <EmptyState
          message="No recovery opportunities."
          hint="Opportunities are created from abandoned Shopify checkouts via POST /revenue/opportunities/sync."
        />
      ) : (
        <div style={card}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Opportunity</th>
                <th style={th}>Type</th>
                <th style={th}>Stage</th>
                <th style={th}>Status</th>
                <th style={th}>Cart value</th>
                <th style={th}>Abandoned</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => (
                <tr key={o.id}>
                  <td style={{ ...td, fontFamily: "monospace" }}>
                    {o.id.slice(0, 10)}…
                  </td>
                  <td style={td}>{o.type}</td>
                  <td style={td}>{o.stage}</td>
                  <td style={td}>
                    <StatusBadge status={o.status} />
                  </td>
                  <td style={td}>{fmtMoney(o.cartValue, cc)}</td>
                  <td style={td}>
                    {o.abandonedAt ? fmtDate(o.abandonedAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: "0.7rem", color: "#999", marginTop: "0.5rem" }}>
            Contact details are intentionally omitted here. Recovery sends run
            through the journey engine with consent, frequency and economics
            gates.
          </p>
        </div>
      )}

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }} id="bundles">
        Bundles &amp; product affinity
      </div>
      {!bundles || bundles.length === 0 ? (
        <EmptyState
          message="No bundle suggestions."
          hint='Ask the command bar to "propose a bundle" — suggestions come from order co-occurrence, and nothing is pushed to Shopify.'
        />
      ) : (
        <div style={card}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Bundle</th>
                <th style={th}>Normal</th>
                <th style={th}>Bundle price</th>
                <th style={th}>Discount</th>
                <th style={th}>Inventory</th>
                <th style={th}>Approved</th>
              </tr>
            </thead>
            <tbody>
              {bundles.map((b) => (
                <tr key={b.id}>
                  <td style={td}>{b.name}</td>
                  <td style={td}>{fmtMoney(b.normalPrice, cc)}</td>
                  <td style={td}>{fmtMoney(b.bundlePrice, cc)}</td>
                  <td style={td}>{b.discountPct.toFixed(0)}%</td>
                  <td style={td}>{b.inventoryOk ? "OK" : "check"}</td>
                  <td style={td}>
                    <StatusBadge status={b.approved ? "APPROVED" : "PENDING"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {affinity && affinity.length > 0 && (
        <div style={{ ...card, marginTop: "0.75rem" }}>
          <div style={sectionLabel}>
            Product affinity (min 5 co-occurrences, lift ≥ 1.2)
          </div>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Pair</th>
                <th style={th}>Co-occurrences</th>
                <th style={th}>Confidence</th>
                <th style={th}>Lift</th>
              </tr>
            </thead>
            <tbody>
              {affinity.slice(0, 10).map((a) => (
                <tr key={a.id}>
                  <td style={td}>
                    {a.productATitle} + {a.productBTitle}
                  </td>
                  <td style={td}>{a.coOccurrences}</td>
                  <td style={td}>{(a.confidence * 100).toFixed(0)}%</td>
                  <td style={td}>{a.lift.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
        Replenishment · win-back · VIP
      </div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <MetricCard
          label="Replenishment due"
          value={`${
            replenishment?.reduce((s, r) => s + r.contacts.length, 0) ?? "—"
          } contacts`}
          sub={
            replenishment && replenishment.length > 0
              ? replenishment
                  .map((r) => `${r.productName} (${r.contacts.length})`)
                  .join(" · ")
              : "no configured products due"
          }
        />
        <MetricCard
          label="Win-back candidates"
          value={`${winBack?.memberCount ?? "—"} contacts`}
          sub="lapsed customers — see Customers"
        />
        <MetricCard
          label="VIP"
          value={`${vip?.memberCount ?? "—"} contacts`}
          sub="top-value customers — see Customers"
        />
      </div>

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
        Attribution (last 30 days)
      </div>
      {!attribution || attribution.totalAttributions === 0 ? (
        <EmptyState
          message="No attributed revenue in the last 30 days."
          hint="Attribution records are written when a recovery or campaign leads to an order."
        />
      ) : (
        <div style={card}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Attribution type</th>
                <th style={th}>Count</th>
                <th style={th}>Revenue</th>
                <th style={th}>Profit</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(attribution.byAttributionType).map(
                ([type, v]) => (
                  <tr key={type}>
                    <td style={td}>
                      {type}
                      {type === "ATTRIBUTED" && (
                        <span
                          style={{
                            fontSize: "0.68rem",
                            color: "#8a6d1a",
                            marginLeft: "0.4rem",
                          }}
                        >
                          last-touch, correlational
                        </span>
                      )}
                    </td>
                    <td style={td}>{v.count}</td>
                    <td style={td}>{fmtMoney(v.revenue, cc)}</td>
                    <td style={td}>{fmtMoney(v.profit, cc)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <p style={{ fontSize: "0.7rem", color: "#999", marginTop: "0.5rem" }}>
            Total incentive cost {fmtMoney(attribution.totalIncentiveCost, cc)}{" "}
            across {attribution.totalAttributions} attributions.
          </p>
        </div>
      )}

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>Experiments</div>
      <EmptyState
        message="No running revenue experiments."
        hint="Experiments are created via POST /revenue/experiments. Only experiment-backed lifts count as incremental."
      />
    </div>
  );
}
