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
} from "../components/ui";

export const dynamic = "force-dynamic";

interface Today {
  generatedAt: string;
  brandName: string | null;
  facts: {
    sales: any;
    revenue: any;
    market: any;
    content: any;
    customers: any;
  };
  actions: Array<{
    id: string;
    title: string;
    why: string;
    category: string;
    evidenceSource: string;
    expectedImpact: string | null;
    impactValue: number | null;
    currencyCode: string | null;
    confidence: number;
    requiredAction: string;
    requiresApproval: boolean;
    deepLink: string;
    priority: number;
  }>;
  interpretation: {
    status: "AVAILABLE" | "UNAVAILABLE";
    headline: string | null;
    narrative: string | null;
    failureReason: string | null;
  };
  recentResults?: {
    status: "AVAILABLE" | "UNAVAILABLE";
    measuredLast7: number;
    outperformed: number;
    expected: number;
    underperformed: number;
    inconclusive: number;
    currencyCode: string | null;
    attributedProfitLast7: number | null;
    highlights: Array<{
      recommendationId: string;
      title: string;
      type: string;
      outcome: string | null;
      attributionStrength: string | null;
      dataQuality: string | null;
      summary: string | null;
    }>;
    directionalExperiments: Array<{
      experimentId: string;
      name: string;
      state: string;
    }>;
  };
}

export default async function TodayPage() {
  const today = await fetchJson<Today>("/operator/today");

  if (!today) {
    return (
      <ErrorState message="Backend unreachable. Start with `docker compose up` and reload." />
    );
  }

  const { facts, actions, interpretation } = today;
  const s = facts.sales;
  const r = facts.revenue;
  const m = facts.market;
  const c = facts.content;
  const cu = facts.customers;

  return (
    <div>
      <PageHeader
        title={`Today — ${today.brandName ?? "Luminesce"}`}
        subtitle={`Generated ${fmtDate(today.generatedAt)}. All numbers are deterministic backend metrics.`}
      />

      {/* CMO interpretation — clearly separated from facts */}
      {interpretation.status === "AVAILABLE" ? (
        <div
          style={{
            ...card,
            marginBottom: "1.25rem",
            borderLeft: "3px solid #1a1a1a",
          }}
        >
          <div style={sectionLabel}>CMO interpretation</div>
          <div style={{ fontWeight: 700, marginBottom: "0.3rem" }}>
            {interpretation.headline}
          </div>
          <p style={{ fontSize: "0.85rem", color: "#444" }}>
            {interpretation.narrative}
          </p>
        </div>
      ) : (
        <div
          style={{
            ...card,
            marginBottom: "1.25rem",
            background: "#fcfcfa",
            color: "#777",
          }}
        >
          <div style={sectionLabel}>CMO interpretation</div>
          <p style={{ fontSize: "0.83rem" }}>
            {interpretation.failureReason ??
              "CMO interpretation unavailable — deterministic metrics below are unaffected."}
          </p>
        </div>
      )}

      {/* Deterministic metric sections */}
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginBottom: "1.25rem",
        }}
      >
        <MetricCard
          label={`Sales (${s.periodDays ?? "—"}d)`}
          value={fmtMoney(s.revenue, s.currencyCode)}
          sub={
            s.revenue != null
              ? `${s.orderCount ?? 0} orders · AOV ${fmtMoney(s.aov, s.currencyCode)}${
                  s.revenueDeltaPct != null
                    ? ` · ${s.revenueDeltaPct > 0 ? "+" : ""}${s.revenueDeltaPct}% vs prev`
                    : ""
                }`
              : (s.failureReason ?? "No sales data")
          }
          status={s.status}
        />
        <MetricCard
          label="Recoverable revenue"
          value={fmtMoney(r.abandonedValue, r.currencyCode)}
          sub={`${r.eligibleRecoveries ?? 0} eligible · ${r.activeJourneys ?? 0} journeys active · ${fmtMoney(r.recoveredRevenueLast30, r.currencyCode)} recovered 30d`}
          status={r.status}
        />
        <MetricCard
          label="Market"
          value={`${(m.opportunityCount ?? 0) + (m.searchOpportunityCount ?? 0)} opportunities`}
          sub={
            m.contentGapCount != null
              ? `${m.contentGapCount} content gaps`
              : undefined
          }
          status={m.status}
        />
        <MetricCard
          label="Content"
          value={`${c.awaitingReview ?? 0} awaiting review`}
          sub={`${c.approvedUnpublished ?? 0} approved · ${c.scheduled ?? 0} scheduled · ${c.failedPublications ?? 0} failed`}
          status={c.status}
        />
        <MetricCard
          label="Customers"
          value={`${cu.totalContacts ?? 0} contacts`}
          sub={`${cu.vip ?? 0} VIP · ${cu.winBack ?? 0} win-back · ${cu.replenishmentDue ?? 0} replenishment due`}
          status={cu.status}
        />
      </div>

      {/* Recent Results — only real measured data, never fabricated examples */}
      <div style={sectionLabel}>Recent results (last 7 days)</div>
      {today.recentResults?.status === "AVAILABLE" ? (
        <div style={{ ...card, marginBottom: "1.25rem" }}>
          <div
            style={{
              display: "flex",
              gap: "1.2rem",
              flexWrap: "wrap",
              fontSize: "0.82rem",
              color: "#444",
            }}
          >
            <span>
              <b>{today.recentResults.measuredLast7}</b> measured (
              {today.recentResults.outperformed}↑ {today.recentResults.expected}
              = {today.recentResults.underperformed}↓{" "}
              {today.recentResults.inconclusive}?)
            </span>
            {today.recentResults.attributedProfitLast7 != null && (
              <span>
                {fmtMoney(
                  today.recentResults.attributedProfitLast7,
                  today.recentResults.currencyCode,
                )}{" "}
                attributed profit
                <span style={{ color: "#999", fontSize: "0.72rem" }}>
                  {" "}
                  (last-touch — not incremental)
                </span>
              </span>
            )}
          </div>
          {today.recentResults.highlights.length > 0 && (
            <ul
              style={{
                marginTop: "0.5rem",
                paddingLeft: 16,
                fontSize: "0.8rem",
                color: "#444",
              }}
            >
              {today.recentResults.highlights.map((h) => (
                <li key={h.recommendationId} style={{ marginTop: "0.2rem" }}>
                  <a
                    href={`/recommendations/${h.recommendationId}`}
                    style={{ color: "#2a5aa0", fontWeight: 600 }}
                  >
                    {h.title}
                  </a>{" "}
                  {h.outcome && <StatusBadge status={h.outcome} />}
                  {h.summary && (
                    <span style={{ color: "#777" }}> — {h.summary}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {today.recentResults.directionalExperiments.length > 0 && (
            <p
              style={{
                marginTop: "0.5rem",
                fontSize: "0.78rem",
                color: "#666",
              }}
            >
              Experiments with signal:{" "}
              {today.recentResults.directionalExperiments
                .map((e) => `${e.name} (${e.state})`)
                .join(", ")}
            </p>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: "1.25rem" }}>
          <EmptyState
            message="No measured results yet."
            hint="Results appear after executed recommendations complete their measurement window. Nothing is fabricated."
          />
        </div>
      )}

      {/* Recommended actions */}
      <div style={sectionLabel}>Recommended actions</div>
      {actions.length === 0 ? (
        <EmptyState
          message="Nothing needs your attention right now."
          hint="Actions appear when there is recoverable revenue, content awaiting review, market opportunities, or connection problems."
        />
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
        >
          {actions.map((a) => (
            <div key={a.id} style={{ ...card, padding: "0.9rem 1.1rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                      {a.title}
                    </span>
                    <StatusBadge status={a.requiredAction} />
                    {a.requiresApproval && (
                      <span style={{ fontSize: "0.68rem", color: "#8a6d1a" }}>
                        requires approval
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      fontSize: "0.82rem",
                      color: "#444",
                      marginTop: "0.3rem",
                    }}
                  >
                    {a.why}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.9rem",
                      marginTop: "0.35rem",
                      fontSize: "0.72rem",
                      color: "#888",
                      flexWrap: "wrap",
                    }}
                  >
                    <span>evidence: {a.evidenceSource}</span>
                    {a.expectedImpact && (
                      <span>impact: {a.expectedImpact}</span>
                    )}
                    <span>confidence: {(a.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <a
                  href={a.deepLink}
                  style={{
                    alignSelf: "center",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "#2a5aa0",
                    whiteSpace: "nowrap",
                  }}
                >
                  Open →
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
