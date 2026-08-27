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
import { attributionLabel } from "../components/attribution";

export const dynamic = "force-dynamic";

const TABS = [
  "OVERVIEW",
  "RECOMMENDATIONS",
  "CONTENT",
  "REVENUE",
  "EXPERIMENTS",
  "TRAFFIC",
] as const;
type Tab = (typeof TABS)[number];

interface Analytics {
  generatedAt: string;
  commerce: {
    status: string;
    currencyCode: string | null;
    periodDays: number | null;
    revenue: number | null;
    orderCount: number | null;
    aov: number | null;
    repeatRate: number | null;
    topProducts: Array<{
      productTitle: string;
      revenue: number;
      units: number;
    }>;
  } | null;
  content: {
    generated: number;
    approved: number;
    rejected: number;
    awaitingReview: number;
    scheduled: number;
    published: number;
    failed: number;
  };
  market: {
    opportunitiesDetected: number;
    searchOpportunitiesDetected: number;
    briefsCreatedFromOpportunities: number;
  };
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
  publishing: { succeeded: number; failed: number; unknown: number };
  unavailable: string[];
}

interface Scorecard {
  generatedAt: string;
  windowDays: number;
  proposed: number;
  approved: number;
  rejected: number;
  executed: number;
  measuring: number;
  measured: number;
  expired: number;
  failed: number;
  approvalRate: number | null;
  executionRate: number | null;
  measurementCoverage: number | null;
  outcomes: {
    outperformed: number;
    expected: number;
    underperformed: number;
    inconclusive: number;
  };
  rejectionReasons: Record<string, number>;
  currencyCode: string | null;
  attributedValue: number;
  experimentBackedIncrementalValue: number;
}

interface RecommendationRow {
  id: string;
  type: string;
  title: string;
  status: string;
  outcome: string | null;
  attributionStrength: string | null;
  dataQuality: string | null;
  confidence: number;
  expectedImpact: string | null;
  createdAt: string;
  measuredAt: string | null;
}

interface ExperimentEvaluation {
  experimentId: string;
  name: string;
  status: string;
  state: string;
  minSamplePerVariant: number;
  control: VariantResult | null;
  variants: VariantResult[];
  bestVariantId: string | null;
  profitDeltaPerAssigned: number | null;
  note: string;
}

interface VariantResult {
  variantId: string;
  variantName: string;
  isControl: boolean;
  assigned: number;
  converted: number;
  conversionRate: number | null;
  totalRevenue: number;
  totalContributionProfit: number;
  totalIncentiveCost: number;
  avgProfitPerAssigned: number | null;
}

interface Observation {
  id: string;
  provider: string;
  subjectType: string;
  subjectId: string;
  metric: string;
  dimension: string;
  value: number;
  unit: string;
  currencyCode: string | null;
  bucketStart: string;
  bucketEnd: string;
  dataQuality: string;
  attributionStrength: string;
}

function pct(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(0)}%` : "—";
}

function TabBar({ active }: { active: Tab }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "0.25rem",
        flexWrap: "wrap",
        marginBottom: "1.25rem",
        borderBottom: "1px solid #e5e5e5",
        paddingBottom: "0.5rem",
      }}
    >
      {TABS.map((t) => (
        <a
          key={t}
          href={`/analytics?tab=${t.toLowerCase()}`}
          style={{
            padding: "0.3rem 0.75rem",
            borderRadius: 6,
            fontSize: "0.76rem",
            fontWeight: 600,
            textDecoration: "none",
            color: active === t ? "#fff" : "#555",
            background: active === t ? "#1a1a1a" : "#f2f2f0",
          }}
        >
          {t.charAt(0) + t.slice(1).toLowerCase()}
        </a>
      ))}
    </div>
  );
}

function OutcomeBar({ outcomes }: { outcomes: Scorecard["outcomes"] }) {
  const total =
    outcomes.outperformed +
    outcomes.expected +
    outcomes.underperformed +
    outcomes.inconclusive;
  if (total === 0) {
    return (
      <EmptyState message="No measured outcomes yet — outcomes appear after executed recommendations complete their measurement window." />
    );
  }
  const seg = (n: number, bg: string, label: string) =>
    n > 0 ? (
      <div
        key={label}
        style={{
          flex: n,
          background: bg,
          padding: "0.35rem 0",
          textAlign: "center",
          fontSize: "0.7rem",
          fontWeight: 700,
          color: "#333",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
        title={`${label}: ${n}`}
      >
        {n}
      </div>
    ) : null;
  return (
    <div>
      <div
        style={{
          display: "flex",
          borderRadius: 6,
          overflow: "hidden",
          border: "1px solid #e5e5e5",
        }}
      >
        {seg(outcomes.outperformed, "#bfe8cd", "Outperformed")}
        {seg(outcomes.expected, "#dbe8fb", "Expected")}
        {seg(outcomes.underperformed, "#f6cfcf", "Underperformed")}
        {seg(outcomes.inconclusive, "#eeeeea", "Inconclusive")}
      </div>
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginTop: "0.35rem",
          fontSize: "0.72rem",
          color: "#777",
          flexWrap: "wrap",
        }}
      >
        <span>↑ outperformed {outcomes.outperformed}</span>
        <span>= expected {outcomes.expected}</span>
        <span>↓ underperformed {outcomes.underperformed}</span>
        <span>? inconclusive {outcomes.inconclusive}</span>
      </div>
    </div>
  );
}

async function OverviewTab() {
  const [a, sc] = await Promise.all([
    fetchJson<Analytics>("/operator/analytics"),
    fetchJson<Scorecard>("/measurement/scorecard?days=30"),
  ]);

  return (
    <div>
      <div style={sectionLabel}>
        CMO effectiveness (last {sc?.windowDays ?? 30} days)
      </div>
      {sc ? (
        <>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <MetricCard label="Proposed" value={`${sc.proposed}`} />
            <MetricCard
              label="Approval rate"
              value={pct(sc.approvalRate)}
              sub={`${sc.approved + sc.executed + sc.measuring + sc.measured + sc.failed} approved · ${sc.rejected} rejected`}
            />
            <MetricCard
              label="Execution rate"
              value={pct(sc.executionRate)}
              sub={`${sc.expired} expired · ${sc.failed} failed`}
            />
            <MetricCard
              label="Measurement coverage"
              value={pct(sc.measurementCoverage)}
              sub={`${sc.measured} measured · ${sc.measuring} measuring`}
            />
          </div>
          <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
            Measured outcome distribution
          </div>
          <OutcomeBar outcomes={sc.outcomes} />
          <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
            Value linked to CMO recommendations
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <MetricCard
              label="Attributed profit"
              value={fmtMoney(sc.attributedValue, sc.currencyCode)}
              sub="last-touch attribution — correlational, not proven incremental"
            />
            <MetricCard
              label="Experiment-backed incremental"
              value={fmtMoney(
                sc.experimentBackedIncrementalValue,
                sc.currencyCode,
              )}
              sub="from controlled experiments only"
            />
          </div>
          {Object.keys(sc.rejectionReasons).length > 0 && (
            <>
              <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
                Rejection reasons (owner feedback)
              </div>
              <div
                style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}
              >
                {Object.entries(sc.rejectionReasons).map(([reason, count]) => (
                  <MetricCard
                    key={reason}
                    label={reason.replace(/_/g, " ").toLowerCase()}
                    value={`${count}`}
                  />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <ErrorState message="Scorecard unavailable — backend unreachable." />
      )}

      {a?.commerce && (
        <>
          <div style={{ ...sectionLabel, marginTop: "1.5rem" }}>
            Commerce (last {a.commerce.periodDays ?? "—"} days)
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <MetricCard
              label="Revenue"
              value={fmtMoney(a.commerce.revenue, a.commerce.currencyCode)}
              status={a.commerce.status}
            />
            <MetricCard
              label="Orders"
              value={`${a.commerce.orderCount ?? "—"}`}
            />
            <MetricCard
              label="AOV"
              value={fmtMoney(a.commerce.aov, a.commerce.currencyCode)}
            />
            <MetricCard
              label="Repeat rate"
              value={
                a.commerce.repeatRate != null
                  ? `${(a.commerce.repeatRate * 100).toFixed(0)}%`
                  : "—"
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

async function RecommendationsTab() {
  const recs = await fetchJson<RecommendationRow[]>(
    "/measurement/recommendations?limit=100",
  );
  if (!recs) {
    return <ErrorState message="Recommendations unavailable." />;
  }
  if (recs.length === 0) {
    return (
      <EmptyState
        message="No recommendations recorded yet."
        hint="Recommendations are persisted when the CMO proposes actions on Today or you accept market opportunities."
      />
    );
  }
  return (
    <div style={card}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={th}>Recommendation</th>
            <th style={th}>Type</th>
            <th style={th}>Status</th>
            <th style={th}>Outcome</th>
            <th style={th}>Attribution</th>
            <th style={th}>Created</th>
          </tr>
        </thead>
        <tbody>
          {recs.map((r) => (
            <tr key={r.id}>
              <td style={td}>
                <a
                  href={`/recommendations/${r.id}`}
                  style={{ color: "#2a5aa0", fontWeight: 600 }}
                >
                  {r.title}
                </a>
              </td>
              <td style={td}>{r.type.replace(/_/g, " ").toLowerCase()}</td>
              <td style={td}>
                <StatusBadge status={r.status} />
              </td>
              <td style={td}>
                {r.outcome ? <StatusBadge status={r.outcome} /> : "—"}
              </td>
              <td style={{ ...td, fontSize: "0.75rem", color: "#777" }}>
                {attributionLabel(r.attributionStrength)}
              </td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                {fmtDate(r.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function ContentTab() {
  const a = await fetchJson<Analytics>("/operator/analytics");
  if (!a) return <ErrorState message="Content analytics unavailable." />;
  return (
    <div>
      <div style={sectionLabel}>Content pipeline</div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <MetricCard label="Generated" value={`${a.content.generated}`} />
        <MetricCard
          label="Awaiting review"
          value={`${a.content.awaitingReview}`}
        />
        <MetricCard label="Approved" value={`${a.content.approved}`} />
        <MetricCard label="Scheduled" value={`${a.content.scheduled}`} />
        <MetricCard label="Published" value={`${a.content.published}`} />
        <MetricCard
          label="Failed"
          value={`${a.content.failed}`}
          sub={a.content.failed > 0 ? "needs attention" : undefined}
        />
      </div>
      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>Market</div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <MetricCard
          label="Opportunities detected"
          value={`${a.market.opportunitiesDetected}`}
        />
        <MetricCard
          label="Search opportunities"
          value={`${a.market.searchOpportunitiesDetected}`}
        />
        <MetricCard
          label="Briefs from opportunities"
          value={`${a.market.briefsCreatedFromOpportunities}`}
        />
      </div>
      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>Publishing</div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <MetricCard label="Succeeded" value={`${a.publishing.succeeded}`} />
        <MetricCard
          label="Failed"
          value={`${a.publishing.failed}`}
          sub={a.publishing.failed > 0 ? "see Calendar for details" : undefined}
        />
        <MetricCard
          label="Unknown"
          value={`${a.publishing.unknown}`}
          sub={
            a.publishing.unknown > 0
              ? "provider did not confirm — reconcile"
              : undefined
          }
        />
      </div>
    </div>
  );
}

async function RevenueTab() {
  const a = await fetchJson<Analytics>("/operator/analytics");
  if (!a) return <ErrorState message="Revenue analytics unavailable." />;
  const ro = a.revenueOptimization;
  return (
    <div>
      <div style={sectionLabel}>Revenue optimization (last 30 days)</div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <MetricCard
          label="Abandoned value (open)"
          value={fmtMoney(ro.abandonedValueOpen, ro.currencyCode)}
        />
        <MetricCard
          label="Recovered"
          value={fmtMoney(ro.recoveredLast30, ro.currencyCode)}
          sub={
            ro.recoveryRate != null
              ? `recovery rate ${(ro.recoveryRate * 100).toFixed(0)}%`
              : "recovery rate — (no resolved opportunities)"
          }
        />
        <MetricCard
          label="Attributed revenue"
          value={fmtMoney(ro.attributedRevenueLast30, ro.currencyCode)}
          sub="last-touch attribution — not incremental"
        />
        <MetricCard
          label="Attributed profit"
          value={fmtMoney(ro.attributedProfitLast30, ro.currencyCode)}
          sub={`incentive cost ${fmtMoney(ro.incentiveCostLast30, ro.currencyCode)}`}
        />
        <MetricCard
          label="Incremental estimate"
          value={fmtMoney(ro.incrementalEstimateLast30, ro.currencyCode)}
          sub="experiment-backed only"
        />
      </div>
    </div>
  );
}

async function ExperimentsTab() {
  const evals = await fetchJson<ExperimentEvaluation[]>(
    "/measurement/experiments?limit=20",
  );
  if (!evals) return <ErrorState message="Experiments unavailable." />;
  if (evals.length === 0) {
    return (
      <EmptyState
        message="No experiments to evaluate."
        hint="Experiments appear when incentive tests run on recovery journeys."
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {evals.map((e) => (
        <div key={e.experimentId} style={card}>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>
              {e.name}
            </span>
            <StatusBadge status={e.state} />
          </div>
          <p style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.3rem" }}>
            {e.note}
          </p>
          <table style={{ ...tableStyle, marginTop: "0.6rem" }}>
            <thead>
              <tr>
                <th style={th}>Variant</th>
                <th style={th}>Assigned</th>
                <th style={th}>Converted</th>
                <th style={th}>Conv. rate</th>
                <th style={th}>Profit / assigned</th>
              </tr>
            </thead>
            <tbody>
              {[...(e.control ? [e.control] : []), ...e.variants].map((v) => (
                <tr key={v.variantId}>
                  <td style={td}>
                    {v.variantName}
                    {v.isControl && (
                      <span style={{ color: "#999", fontSize: "0.7rem" }}>
                        {" "}
                        (control)
                      </span>
                    )}
                    {e.bestVariantId === v.variantId && (
                      <span style={{ color: "#1a7a3d", fontSize: "0.7rem" }}>
                        {" "}
                        ← best
                      </span>
                    )}
                  </td>
                  <td style={td}>{v.assigned}</td>
                  <td style={td}>{v.converted}</td>
                  <td style={td}>
                    {v.conversionRate != null
                      ? `${(v.conversionRate * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td style={td}>
                    {v.avgProfitPerAssigned != null
                      ? v.avgProfitPerAssigned.toFixed(2)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p
            style={{ fontSize: "0.72rem", color: "#999", marginTop: "0.4rem" }}
          >
            Minimum {e.minSamplePerVariant} assignments per variant before any
            winner is declared. Small samples stay INSUFFICIENT_DATA by design.
          </p>
        </div>
      ))}
    </div>
  );
}

async function TrafficTab() {
  const obs = await fetchJson<Observation[]>("/measurement/traffic?days=30");
  if (!obs) return <ErrorState message="Traffic observations unavailable." />;
  if (obs.length === 0) {
    return (
      <EmptyState
        message="No brand-level traffic observations in the last 30 days."
        hint="Traffic appears when an analytics provider (e.g. GA4) is configured. Mock data is excluded — it never informs real conclusions."
      />
    );
  }
  return (
    <div style={card}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={th}>Provider</th>
            <th style={th}>Metric</th>
            <th style={th}>Value</th>
            <th style={th}>Bucket</th>
            <th style={th}>Quality</th>
          </tr>
        </thead>
        <tbody>
          {obs.map((o) => (
            <tr key={o.id}>
              <td style={td}>{o.provider}</td>
              <td style={td}>{o.metric}</td>
              <td style={td}>
                {o.unit === "CURRENCY"
                  ? fmtMoney(o.value, o.currencyCode)
                  : o.value.toLocaleString()}
              </td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                {fmtDate(o.bucketStart)}
              </td>
              <td style={td}>
                <StatusBadge status={o.dataQuality} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const raw = (searchParams?.tab ?? "overview").toUpperCase();
  const active: Tab = (TABS as readonly string[]).includes(raw)
    ? (raw as Tab)
    : "OVERVIEW";

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Deterministic metrics only. Attributed figures are last-touch correlations — only experiment-backed values are incremental."
      />
      <TabBar active={active} />
      {active === "OVERVIEW" && <OverviewTab />}
      {active === "RECOMMENDATIONS" && <RecommendationsTab />}
      {active === "CONTENT" && <ContentTab />}
      {active === "REVENUE" && <RevenueTab />}
      {active === "EXPERIMENTS" && <ExperimentsTab />}
      {active === "TRAFFIC" && <TrafficTab />}
    </div>
  );
}
