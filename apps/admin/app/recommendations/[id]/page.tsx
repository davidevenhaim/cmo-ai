import { fetchJson } from "../../lib/api";
import {
  card,
  sectionLabel,
  StatusBadge,
  ErrorState,
  PageHeader,
  fmtDate,
  fmtMoney,
  tableStyle,
  th,
  td,
} from "../../components/ui";
import { attributionLabel } from "../../components/attribution";
import DecideActions from "../DecideActions";

export const dynamic = "force-dynamic";

interface EvidenceRef {
  source: string;
  refType: string;
  refId: string | null;
  note: string | null;
}

interface OutcomeMetric {
  id: string;
  dimension: string;
  metric: string;
  value: number;
  unit: string;
  currencyCode: string | null;
  baseline: number | null;
  delta: number | null;
  deltaPct: number | null;
  source: string;
  attributionStrength: string;
  dataQuality: string;
  observedAt: string;
}

interface RecommendationDetail {
  id: string;
  type: string;
  title: string;
  rationale: string;
  evidenceRefs: EvidenceRef[];
  confidence: number;
  expectedImpact: string | null;
  expectedImpactValue: number | null;
  expectedImpactUnit: string | null;
  targetType: string | null;
  targetId: string | null;
  actionClass: string;
  status: string;
  rejectionReason: string | null;
  rejectionNote: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  measurementWindowDays: number;
  measurementWindowEndsAt: string | null;
  measuredAt: string | null;
  outcome: string | null;
  outcomeSummary: string | null;
  attributionStrength: string | null;
  dataQuality: string | null;
  createdAt: string;
  outcomeMetrics: OutcomeMetric[];
  contentBriefs: Array<{
    id: string;
    topic: string;
    channel: string;
    status: string;
    drafts: Array<{
      id: string;
      status: string;
      publishRequests: Array<{
        id: string;
        status: string;
        publication: {
          id: string;
          status: string;
          publishedAt: string | null;
          url: string | null;
        } | null;
      }>;
    }>;
  }>;
  revenueOpportunities: Array<{
    id: string;
    type: string;
    status: string;
    journey: { id: string; status: string; createdAt: string } | null;
    attributions: Array<{
      id: string;
      attributionType: string;
      revenue: number;
      contributionProfit: number;
      currencyCode: string | null;
    }>;
  }>;
}

function TimelineStep({
  label,
  reached,
  when,
  children,
}: {
  label: string;
  reached: boolean;
  when?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: "0.75rem" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            marginTop: 4,
            background: reached ? "#1a1a1a" : "#ddd",
          }}
        />
        <div style={{ width: 2, flex: 1, background: "#eee" }} />
      </div>
      <div style={{ paddingBottom: "1.1rem", flex: 1 }}>
        <div
          style={{
            display: "flex",
            gap: "0.6rem",
            alignItems: "baseline",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: "0.8rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: reached ? "#1a1a1a" : "#aaa",
            }}
          >
            {label}
          </span>
          {when && (
            <span style={{ fontSize: "0.72rem", color: "#999" }}>
              {fmtDate(when)}
            </span>
          )}
        </div>
        {reached && children && (
          <div style={{ marginTop: "0.35rem" }}>{children}</div>
        )}
        {!reached && (
          <div
            style={{ fontSize: "0.75rem", color: "#bbb", marginTop: "0.2rem" }}
          >
            not reached
          </div>
        )}
      </div>
    </div>
  );
}

export default async function RecommendationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const rec = await fetchJson<RecommendationDetail>(
    `/measurement/recommendations/${params.id}`,
  );
  if (!rec) {
    return (
      <ErrorState message="Recommendation not found or backend unreachable." />
    );
  }

  const decided = rec.decidedAt != null;
  const executed = rec.executedAt != null;
  const measuring = executed && ["MEASURING", "MEASURED"].includes(rec.status);
  const measured = rec.status === "MEASURED";

  const publications = rec.contentBriefs
    .flatMap((b) => b.drafts)
    .flatMap((d) => d.publishRequests)
    .map((r) => r.publication)
    .filter((p): p is NonNullable<typeof p> => p != null);

  return (
    <div>
      <PageHeader
        title={rec.title}
        subtitle={`${rec.type.replace(/_/g, " ").toLowerCase()} · confidence ${(rec.confidence * 100).toFixed(0)}%`}
        right={<StatusBadge status={rec.status} />}
      />

      <div style={{ ...card, marginBottom: "1.25rem" }}>
        <TimelineStep label="Signal" reached when={rec.createdAt}>
          {rec.evidenceRefs.length > 0 ? (
            <ul style={{ fontSize: "0.8rem", color: "#444", paddingLeft: 16 }}>
              {rec.evidenceRefs.map((e, i) => (
                <li key={i}>
                  {e.source} · {e.refType}
                  {e.refId ? ` · ${e.refId}` : ""}
                  {e.note ? ` — ${e.note}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <span style={{ fontSize: "0.8rem", color: "#888" }}>
              No structured evidence recorded.
            </span>
          )}
        </TimelineStep>

        <TimelineStep label="Recommendation" reached when={rec.createdAt}>
          <p style={{ fontSize: "0.83rem", color: "#444" }}>{rec.rationale}</p>
          {rec.expectedImpact && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "#888",
                marginTop: "0.25rem",
              }}
            >
              Expected impact: {rec.expectedImpact}
            </p>
          )}
        </TimelineStep>

        <TimelineStep
          label="Owner decision"
          reached={decided}
          when={rec.decidedAt}
        >
          {rec.status === "REJECTED" ? (
            <div style={{ fontSize: "0.82rem", color: "#7a2020" }}>
              Rejected
              {rec.rejectionReason
                ? ` — ${rec.rejectionReason.replace(/_/g, " ").toLowerCase()}`
                : ""}
              {rec.rejectionNote && (
                <p style={{ color: "#666", marginTop: "0.2rem" }}>
                  “{rec.rejectionNote}”
                </p>
              )}
              <p
                style={{
                  fontSize: "0.72rem",
                  color: "#999",
                  marginTop: "0.25rem",
                }}
              >
                Rejection is recorded as feedback — nothing is deleted.
              </p>
            </div>
          ) : (
            <span style={{ fontSize: "0.82rem", color: "#1a7a3d" }}>
              Approved
            </span>
          )}
        </TimelineStep>

        <TimelineStep
          label="Execution"
          reached={executed}
          when={rec.executedAt}
        >
          {publications.length > 0 && (
            <ul style={{ fontSize: "0.8rem", color: "#444", paddingLeft: 16 }}>
              {publications.map((p) => (
                <li key={p.id}>
                  Publication <StatusBadge status={p.status} />{" "}
                  {p.url && (
                    <a href={p.url} style={{ color: "#2a5aa0" }}>
                      {p.url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {rec.revenueOpportunities.some((o) => o.journey) && (
            <p style={{ fontSize: "0.8rem", color: "#444" }}>
              Recovery journey started.
            </p>
          )}
          {publications.length === 0 &&
            !rec.revenueOpportunities.some((o) => o.journey) && (
              <span style={{ fontSize: "0.8rem", color: "#888" }}>
                Executed{rec.status === "FAILED" ? " — failed" : ""}.
              </span>
            )}
        </TimelineStep>

        <TimelineStep
          label="Measurement"
          reached={measuring}
          when={rec.measurementWindowEndsAt}
        >
          <span style={{ fontSize: "0.8rem", color: "#444" }}>
            {rec.measurementWindowDays}-day window
            {rec.measurementWindowEndsAt
              ? ` ending ${fmtDate(rec.measurementWindowEndsAt)}`
              : ""}
            .
          </span>
        </TimelineStep>

        <TimelineStep label="Outcome" reached={measured} when={rec.measuredAt}>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {rec.outcome && <StatusBadge status={rec.outcome} />}
            <span style={{ fontSize: "0.75rem", color: "#777" }}>
              attribution: {attributionLabel(rec.attributionStrength)}
            </span>
            {rec.dataQuality && (
              <span style={{ fontSize: "0.75rem", color: "#777" }}>
                data quality: {rec.dataQuality.toLowerCase()}
              </span>
            )}
          </div>
          {rec.outcomeSummary && (
            <p
              style={{
                fontSize: "0.82rem",
                color: "#444",
                marginTop: "0.3rem",
              }}
            >
              {rec.outcomeSummary}
            </p>
          )}
        </TimelineStep>
      </div>

      {rec.status === "PROPOSED" && (
        <div style={{ ...card, marginBottom: "1.25rem" }}>
          <div style={sectionLabel}>Decide</div>
          <DecideActions recommendationId={rec.id} />
        </div>
      )}

      {rec.outcomeMetrics.length > 0 && (
        <div style={{ ...card, marginBottom: "1.25rem" }}>
          <div style={sectionLabel}>Outcome metrics</div>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Metric</th>
                <th style={th}>Value</th>
                <th style={th}>Baseline</th>
                <th style={th}>Δ</th>
                <th style={th}>Attribution</th>
                <th style={th}>Quality</th>
              </tr>
            </thead>
            <tbody>
              {rec.outcomeMetrics.map((m) => (
                <tr key={m.id}>
                  <td style={td}>
                    {m.metric}
                    <span style={{ color: "#999", fontSize: "0.7rem" }}>
                      {" "}
                      ({m.dimension.toLowerCase()})
                    </span>
                  </td>
                  <td style={td}>
                    {m.unit === "CURRENCY"
                      ? fmtMoney(m.value, m.currencyCode)
                      : m.value.toLocaleString()}
                  </td>
                  <td style={td}>
                    {m.baseline != null ? m.baseline.toLocaleString() : "—"}
                  </td>
                  <td style={td}>
                    {m.deltaPct != null
                      ? `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}%`
                      : "—"}
                  </td>
                  <td style={{ ...td, fontSize: "0.75rem", color: "#777" }}>
                    {attributionLabel(m.attributionStrength)}
                  </td>
                  <td style={td}>
                    <StatusBadge status={m.dataQuality} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rec.revenueOpportunities.some((o) => o.attributions.length > 0) && (
        <div style={{ ...card, marginBottom: "1.25rem" }}>
          <div style={sectionLabel}>Revenue attributions</div>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Type</th>
                <th style={th}>Revenue</th>
                <th style={th}>Contribution profit</th>
              </tr>
            </thead>
            <tbody>
              {rec.revenueOpportunities
                .flatMap((o) => o.attributions)
                .map((a) => (
                  <tr key={a.id}>
                    <td style={td}>
                      {a.attributionType === "ATTRIBUTED"
                        ? "attributed (last-touch — not incremental)"
                        : "incremental estimate (experiment-backed)"}
                    </td>
                    <td style={td}>{fmtMoney(a.revenue, a.currencyCode)}</td>
                    <td style={td}>
                      {fmtMoney(a.contributionProfit, a.currencyCode)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: "0.72rem", color: "#999" }}>
        Created {fmtDate(rec.createdAt)} · action class {rec.actionClass} ·{" "}
        <a href="/analytics?tab=recommendations" style={{ color: "#2a5aa0" }}>
          ← all recommendations
        </a>
      </p>
    </div>
  );
}
