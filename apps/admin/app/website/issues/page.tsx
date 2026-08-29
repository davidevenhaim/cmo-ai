import { fetchJson } from "../../lib/api";
import {
  card,
  EmptyState,
  fmtDate,
  PageHeader,
  sectionLabel,
  StatusBadge,
} from "../../components/ui";
import WebsiteTabs from "../WebsiteTabs";
import IssueFilters from "./IssueFilters";

interface Finding {
  id: string;
  pageUrl: string;
  pageType: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  evidence: Record<string, unknown> | null;
  metricName: string | null;
  metricValue: number | null;
  metricUnit: string | null;
  source: string;
  evidenceClass: string;
  status: string;
  detectedAt: string;
  lastSeenAt: string;
  suggestedFix: string | null;
  confidence: number;
  history: Array<{ auditId: string; at: string; value: number | null; severity: string }>;
}

export const dynamic = "force-dynamic";

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

export default async function WebsiteIssuesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | undefined>;
}) {
  const params = new URLSearchParams();
  params.set("status", searchParams?.status ?? "OPEN");
  if (searchParams?.severity) params.set("severity", searchParams.severity);
  if (searchParams?.category) params.set("category", searchParams.category);
  if (searchParams?.pageUrl) params.set("pageUrl", searchParams.pageUrl);

  const findings =
    (await fetchJson<Finding[]>(`/website/findings?${params.toString()}`)) ?? [];

  const pageUrls = [...new Set(findings.map((f) => f.pageUrl))];

  return (
    <>
      <PageHeader
        title="Website — Issues"
        subtitle="Measured findings are facts. AI observations are interpretations, and are labelled as such."
      />
      <WebsiteTabs active="issues" />

      <IssueFilters current={searchParams ?? {}} pageUrls={pageUrls} />

      {findings.length === 0 ? (
        <EmptyState
          message="No issues match these filters."
          hint="Try clearing a filter, or run an audit if none has completed yet."
        />
      ) : (
        <div style={{ display: "grid", gap: "0.7rem" }}>
          {findings.map((f) => (
            <div key={f.id} style={card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  alignItems: "baseline",
                  marginBottom: "0.4rem",
                  flexWrap: "wrap",
                }}
              >
                <strong style={{ fontSize: "0.92rem" }}>{f.title}</strong>
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                  <StatusBadge status={f.severity} />
                  <StatusBadge status={f.category} />
                  <StatusBadge status={f.status} />
                </div>
              </div>

              <div
                style={{
                  fontSize: "0.72rem",
                  color: "#888",
                  marginBottom: "0.5rem",
                  wordBreak: "break-all",
                }}
              >
                {f.pageUrl} · {f.pageType}
              </div>

              {/* The fact/interpretation split is surfaced, not just stored. */}
              <div
                style={{
                  display: "inline-block",
                  padding: "0.1rem 0.5rem",
                  borderRadius: 4,
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  marginBottom: "0.5rem",
                  background:
                    f.evidenceClass === "FACT" ? "#e8f0fb" : "#f0e8fb",
                  color: f.evidenceClass === "FACT" ? "#2a5aa0" : "#6a3aa0",
                }}
              >
                {f.evidenceClass === "FACT"
                  ? `MEASURED FACT · ${f.source}`
                  : `AI INTERPRETATION · ${Math.round(f.confidence * 100)}% confidence`}
              </div>

              <p style={{ fontSize: "0.84rem", marginBottom: "0.5rem" }}>
                {f.description}
              </p>

              {f.metricName && f.metricValue != null && (
                <>
                  <div style={{ ...sectionLabel, marginBottom: "0.15rem" }}>
                    Evidence
                  </div>
                  <p
                    style={{
                      fontSize: "0.84rem",
                      fontFamily: "ui-monospace, monospace",
                      marginBottom: "0.5rem",
                    }}
                  >
                    {f.metricName} = {formatMetric(f.metricValue, f.metricUnit)}
                  </p>
                </>
              )}

              {f.suggestedFix && (
                <>
                  <div style={{ ...sectionLabel, marginBottom: "0.15rem" }}>
                    Recommended fix
                  </div>
                  <p style={{ fontSize: "0.84rem", marginBottom: "0.5rem" }}>
                    {f.suggestedFix}
                  </p>
                </>
              )}

              {f.history?.length > 1 && (
                <div style={{ fontSize: "0.72rem", color: "#666" }}>
                  Seen {f.history.length} times ·{" "}
                  {f.history
                    .slice(-4)
                    .map((h) => (h.value != null ? Math.round(h.value) : "—"))
                    .join(" → ")}
                </div>
              )}

              <div
                style={{ fontSize: "0.7rem", color: "#999", marginTop: "0.4rem" }}
              >
                First detected {fmtDate(f.detectedAt)} · last seen{" "}
                {fmtDate(f.lastSeenAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
