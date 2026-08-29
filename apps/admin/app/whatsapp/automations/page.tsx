"use client";

import { useEffect, useState } from "react";
import {
  card,
  fmtDate,
  PageHeader,
  sectionLabel,
  StatusBadge,
} from "../../components/ui";
import WhatsAppTabs from "../WhatsAppTabs";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Automation {
  id: string;
  type: string;
  mode: "DISABLED" | "DRY_RUN" | "LIVE";
  channel: string;
  templateId: string | null;
  template: { id: string; name: string; key: string } | null;
  timing: Record<string, unknown>;
  audience: Record<string, unknown>;
  lastRunAt: string | null;
  successCount: number;
  failureCount: number;
}

interface Template {
  id: string;
  name: string;
  key: string;
  type: string;
}

const MODE_HELP: Record<string, string> = {
  DISABLED: "Nothing is sent. Steps are skipped and recorded.",
  DRY_RUN:
    "Every eligibility check runs and the message is composed, but nothing is dispatched.",
  LIVE: "Messages are sent when all safety gates pass.",
};

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const [a, t] = await Promise.all([
        fetch(`${API}/whatsapp/automations`).then((r) => r.json()),
        fetch(`${API}/whatsapp/templates`).then((r) => r.json()),
      ]);
      setAutomations(a);
      setTemplates(t);
    } catch (e: any) {
      setError(e.message);
      setAutomations([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function patch(type: string, body: Record<string, unknown>) {
    setBusy(type);
    setError(null);
    try {
      const res = await fetch(`${API}/whatsapp/automations/${type}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.message ?? "Update failed");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="WhatsApp — Automations"
        subtitle="Enabling an automation grants permission. It never bypasses consent, frequency caps, or the offer policy engine."
      />
      <WhatsAppTabs active="automations" />

      {error && (
        <div style={{ ...card, background: "#fbe8e8", marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.82rem", color: "#7a2020" }}>{error}</p>
        </div>
      )}

      {automations === null ? (
        <p style={{ color: "#888" }}>Loading…</p>
      ) : (
        <div style={{ display: "grid", gap: "0.7rem" }}>
          {automations.map((a) => (
            <div key={a.id} style={card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: "0.75rem",
                  marginBottom: "0.6rem",
                  flexWrap: "wrap",
                }}
              >
                <strong style={{ fontSize: "0.95rem" }}>
                  {a.type.replace(/_/g, " ")}
                </strong>
                <StatusBadge
                  status={
                    a.mode === "LIVE"
                      ? "LIVE"
                      : a.mode === "DRY_RUN"
                        ? "PENDING"
                        : "NOT_CONFIGURED"
                  }
                />
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "0.6rem",
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: "0.5rem",
                }}
              >
                <label style={{ fontSize: "0.78rem", fontWeight: 600 }}>
                  Mode
                </label>
                <select
                  value={a.mode}
                  disabled={busy === a.type}
                  onChange={(e) => patch(a.type, { mode: e.target.value })}
                  style={{
                    padding: "0.3rem 0.5rem",
                    border: "1px solid #ccc",
                    borderRadius: 6,
                    fontSize: "0.8rem",
                  }}
                >
                  <option value="DISABLED">Disabled</option>
                  <option value="DRY_RUN">Dry run</option>
                  <option value="LIVE">Live</option>
                </select>

                <label style={{ fontSize: "0.78rem", fontWeight: 600 }}>
                  Template
                </label>
                <select
                  value={a.templateId ?? ""}
                  disabled={busy === a.type}
                  onChange={(e) =>
                    patch(a.type, { templateId: e.target.value || null })
                  }
                  style={{
                    padding: "0.3rem 0.5rem",
                    border: "1px solid #ccc",
                    borderRadius: 6,
                    fontSize: "0.8rem",
                  }}
                >
                  <option value="">None</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <p style={{ fontSize: "0.76rem", color: "#666" }}>
                {MODE_HELP[a.mode]}
              </p>

              {a.type === "ABANDONED_CART" && (
                <p
                  style={{
                    fontSize: "0.74rem",
                    color: "#888",
                    marginTop: "0.3rem",
                  }}
                >
                  Timing for this flow comes from the recovery ladder in Settings
                  → Revenue, so there is one source of truth.
                </p>
              )}

              <div
                style={{ fontSize: "0.72rem", color: "#999", marginTop: "0.5rem" }}
              >
                {a.successCount} succeeded · {a.failureCount} failed · last run{" "}
                {fmtDate(a.lastRunAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
