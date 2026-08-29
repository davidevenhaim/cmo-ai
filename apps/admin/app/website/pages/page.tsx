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

interface PageAudit {
  id: string;
  url: string;
  pageType: string;
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
  bestPractices: number | null;
  metrics: Record<string, number | null> | null;
  status: string;
  failureReason: string | null;
  fetchedAt: string;
}

export const dynamic = "force-dynamic";

function score(v: number | null) {
  if (v == null) return <span style={{ color: "#888" }}>—</span>;
  const color = v >= 90 ? "#1a7a3d" : v >= 50 ? "#8a6d1a" : "#a02a2a";
  return <strong style={{ color }}>{Math.round(v)}</strong>;
}

export default async function WebsitePagesPage() {
  const pages = (await fetchJson<PageAudit[]>("/website/pages")) ?? [];

  return (
    <>
      <PageHeader
        title="Website — Pages"
        subtitle="Per-page Lighthouse results from the most recent audit."
      />
      <WebsiteTabs active="pages" />

      {pages.length === 0 ? (
        <EmptyState
          message="No pages audited yet."
          hint="Configure audit URLs in Settings, then run an audit."
        />
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>URL</th>
              <th style={th}>Type</th>
              <th style={th}>Perf</th>
              <th style={th}>SEO</th>
              <th style={th}>A11y</th>
              <th style={th}>Best pr.</th>
              <th style={th}>LCP</th>
              <th style={th}>CLS</th>
              <th style={th}>Status</th>
              <th style={th}>Audited</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.id}>
                <td style={{ ...td, maxWidth: 280, wordBreak: "break-all" }}>
                  {p.url}
                </td>
                <td style={td}>{p.pageType}</td>
                <td style={td}>{score(p.performance)}</td>
                <td style={td}>{score(p.seo)}</td>
                <td style={td}>{score(p.accessibility)}</td>
                <td style={td}>{score(p.bestPractices)}</td>
                <td style={td}>
                  {p.metrics?.lcpMs != null
                    ? `${(p.metrics.lcpMs / 1000).toFixed(2)}s`
                    : "—"}
                </td>
                <td style={td}>
                  {p.metrics?.clsScore != null
                    ? p.metrics.clsScore.toFixed(3)
                    : "—"}
                </td>
                <td style={td}>
                  <StatusBadge status={p.status} />
                  {p.failureReason && (
                    <div
                      style={{
                        fontSize: "0.7rem",
                        color: "#a02a2a",
                        marginTop: "0.2rem",
                      }}
                    >
                      {p.failureReason}
                    </div>
                  )}
                </td>
                <td style={{ ...td, fontSize: "0.75rem", color: "#888" }}>
                  {fmtDate(p.fetchedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
