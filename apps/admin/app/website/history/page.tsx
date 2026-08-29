import { fetchJson } from "../../lib/api";
import {
  EmptyState,
  fmtDate,
  PageHeader,
  StatusBadge,
  tableStyle,
  td,
  th,
} from "../../components/ui";
import WebsiteTabs from "../WebsiteTabs";

interface HistoryEntry {
  auditId: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  scores: {
    performance: number | null;
    accessibility: number | null;
    seo: number | null;
    bestPractices: number | null;
  } | null;
  pages: Array<{
    url: string;
    pageType: string;
    performance: number | null;
    metrics: Record<string, number | null> | null;
  }>;
}

export const dynamic = "force-dynamic";

/** Renders a score alongside its movement from the previous audit. */
function delta(current: number | null, previous: number | null) {
  if (current == null) return <span style={{ color: "#888" }}>—</span>;
  if (previous == null) return <strong>{Math.round(current)}</strong>;
  const diff = Math.round(current - previous);
  if (diff === 0) {
    return (
      <>
        <strong>{Math.round(current)}</strong>
        <span style={{ color: "#888", fontSize: "0.72rem" }}> (=)</span>
      </>
    );
  }
  // Scores are "higher is better", so a rise is an improvement.
  const improved = diff > 0;
  return (
    <>
      <strong>{Math.round(current)}</strong>
      <span
        style={{
          color: improved ? "#1a7a3d" : "#a02a2a",
          fontSize: "0.72rem",
          fontWeight: 700,
        }}
      >
        {" "}
        ({improved ? "+" : ""}
        {diff})
      </span>
    </>
  );
}

export default async function WebsiteHistoryPage() {
  const history = (await fetchJson<HistoryEntry[]>("/website/history")) ?? [];

  return (
    <>
      <PageHeader
        title="Website — History"
        subtitle="Movement between audits. Deltas are arithmetic over stored measurements."
      />
      <WebsiteTabs active="history" />

      {history.length === 0 ? (
        <EmptyState
          message="No audit history yet."
          hint="History appears once two or more audits have completed."
        />
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>Audit</th>
              <th style={th}>Status</th>
              <th style={th}>Pages</th>
              <th style={th}>Performance</th>
              <th style={th}>SEO</th>
              <th style={th}>Accessibility</th>
              <th style={th}>Best practices</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry, i) => {
              // history is newest-first, so the "previous" audit is the next row.
              const prev = history[i + 1]?.scores ?? null;
              return (
                <tr key={entry.auditId}>
                  <td style={td}>
                    {fmtDate(entry.completedAt ?? entry.startedAt)}
                  </td>
                  <td style={td}>
                    <StatusBadge status={entry.status} />
                  </td>
                  <td style={td}>{entry.pages.length}</td>
                  <td style={td}>
                    {delta(entry.scores?.performance ?? null, prev?.performance ?? null)}
                  </td>
                  <td style={td}>
                    {delta(entry.scores?.seo ?? null, prev?.seo ?? null)}
                  </td>
                  <td style={td}>
                    {delta(
                      entry.scores?.accessibility ?? null,
                      prev?.accessibility ?? null,
                    )}
                  </td>
                  <td style={td}>
                    {delta(
                      entry.scores?.bestPractices ?? null,
                      prev?.bestPractices ?? null,
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
