import { fetchJson } from "../lib/api";
import {
  card,
  sectionLabel,
  StatusBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  fmtDate,
  tableStyle,
  th,
  td,
} from "../components/ui";
import CreateContentButton from "./CreateContentButton";

export const dynamic = "force-dynamic";

interface MarketStatus {
  lastRun: {
    status: string;
    startedAt: string;
    completedAt: string | null;
    trigger: string;
  } | null;
  keywords: number;
  newMarketOpportunities: number;
  newSearchOpportunities: number;
  searchConsoleConfigured: boolean;
}

interface MarketOpportunity {
  id: string;
  topic: string;
  source: string;
  recommendedAction: string;
  score: number;
  explanation: string;
  status: string;
  createdAt: string;
}

interface SearchOpportunity {
  id: string;
  opportunityType: string;
  topic: string;
  score: number;
  reason: string;
  status: string;
  keyword: { keyword: string } | null;
}

interface Keyword {
  id: string;
  keyword: string;
  topic: string | null;
  intent: string | null;
  source: string;
  relevance: number;
  metrics: Array<{
    source: string;
    period: string;
    clicks: number | null;
    impressions: number | null;
    averagePosition: number | null;
    trendScore: number | null;
    trendDelta: number | null;
  }>;
}

interface Question {
  id: string;
  question: string;
  source: string;
  frequency: number;
}

// Provider truth: the MI module currently wires mock providers only.
function provenance(status: MarketStatus): string {
  if (!status.searchConsoleConfigured) return "MOCK";
  if (!status.lastRun?.completedAt) return "INCOMPLETE";
  const ageHours =
    (Date.now() - new Date(status.lastRun.completedAt).getTime()) / 36e5;
  return ageHours > 48 ? "STALE" : "LIVE";
}

export default async function MarketPage() {
  const [status, opportunities, searchOpps, keywords, questions] =
    await Promise.all([
      fetchJson<MarketStatus>("/market-intelligence/status"),
      fetchJson<MarketOpportunity[]>("/market-intelligence/opportunities"),
      fetchJson<SearchOpportunity[]>(
        "/market-intelligence/search-opportunities",
      ),
      fetchJson<Keyword[]>("/market-intelligence/keywords"),
      fetchJson<Question[]>("/market-intelligence/questions"),
    ]);

  if (!status) {
    return (
      <ErrorState message="Backend unreachable — market intelligence unavailable." />
    );
  }

  const chip = provenance(status);
  const gaps = (searchOpps ?? []).filter(
    (o) => o.opportunityType === "CONTENT_GAP",
  );
  const nonGapSearchOpps = (searchOpps ?? []).filter(
    (o) => o.opportunityType !== "CONTENT_GAP",
  );
  const rising = nonGapSearchOpps.filter(
    (o) => o.opportunityType === "RISING_QUERY",
  );

  return (
    <div>
      <PageHeader
        title="Market"
        subtitle="Search and trend signals with honest provenance. Mock data never looks live."
        right={<StatusBadge status={chip} />}
      />

      <div
        style={{
          fontSize: "0.75rem",
          color: "#888",
          marginBottom: "1rem",
        }}
      >
        {status.lastRun
          ? `Last sync ${status.lastRun.status} — ${fmtDate(
              status.lastRun.completedAt ?? status.lastRun.startedAt,
            )} (${status.lastRun.trigger})`
          : "No market intelligence sync has run yet."}{" "}
        · {status.keywords} active keywords ·{" "}
        {status.newMarketOpportunities + status.newSearchOpportunities} new
        opportunities
      </div>

      <div style={sectionLabel}>Opportunities</div>
      {!opportunities || opportunities.length === 0 ? (
        <EmptyState
          message="No new market opportunities."
          hint="Opportunities are created by the market intelligence sync from real (or mock) signals — never invented."
        />
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
        >
          {opportunities.map((o) => (
            <div key={o.id} style={{ ...card, padding: "0.9rem 1.1rem" }}>
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
                      {o.topic}
                    </span>
                    <StatusBadge status={chip} />
                    <span style={{ fontSize: "0.68rem", color: "#888" }}>
                      {o.source} · {o.recommendedAction} · score{" "}
                      {o.score.toFixed(1)}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: "0.8rem",
                      color: "#555",
                      marginTop: "0.3rem",
                    }}
                  >
                    {o.explanation}
                  </p>
                </div>
                <div style={{ alignSelf: "center" }}>
                  <CreateContentButton topic={o.topic} opportunityId={o.id} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
        Rising queries
      </div>
      {rising.length === 0 ? (
        <EmptyState message="No rising queries detected." />
      ) : (
        <div style={card}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Topic</th>
                <th style={th}>Score</th>
                <th style={th}>Reason</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rising.map((o) => (
                <tr key={o.id}>
                  <td style={td}>{o.topic}</td>
                  <td style={td}>{o.score.toFixed(1)}</td>
                  <td style={{ ...td, color: "#666" }}>{o.reason}</td>
                  <td style={td}>
                    <CreateContentButton topic={o.topic} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
        Search opportunities
      </div>
      {nonGapSearchOpps.length === 0 ? (
        <EmptyState message="No new search opportunities." />
      ) : (
        <div style={card}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Topic</th>
                <th style={th}>Type</th>
                <th style={th}>Keyword</th>
                <th style={th}>Score</th>
                <th style={th}>Reason</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {nonGapSearchOpps.map((o) => (
                <tr key={o.id}>
                  <td style={td}>{o.topic}</td>
                  <td style={td}>{o.opportunityType}</td>
                  <td style={td}>{o.keyword?.keyword ?? "—"}</td>
                  <td style={td}>{o.score.toFixed(1)}</td>
                  <td style={{ ...td, color: "#666" }}>{o.reason}</td>
                  <td style={td}>
                    <CreateContentButton topic={o.topic} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>Content gaps</div>
      {gaps.length === 0 ? (
        <EmptyState message="No content gaps detected." />
      ) : (
        <div style={card}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Topic</th>
                <th style={th}>Score</th>
                <th style={th}>Reason</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((o) => (
                <tr key={o.id}>
                  <td style={td}>{o.topic}</td>
                  <td style={td}>{o.score.toFixed(1)}</td>
                  <td style={{ ...td, color: "#666" }}>{o.reason}</td>
                  <td style={td}>
                    <CreateContentButton topic={o.topic} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>Keywords</div>
      {!keywords || keywords.length === 0 ? (
        <EmptyState message="No active keywords." />
      ) : (
        <div style={card}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Keyword</th>
                <th style={th}>Intent</th>
                <th style={th}>Source</th>
                <th style={th}>Relevance</th>
                <th style={th}>Latest metric</th>
              </tr>
            </thead>
            <tbody>
              {keywords.slice(0, 25).map((k) => {
                const m = k.metrics[0];
                const metric = m
                  ? m.trendScore != null
                    ? `trend ${m.trendScore}${
                        m.trendDelta != null
                          ? ` (${m.trendDelta > 0 ? "+" : ""}${m.trendDelta})`
                          : ""
                      }`
                    : m.impressions != null
                      ? `${m.impressions} impr · pos ${m.averagePosition?.toFixed(1) ?? "—"}`
                      : m.period
                  : "—";
                return (
                  <tr key={k.id}>
                    <td style={td}>{k.keyword}</td>
                    <td style={td}>{k.intent ?? "—"}</td>
                    <td style={td}>{k.source}</td>
                    <td style={td}>{k.relevance.toFixed(2)}</td>
                    <td style={{ ...td, color: "#666" }}>{metric}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ ...sectionLabel, marginTop: "1.25rem" }}>
        Research — audience questions
      </div>
      {!questions || questions.length === 0 ? (
        <EmptyState message="No audience questions collected." />
      ) : (
        <div style={card}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Question</th>
                <th style={th}>Source</th>
                <th style={th}>Frequency</th>
              </tr>
            </thead>
            <tbody>
              {questions.slice(0, 15).map((q) => (
                <tr key={q.id}>
                  <td style={td}>{q.question}</td>
                  <td style={td}>{q.source}</td>
                  <td style={td}>{q.frequency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
