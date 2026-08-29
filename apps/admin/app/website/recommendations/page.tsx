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
import GenerateButton from "./GenerateButton";

interface Recommendation {
  id: string;
  title: string;
  interpretation: string;
  proposedFix: string;
  category: string;
  priority: string;
  confidence: number;
  status: string;
  modelId: string | null;
  createdAt: string;
  findings: Array<{
    id: string;
    title: string;
    pageUrl: string;
    severity: string;
    category: string;
    metricName: string | null;
    metricValue: number | null;
    metricUnit: string | null;
    evidenceClass: string;
  }>;
}

export const dynamic = "force-dynamic";

export default async function WebsiteRecommendationsPage() {
  const recs =
    (await fetchJson<Recommendation[]>("/website/recommendations")) ?? [];

  return (
    <>
      <PageHeader
        title="Website — Recommendations"
        subtitle="Model interpretation of measured findings. Every recommendation cites the facts it is grounded in."
        right={<GenerateButton />}
      />
      <WebsiteTabs active="recommendations" />

      {recs.length === 0 ? (
        <EmptyState
          message="No recommendations yet."
          hint="Run an audit, then generate recommendations from the measured findings."
        />
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {recs.map((rec) => (
            <div key={rec.id} style={card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  alignItems: "baseline",
                  marginBottom: "0.5rem",
                  flexWrap: "wrap",
                }}
              >
                <strong style={{ fontSize: "0.95rem" }}>{rec.title}</strong>
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                  <StatusBadge status={rec.priority} />
                  <StatusBadge status={rec.category} />
                  <StatusBadge status={rec.status} />
                </div>
              </div>

              <div style={{ ...sectionLabel, marginBottom: "0.15rem" }}>
                Interpretation (model opinion)
              </div>
              <p style={{ fontSize: "0.84rem", marginBottom: "0.6rem" }}>
                {rec.interpretation}
              </p>

              <div style={{ ...sectionLabel, marginBottom: "0.15rem" }}>
                Proposed fix
              </div>
              <p style={{ fontSize: "0.84rem", marginBottom: "0.6rem" }}>
                {rec.proposedFix}
              </p>

              <div style={{ ...sectionLabel, marginBottom: "0.15rem" }}>
                Grounded in these measured facts
              </div>
              <ul style={{ fontSize: "0.8rem", paddingLeft: "1.1rem" }}>
                {rec.findings.map((f) => (
                  <li key={f.id} style={{ marginBottom: "0.2rem" }}>
                    <strong>{f.title}</strong>
                    {f.metricName && f.metricValue != null && (
                      <span style={{ color: "#666" }}>
                        {" "}
                        — {f.metricName} = {f.metricValue}
                        {f.metricUnit ? ` ${f.metricUnit}` : ""}
                      </span>
                    )}
                    <span style={{ color: "#999", fontSize: "0.72rem" }}>
                      {" "}
                      ({f.pageUrl})
                    </span>
                  </li>
                ))}
              </ul>

              <div
                style={{ fontSize: "0.7rem", color: "#999", marginTop: "0.5rem" }}
              >
                {Math.round(rec.confidence * 100)}% model confidence ·{" "}
                {rec.modelId ?? "unknown model"} · {fmtDate(rec.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
