"use client";

import { useEffect, useState } from "react";
import {
  card,
  EmptyState,
  fmtDate,
  PageHeader,
  sectionLabel,
  StatusBadge,
  tableStyle,
  td,
  th,
} from "../../components/ui";
import WhatsAppTabs from "../WhatsAppTabs";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Audience {
  total: number;
  eligible: number;
  noConsent: number;
  frequencyCapped: number;
  invalidPhone: number;
  suppressed: number;
  expectedSends: number;
}

interface Broadcast {
  id: string;
  name: string;
  status: string;
  templateId: string | null;
  template: { id: string; name: string; key: string } | null;
  renderedBody: string | null;
  dryRunResult: Audience | null;
  dryRunAt: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  createdAt: string;
}

interface Template {
  id: string;
  name: string;
  key: string;
}

const btn: React.CSSProperties = {
  padding: "0.35rem 0.75rem",
  borderRadius: 6,
  border: "1px solid #ccc",
  background: "#fff",
  fontSize: "0.78rem",
  fontWeight: 600,
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  ...btn,
  background: "#1a1a1a",
  color: "#fff",
  border: "none",
};

export default function BroadcastsPage() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const [b, t] = await Promise.all([
        fetch(`${API}/whatsapp/broadcasts`).then((r) => r.json()),
        fetch(`${API}/whatsapp/templates`).then((r) => r.json()),
      ]);
      setBroadcasts(b);
      setTemplates(t);
    } catch (e: any) {
      setError(e.message);
      setBroadcasts([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function call(path: string, init?: RequestInit, key = path) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`${API}${path}`, init);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? "Request failed");
      await load();
      return body;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!name.trim() || !templateId) return;
    await call("/whatsapp/broadcasts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, templateId }),
    });
    setName("");
    setTemplateId("");
  }

  return (
    <>
      <PageHeader
        title="WhatsApp — Broadcasts"
        subtitle="Every broadcast goes dry run → owner confirmation → live. Eligibility is re-checked per recipient at send time."
      />
      <WhatsAppTabs active="broadcasts" />

      {error && (
        <div style={{ ...card, background: "#fbe8e8", marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.82rem", color: "#7a2020" }}>{error}</p>
        </div>
      )}

      <div style={{ ...card, marginBottom: "1.25rem", maxWidth: 620 }}>
        <div style={sectionLabel}>New broadcast</div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Broadcast name"
            style={{
              flex: 1,
              minWidth: 200,
              padding: "0.45rem 0.6rem",
              border: "1px solid #ccc",
              borderRadius: 6,
              fontSize: "0.85rem",
            }}
          />
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            style={{
              padding: "0.45rem 0.6rem",
              border: "1px solid #ccc",
              borderRadius: 6,
              fontSize: "0.85rem",
            }}
          >
            <option value="">Select template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={create}
            disabled={!name.trim() || !templateId || busy !== null}
            style={{
              ...primaryBtn,
              background: !name.trim() || !templateId ? "#999" : "#1a1a1a",
            }}
          >
            Create
          </button>
        </div>
      </div>

      {broadcasts === null ? (
        <p style={{ color: "#888" }}>Loading…</p>
      ) : broadcasts.length === 0 ? (
        <EmptyState message="No broadcasts yet." />
      ) : (
        <div style={{ display: "grid", gap: "0.7rem" }}>
          {broadcasts.map((b) => (
            <div key={b.id} style={card}>
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
                <strong style={{ fontSize: "0.95rem" }}>{b.name}</strong>
                <StatusBadge status={b.status} />
              </div>

              {b.renderedBody && (
                <pre
                  style={{
                    background: "#f7f7f5",
                    padding: "0.6rem 0.75rem",
                    borderRadius: 6,
                    fontSize: "0.78rem",
                    whiteSpace: "pre-wrap",
                    marginBottom: "0.6rem",
                  }}
                >
                  {b.renderedBody}
                </pre>
              )}

              {b.dryRunResult && (
                <>
                  <div style={{ ...sectionLabel, marginBottom: "0.3rem" }}>
                    Dry run — {fmtDate(b.dryRunAt)}
                  </div>
                  <table style={{ ...tableStyle, marginBottom: "0.6rem" }}>
                    <thead>
                      <tr>
                        <th style={th}>Total</th>
                        <th style={th}>Eligible</th>
                        <th style={th}>No consent</th>
                        <th style={th}>Freq. capped</th>
                        <th style={th}>Invalid phone</th>
                        <th style={th}>Suppressed</th>
                        <th style={th}>Expected sends</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={td}>{b.dryRunResult.total}</td>
                        <td style={td}>{b.dryRunResult.eligible}</td>
                        <td style={td}>{b.dryRunResult.noConsent}</td>
                        <td style={td}>{b.dryRunResult.frequencyCapped}</td>
                        <td style={td}>{b.dryRunResult.invalidPhone}</td>
                        <td style={td}>{b.dryRunResult.suppressed}</td>
                        <td style={td}>
                          <strong>{b.dryRunResult.expectedSends}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}

              {b.status === "SENT" && (
                <p style={{ fontSize: "0.8rem", color: "#666" }}>
                  {b.sentCount} sent · {b.failedCount} failed ·{" "}
                  {b.suppressedCount} suppressed
                </p>
              )}

              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                  marginTop: "0.6rem",
                }}
              >
                {(b.status === "DRAFT" ||
                  b.status === "AWAITING_CONFIRMATION") && (
                  <button
                    style={btn}
                    disabled={busy !== null}
                    onClick={() =>
                      call(`/whatsapp/broadcasts/${b.id}/dry-run`, {
                        method: "POST",
                      })
                    }
                  >
                    Run dry run
                  </button>
                )}

                {b.status === "AWAITING_CONFIRMATION" && !b.confirmedAt && (
                  <button
                    style={btn}
                    disabled={busy !== null}
                    onClick={() =>
                      call(`/whatsapp/broadcasts/${b.id}/confirm`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ actor: "admin" }),
                      })
                    }
                  >
                    Confirm ({b.dryRunResult?.expectedSends ?? 0} sends)
                  </button>
                )}

                {b.status === "AWAITING_CONFIRMATION" && b.confirmedAt && (
                  <button
                    style={primaryBtn}
                    disabled={busy !== null}
                    onClick={() =>
                      call(`/whatsapp/broadcasts/${b.id}/send`, {
                        method: "POST",
                      })
                    }
                  >
                    Send live
                  </button>
                )}

                {b.status !== "SENT" &&
                  b.status !== "SENDING" &&
                  b.status !== "CANCELLED" && (
                    <button
                      style={btn}
                      disabled={busy !== null}
                      onClick={() =>
                        call(`/whatsapp/broadcasts/${b.id}/cancel`, {
                          method: "POST",
                        })
                      }
                    >
                      Cancel
                    </button>
                  )}
              </div>

              {b.confirmedAt && (
                <div
                  style={{
                    fontSize: "0.72rem",
                    color: "#999",
                    marginTop: "0.4rem",
                  }}
                >
                  Confirmed by {b.confirmedBy} at {fmtDate(b.confirmedAt)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
