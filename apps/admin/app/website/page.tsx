import { fetchJson } from "../lib/api";
import {
  card,
  EmptyState,
  fmtDate,
  MetricCard,
  PageHeader,
  sectionLabel,
  StatusBadge,
  td,
  th,
  tableStyle,
} from "../components/ui";
import RunAuditButton from "./RunAuditButton";
import WebsiteTabs from "./WebsiteTabs";
import ScoreTile from "./ScoreTile";

interface Overview {
  configured: boolean;
  lighthouseConfigured: boolean;
  websiteUrl: string | null;
  lastAudit: {
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    pagesAudited: number;
    pagesFailed: number;
    scores: {
      performance: number | null;
      accessibility: number | null;
      seo: number | null;
      bestPractices: number | null;
    } | null;
    failureReason: string | null;
  } | null;
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  topRecommendations: Array<{
    id: string;
    title: string;
    interpretation: string;
    proposedFix: string;
    priority: string;
    category: string;
    confidence: number;
    findings: Array<{
      id: string;
      title: string;
      pageUrl: string;
      severity: string;
      metricName: string | null;
      metricValue: number | null;
      metricUnit: string | null;
    }>;
  }>;
}

export const dynamic = "force-dynamic";

export default async function WebsitePage() {
  const overview = await fetchJson<Overview>("/website/overview");

  if (!overview) {
    return (
      <>
        <PageHeader title="Website" />
        <EmptyState
          message="Website intelligence is unavailable."
          hint="The backend did not respond. Check that it is running."
        />
      </>
    );
  }

  const scores = overview.lastAudit?.scores;

  return (
    <>
      <PageHeader
        title="Website"
        subtitle={
          overview.websiteUrl
            ? `${overview.websiteUrl} — all scores below are measured by Lighthouse.`
            : "No website configured yet."
        }
        right={<RunAuditButton disabled={!overview.configured} />}
      />

      <WebsiteTabs active="overview" />

      {!overview.configured && (
        <EmptyState
          message="No website URL configured."
          hint="Add your site URL and the pages you want audited in Website → Settings."
        />
      )}

      {overview.configured && !overview.lighthouseConfigured && (
        <EmptyState
          message="The Lighthouse runner is not configured."
          hint="Set LIGHTHOUSE_BASE_URL and start the lighthouse service (docker compose up lighthouse)."
        />
      )}

      {overview.lastAudit && (
        <>
          <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
            Measured scores
          </div>
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              marginBottom: "1.25rem",
            }}
          >
            <ScoreTile label="Performance" value={scores?.performance ?? null} />
            <ScoreTile label="SEO" value={scores?.seo ?? null} />
            <ScoreTile
              label="Accessibility"
              value={scores?.accessibility ?? null}
            />
            <ScoreTile
              label="Best Practices"
              value={scores?.bestPractices ?? null}
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              marginBottom: "1.25rem",
            }}
          >
            <MetricCard
              label="Critical issues"
              value={String(overview.counts.critical)}
              status={overview.counts.critical > 0 ? "ERROR" : "OK"}
            />
            <MetricCard
              label="High issues"
              value={String(overview.counts.high)}
              status={overview.counts.high > 0 ? "PENDING" : "OK"}
            />
            <MetricCard
              label="Open issues"
              value={String(overview.counts.total)}
              sub={`${overview.counts.medium} medium · ${overview.counts.low} low`}
            />
            <MetricCard
              label="Last audit"
              value={String(overview.lastAudit.pagesAudited)}
              sub={`pages · ${fmtDate(overview.lastAudit.completedAt ?? overview.lastAudit.startedAt)}`}
              status={overview.lastAudit.status}
            />
          </div>

          {overview.lastAudit.pagesFailed > 0 && (
            <div style={{ ...card, marginBottom: "1.25rem", background: "#fdf3d7" }}>
              <p style={{ fontSize: "0.82rem", color: "#8a6d1a" }}>
                {overview.lastAudit.pagesFailed} page
                {overview.lastAudit.pagesFailed === 1 ? "" : "s"} failed to
                audit. Scores above reflect only the pages that succeeded.
              </p>
            </div>
          )}
        </>
      )}

      {!overview.lastAudit && overview.configured && (
        <EmptyState
          message="No completed audit yet."
          hint="Run an audit to measure performance, SEO, accessibility and best practices."
        />
      )}

      <div style={sectionLabel}>Top recommended fixes</div>
      {overview.topRecommendations.length === 0 ? (
        <EmptyState
          message="No recommendations yet."
          hint="Recommendations are generated from measured findings. Run an audit, then generate them from the Recommendations tab."
        />
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {overview.topRecommendations.map((rec) => (
            <div key={rec.id} style={card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  alignItems: "baseline",
                  marginBottom: "0.4rem",
                }}
              >
                <strong style={{ fontSize: "0.95rem" }}>{rec.title}</strong>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <StatusBadge status={rec.priority} />
                  <StatusBadge status={rec.category} />
                </div>
              </div>

              <div style={{ ...sectionLabel, marginBottom: "0.2rem" }}>
                Interpretation
              </div>
              <p style={{ fontSize: "0.84rem", marginBottom: "0.6rem" }}>
                {rec.interpretation}
              </p>

              <div style={{ ...sectionLabel, marginBottom: "0.2rem" }}>
                Proposed fix
              </div>
              <p style={{ fontSize: "0.84rem", marginBottom: "0.6rem" }}>
                {rec.proposedFix}
              </p>

              <div style={{ ...sectionLabel, marginBottom: "0.2rem" }}>
                Measured evidence
              </div>
              <table style={tableStyle}>
                <tbody>
                  {rec.findings.map((f) => (
                    <tr key={f.id}>
                      <td style={td}>
                        <StatusBadge status={f.severity} />
                      </td>
                      <td style={td}>{f.title}</td>
                      <td style={{ ...td, color: "#666" }}>
                        {f.metricName && f.metricValue != null
                          ? `${f.metricName} = ${formatMetric(f.metricValue, f.metricUnit)}`
                          : "—"}
                      </td>
                      <td style={{ ...td, color: "#888", fontSize: "0.75rem" }}>
                        {f.pageUrl}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function formatMetric(value: number, unit: string | null): string {
  if (unit === "ms") {
    return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  }
  if (unit === "bytes") {
    const mb = value / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(value / 1024)}KB`;
  }
  if (unit === "score") return value.toFixed(3);
  return `${value}${unit ? ` ${unit}` : ""}`;
}
