import React from "react";

export const card: React.CSSProperties = {
  padding: "1.25rem",
  background: "#fff",
  borderRadius: 8,
  border: "1px solid #e5e5e5",
};

export const sectionLabel: React.CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#888",
  marginBottom: "0.6rem",
  textTransform: "uppercase",
};

export const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.82rem",
};

export const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.45rem 0.6rem",
  borderBottom: "1px solid #e5e5e5",
  color: "#888",
  fontSize: "0.72rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  fontWeight: 600,
};

export const td: React.CSSProperties = {
  padding: "0.5rem 0.6rem",
  borderBottom: "1px solid #f0f0f0",
  verticalAlign: "top",
};

const BADGE_COLORS: Record<string, { bg: string; fg: string }> = {
  // healthy
  AVAILABLE: { bg: "#e6f6ec", fg: "#1a7a3d" },
  CONNECTED: { bg: "#e6f6ec", fg: "#1a7a3d" },
  LIVE: { bg: "#e6f6ec", fg: "#1a7a3d" },
  PUBLISHED: { bg: "#e6f6ec", fg: "#1a7a3d" },
  SUCCEEDED: { bg: "#e6f6ec", fg: "#1a7a3d" },
  APPROVED: { bg: "#e6f6ec", fg: "#1a7a3d" },
  RECOVERED: { bg: "#e6f6ec", fg: "#1a7a3d" },
  OK: { bg: "#e6f6ec", fg: "#1a7a3d" },
  ACTIVE: { bg: "#e6f6ec", fg: "#1a7a3d" },
  // caution / in-flight
  STALE: { bg: "#fdf3d7", fg: "#8a6d1a" },
  PENDING: { bg: "#fdf3d7", fg: "#8a6d1a" },
  PENDING_REVIEW: { bg: "#fdf3d7", fg: "#8a6d1a" },
  AWAITING_REVIEW: { bg: "#fdf3d7", fg: "#8a6d1a" },
  UNKNOWN: { bg: "#fdf3d7", fg: "#8a6d1a" },
  EXECUTING: { bg: "#fdf3d7", fg: "#8a6d1a" },
  IN_JOURNEY: { bg: "#fdf3d7", fg: "#8a6d1a" },
  CONFIRMATION_REQUIRED: { bg: "#fdf3d7", fg: "#8a6d1a" },
  CLARIFICATION_NEEDED: { bg: "#fdf3d7", fg: "#8a6d1a" },
  // neutral / new
  DRAFT: { bg: "#e8f0fb", fg: "#2a5aa0" },
  GENERATED: { bg: "#e8f0fb", fg: "#2a5aa0" },
  SCHEDULED: { bg: "#e8f0fb", fg: "#2a5aa0" },
  NEW: { bg: "#e8f0fb", fg: "#2a5aa0" },
  // mock must never look live
  MOCK: { bg: "#f0e8fb", fg: "#6a3aa0" },
  // off / missing
  NOT_CONFIGURED: { bg: "#efefef", fg: "#777" },
  UNSUPPORTED: { bg: "#efefef", fg: "#777" },
  // failure
  ERROR: { bg: "#fbe8e8", fg: "#a02a2a" },
  FAILED: { bg: "#fbe8e8", fg: "#a02a2a" },
  UNAVAILABLE: { bg: "#fbe8e8", fg: "#a02a2a" },
  REJECTED: { bg: "#fbe8e8", fg: "#a02a2a" },
  SUPPRESSED: { bg: "#fbe8e8", fg: "#a02a2a" },
  EXPIRED: { bg: "#efefef", fg: "#777" },
  STOPPED: { bg: "#efefef", fg: "#777" },
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const c = BADGE_COLORS[status] ?? { bg: "#efefef", fg: "#555" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.1rem 0.5rem",
        borderRadius: 999,
        fontSize: "0.68rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        background: c.bg,
        color: c.fg,
        whiteSpace: "nowrap",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  sub,
  status,
}: {
  label: string;
  value: string;
  sub?: string | null;
  status?: string | null;
}) {
  return (
    <div style={{ ...card, padding: "0.9rem 1.1rem", minWidth: 150, flex: 1 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.5rem",
          alignItems: "baseline",
        }}
      >
        <div style={{ ...sectionLabel, marginBottom: "0.35rem" }}>{label}</div>
        {status && <StatusBadge status={status} />}
      </div>
      <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>{value}</div>
      {sub && (
        <div
          style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.2rem" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  message,
  hint,
}: {
  message: string;
  hint?: string;
}) {
  return (
    <div style={{ ...card, background: "#fcfcfa", color: "#777" }}>
      <p style={{ fontSize: "0.85rem" }}>{message}</p>
      {hint && (
        <p style={{ fontSize: "0.78rem", marginTop: "0.4rem", color: "#999" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        ...card,
        background: "#fbe8e8",
        border: "1px solid #f0c0c0",
        color: "#7a2020",
      }}
    >
      <p style={{ fontSize: "0.85rem" }}>{message}</p>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        marginBottom: "1.25rem",
        gap: "1rem",
        flexWrap: "wrap",
      }}
    >
      <div>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 700 }}>{title}</h1>
        {subtitle && (
          <p
            style={{ color: "#888", fontSize: "0.82rem", marginTop: "0.2rem" }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

export function fmtMoney(
  value: number | null | undefined,
  currency?: string | null,
): string {
  if (value == null) return "—";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}${
    currency ? ` ${currency}` : ""
  }`;
}

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
