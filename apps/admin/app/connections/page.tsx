import { fetchJson } from "../lib/api";
import {
  card,
  StatusBadge,
  ErrorState,
  PageHeader,
  fmtDate,
} from "../components/ui";
import TestConnectionButton from "./TestConnectionButton";

export const dynamic = "force-dynamic";

interface Status {
  generatedAt: string;
  connections: Array<{
    key: string;
    name: string;
    health: string;
    detail: string | null;
    lastSuccessAt: string | null;
    configRequirements: string[];
    testable: boolean;
  }>;
}

export default async function ConnectionsPage() {
  const status = await fetchJson<Status>("/operator/status");

  if (!status) {
    return (
      <ErrorState message="Backend unreachable — cannot read connection status." />
    );
  }

  return (
    <div>
      <PageHeader
        title="Connections"
        subtitle="Provider truth: MOCK never looks live, missing credentials show as NOT CONFIGURED, errors are never hidden."
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "0.75rem",
        }}
      >
        {status.connections.map((c) => (
          <div key={c.key} style={{ ...card, padding: "1rem 1.1rem" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.4rem",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                {c.name}
              </span>
              <StatusBadge status={c.health} />
            </div>
            {c.detail && (
              <p style={{ fontSize: "0.8rem", color: "#555" }}>{c.detail}</p>
            )}
            <div
              style={{
                marginTop: "0.5rem",
                fontSize: "0.72rem",
                color: "#999",
                display: "flex",
                flexDirection: "column",
                gap: "0.2rem",
              }}
            >
              {c.lastSuccessAt && (
                <span>Last success: {fmtDate(c.lastSuccessAt)}</span>
              )}
              {c.configRequirements.length > 0 && (
                <span>
                  Config: <code>{c.configRequirements.join(", ")}</code>
                </span>
              )}
            </div>
            {c.testable && <TestConnectionButton providerKey={c.key} />}
          </div>
        ))}
      </div>
    </div>
  );
}
