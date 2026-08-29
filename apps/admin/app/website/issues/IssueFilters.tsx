"use client";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const CATEGORIES = [
  "PERFORMANCE",
  "SEO",
  "ACCESSIBILITY",
  "BEST_PRACTICE",
  "CONVERSION",
  "CONTENT",
  "MOBILE",
  "TRUST",
  "PRODUCT_PAGE",
  "CHECKOUT",
  "TECHNICAL",
];
const STATUSES = ["OPEN", "RESOLVED", "IGNORED"];

const selectStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: "0.8rem",
  background: "#fff",
};

export default function IssueFilters({
  current,
  pageUrls,
}: {
  current: Record<string, string | undefined>;
  pageUrls: string[];
}) {
  function update(key: string, value: string) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(current)) {
      if (v) params.set(k, v);
    }
    if (value) params.set(key, value);
    else params.delete(key);
    window.location.search = params.toString();
  }

  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
        marginBottom: "1rem",
        alignItems: "center",
      }}
    >
      <select
        style={selectStyle}
        value={current.status ?? "OPEN"}
        onChange={(e) => update("status", e.target.value)}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        style={selectStyle}
        value={current.severity ?? ""}
        onChange={(e) => update("severity", e.target.value)}
      >
        <option value="">All severities</option>
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        style={selectStyle}
        value={current.category ?? ""}
        onChange={(e) => update("category", e.target.value)}
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      <select
        style={{ ...selectStyle, maxWidth: 320 }}
        value={current.pageUrl ?? ""}
        onChange={(e) => update("pageUrl", e.target.value)}
      >
        <option value="">All pages</option>
        {pageUrls.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </div>
  );
}
