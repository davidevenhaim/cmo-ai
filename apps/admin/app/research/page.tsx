const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function getResearchStatus() {
  try {
    const res = await fetch(`${API}/research/status`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getResearchRuns() {
  try {
    const res = await fetch(`${API}/research/runs`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function getFindings() {
  try {
    const res = await fetch(`${API}/research/findings`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function getOpportunities() {
  try {
    const res = await fetch(`${API}/research/opportunities`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

const card: React.CSSProperties = {
  padding: "1.25rem",
  background: "#fff",
  borderRadius: 8,
  border: "1px solid #e5e5e5",
  marginBottom: "1rem",
};

const label: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#888",
  textTransform: "uppercase",
  marginBottom: "0.6rem",
};

const badge: (color: string) => React.CSSProperties = (color) => ({
  display: "inline-block",
  padding: "0.15rem 0.45rem",
  borderRadius: 4,
  fontSize: "0.7rem",
  fontWeight: 600,
  background: color,
  color: "#fff",
  marginRight: "0.4rem",
});

const TYPE_COLORS: Record<string, string> = {
  CONTENT_IDEA: "#6c63ff",
  ENGAGEMENT: "#2a7",
  TREND: "#e07b00",
  COMPETITOR_ACTIVITY: "#c44",
  CUSTOMER_QUESTION: "#0088cc",
  PRODUCT_INSIGHT: "#7a4",
};

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "#2a7",
  PARTIAL: "#e07b00",
  FAILED: "#c44",
  RUNNING: "#0088cc",
  PENDING: "#888",
};

export default async function ResearchPage() {
  const [status, runs, findings, opportunities] = await Promise.all([
    getResearchStatus(),
    getResearchRuns(),
    getFindings(),
    getOpportunities(),
  ]);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700 }}>Research</h1>
        <a href="/" style={{ fontSize: "0.875rem", color: "#666" }}>
          ← Dashboard
        </a>
      </div>

      {/* Status bar */}
      <div style={card}>
        <div style={label}>Status</div>
        {status ? (
          <div style={{ display: "flex", gap: "2rem", fontSize: "0.875rem" }}>
            <span>
              Findings: <b>{status.totalFindings}</b>
            </span>
            <span>
              New opportunities: <b>{status.newOpportunities}</b>
            </span>
            {status.lastRunAt && (
              <span>
                Last run: {new Date(status.lastRunAt).toLocaleString()}{" "}
                <span
                  style={{
                    ...badge(STATUS_COLORS[status.lastRunStatus] ?? "#888"),
                  }}
                >
                  {status.lastRunStatus}
                </span>
              </span>
            )}
            {!status.lastRunAt && (
              <span style={{ color: "#888" }}>No runs yet</span>
            )}
          </div>
        ) : (
          <p style={{ color: "#888", fontSize: "0.875rem" }}>
            Research service unavailable.
          </p>
        )}
      </div>

      {/* Opportunities */}
      <div style={{ ...label, marginTop: "1rem" }}>
        Opportunities (
        {opportunities.filter((o: any) => o.status === "NEW").length} new)
      </div>
      {opportunities.length === 0 ? (
        <p
          style={{
            color: "#888",
            fontSize: "0.875rem",
            marginBottom: "1.5rem",
          }}
        >
          No opportunities yet. Trigger a research run via POST /research/run or
          /research in Telegram.
        </p>
      ) : (
        <div style={{ marginBottom: "1.5rem" }}>
          {opportunities.slice(0, 15).map((opp: any) => (
            <div key={opp.id} style={card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "0.35rem",
                }}
              >
                <span>
                  <span style={badge(TYPE_COLORS[opp.type] ?? "#888")}>
                    {opp.type.replace(/_/g, " ")}
                  </span>
                  <b style={{ fontSize: "0.875rem" }}>{opp.title}</b>
                </span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: opp.status === "NEW" ? "#2a7" : "#888",
                  }}
                >
                  {opp.status}
                </span>
              </div>
              <p
                style={{
                  fontSize: "0.8rem",
                  color: "#555",
                  margin: "0 0 0.3rem",
                }}
              >
                {opp.summary}
              </p>
              <div
                style={{
                  fontSize: "0.72rem",
                  color: "#888",
                  display: "flex",
                  gap: "1rem",
                }}
              >
                <span>relevance: {(opp.relevanceScore * 100).toFixed(0)}%</span>
                <span>urgency: {(opp.urgencyScore * 100).toFixed(0)}%</span>
                <span>{new Date(opp.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Findings */}
      <div style={label}>Recent Findings ({findings.length})</div>
      {findings.length === 0 ? (
        <p
          style={{
            color: "#888",
            fontSize: "0.875rem",
            marginBottom: "1.5rem",
          }}
        >
          No findings yet.
        </p>
      ) : (
        <div style={{ marginBottom: "1.5rem" }}>
          {findings.slice(0, 20).map((f: any) => (
            <div
              key={f.id}
              style={{
                ...card,
                padding: "0.9rem 1.25rem",
                borderLeft: `3px solid ${TYPE_COLORS[f.sourceType] ?? "#ccc"}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "0.25rem",
                }}
              >
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    color: "#333",
                    textDecoration: "none",
                  }}
                >
                  {f.title}
                </a>
                <span style={{ fontSize: "0.72rem", color: "#888" }}>
                  {f.sourceType} · {(f.relevanceScore * 100).toFixed(0)}%
                </span>
              </div>
              <p
                style={{
                  fontSize: "0.8rem",
                  color: "#666",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                }}
              >
                {f.excerpt}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Runs */}
      <div style={label}>Research Runs</div>
      {runs.length === 0 ? (
        <p style={{ color: "#888", fontSize: "0.875rem" }}>No runs yet.</p>
      ) : (
        runs.slice(0, 10).map((run: any) => (
          <div
            key={run.id}
            style={{
              ...card,
              padding: "0.8rem 1.25rem",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: "0.875rem" }}>
              <span style={badge(STATUS_COLORS[run.status] ?? "#888")}>
                {run.status}
              </span>
              {run.triggeredBy} · {run.findingsCreated} created,{" "}
              {run.findingsUpdated} updated, {run.opportunitiesCreated}{" "}
              opportunities
            </span>
            <span style={{ fontSize: "0.75rem", color: "#888" }}>
              {new Date(run.startedAt).toLocaleString()}
            </span>
          </div>
        ))
      )}
    </main>
  );
}
