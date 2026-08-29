"use client";

import { useEffect, useState } from "react";
import {
  card,
  EmptyState,
  PageHeader,
  sectionLabel,
  StatusBadge,
} from "../../components/ui";
import WhatsAppTabs from "../WhatsAppTabs";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const ALLOWED_VARIABLES = [
  "first_name",
  "cart_value",
  "currency",
  "product_names",
  "recovery_url",
  "discount_code",
  "discount_pct",
];

interface Template {
  id: string;
  key: string;
  type: string;
  name: string;
  body: string;
  variables: string[];
  active: boolean;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`${API}/whatsapp/templates`);
      setTemplates(await res.json());
    } catch (e: any) {
      setError(e.message);
      setTemplates([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(t: Template) {
    const body = editing[t.id] ?? t.body;
    setBusy(t.id);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`${API}/whatsapp/templates/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.message ?? "Save failed");
      setStatus(`Saved "${t.name}".`);
      setEditing((e) => {
        const next = { ...e };
        delete next[t.id];
        return next;
      });
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
        title="WhatsApp — Templates"
        subtitle="Variables are validated on save, so a broken template can never reach a customer."
      />
      <WhatsAppTabs active="templates" />

      <div style={{ ...card, marginBottom: "1.25rem" }}>
        <div style={sectionLabel}>Available variables</div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {ALLOWED_VARIABLES.map((v) => (
            <code
              key={v}
              style={{
                fontSize: "0.76rem",
                background: "#f2f2f0",
                padding: "0.15rem 0.45rem",
                borderRadius: 4,
              }}
            >
              {`{{${v}}}`}
            </code>
          ))}
        </div>
        <p style={{ fontSize: "0.74rem", color: "#666", marginTop: "0.5rem" }}>
          Anything else is rejected on save. At send time, a message whose
          variables cannot all be resolved is suppressed rather than sent with a
          gap.
        </p>
      </div>

      {error && (
        <div style={{ ...card, background: "#fbe8e8", marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.82rem", color: "#7a2020" }}>{error}</p>
        </div>
      )}
      {status && (
        <p
          style={{ color: "#1a7a3d", fontSize: "0.82rem", marginBottom: "1rem" }}
        >
          {status}
        </p>
      )}

      {templates === null ? (
        <p style={{ color: "#888" }}>Loading…</p>
      ) : templates.length === 0 ? (
        <EmptyState message="No templates yet." />
      ) : (
        <div style={{ display: "grid", gap: "0.7rem" }}>
          {templates.map((t) => {
            const value = editing[t.id] ?? t.body;
            const dirty = editing[t.id] !== undefined && editing[t.id] !== t.body;
            return (
              <div key={t.id} style={card}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "0.75rem",
                    marginBottom: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  <strong style={{ fontSize: "0.92rem" }}>{t.name}</strong>
                  <div style={{ display: "flex", gap: "0.35rem" }}>
                    <StatusBadge status={t.type} />
                    <StatusBadge status={t.active ? "ACTIVE" : "NOT_CONFIGURED"} />
                  </div>
                </div>

                <div
                  style={{ fontSize: "0.72rem", color: "#888", marginBottom: "0.4rem" }}
                >
                  key: <code>{t.key}</code>
                </div>

                <textarea
                  value={value}
                  onChange={(e) =>
                    setEditing((s) => ({ ...s, [t.id]: e.target.value }))
                  }
                  rows={5}
                  style={{
                    width: "100%",
                    padding: "0.55rem 0.7rem",
                    border: "1px solid #ccc",
                    borderRadius: 6,
                    fontSize: "0.83rem",
                    fontFamily: "ui-monospace, monospace",
                    marginBottom: "0.5rem",
                  }}
                />

                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    onClick={() => save(t)}
                    disabled={!dirty || busy === t.id}
                    style={{
                      padding: "0.35rem 0.8rem",
                      borderRadius: 6,
                      border: "none",
                      background: !dirty ? "#999" : "#1a1a1a",
                      color: "#fff",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      cursor: !dirty ? "default" : "pointer",
                    }}
                  >
                    {busy === t.id ? "Saving…" : "Save"}
                  </button>
                  <span style={{ fontSize: "0.72rem", color: "#888" }}>
                    Uses:{" "}
                    {t.variables.length > 0
                      ? t.variables.map((v) => `{{${v}}}`).join(", ")
                      : "no variables"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
