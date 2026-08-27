"use client";

import { useState } from "react";
import { StatusBadge } from "./ui";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface CommandResult {
  intent: string | null;
  classification: string | null;
  status: string;
  summary: string;
  data: unknown;
  deepLink: string | null;
}

export default function CommandBar() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<CommandResult | null>(
    null,
  );

  async function send(body: Record<string, unknown>) {
    setLoading(true);
    setPendingConfirm(null);
    try {
      const res = await fetch(`${API}/operator/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as CommandResult;
      setResult(json);
      if (json.status === "CONFIRMATION_REQUIRED") setPendingConfirm(json);
    } catch {
      setResult({
        intent: null,
        classification: null,
        status: "ERROR",
        summary: "Backend unreachable.",
        data: null,
        deepLink: null,
      });
    } finally {
      setLoading(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || loading) return;
    void send({ text: text.trim() });
  }

  function confirm() {
    if (!pendingConfirm?.intent) return;
    void send({
      intent: pendingConfirm.intent,
      params: (pendingConfirm.data as Record<string, unknown>) ?? {},
      confirm: true,
    });
  }

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <form onSubmit={submit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Ask the CMO — e.g. "show abandoned checkouts", "create content about linen care"'
          style={{
            flex: 1,
            padding: "0.55rem 0.85rem",
            borderRadius: 8,
            border: "1px solid #d5d5d5",
            fontSize: "0.85rem",
            background: "#fff",
          }}
        />
        <button
          type="submit"
          disabled={loading || !text.trim()}
          style={{
            padding: "0.55rem 1.1rem",
            borderRadius: 8,
            border: "1px solid #1a1a1a",
            background: loading ? "#666" : "#1a1a1a",
            color: "#fff",
            fontSize: "0.82rem",
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Working…" : "Send"}
        </button>
      </form>

      {result && (
        <div
          style={{
            marginTop: "0.6rem",
            padding: "0.75rem 1rem",
            background: "#fff",
            border: "1px solid #e5e5e5",
            borderRadius: 8,
            fontSize: "0.83rem",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "0.6rem",
              alignItems: "center",
              marginBottom: "0.35rem",
              flexWrap: "wrap",
            }}
          >
            <StatusBadge status={result.status} />
            {result.intent && (
              <span style={{ color: "#888", fontSize: "0.72rem" }}>
                {result.intent}
                {result.classification ? ` · ${result.classification}` : ""}
              </span>
            )}
          </div>
          <p style={{ color: "#333" }}>{result.summary}</p>
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              marginTop: "0.5rem",
              alignItems: "center",
            }}
          >
            {pendingConfirm && (
              <button
                onClick={confirm}
                disabled={loading}
                style={{
                  padding: "0.35rem 0.9rem",
                  borderRadius: 6,
                  border: "1px solid #8a6d1a",
                  background: "#fdf3d7",
                  color: "#8a6d1a",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Confirm
              </button>
            )}
            {result.deepLink && (
              <a
                href={result.deepLink}
                style={{
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  color: "#2a5aa0",
                }}
              >
                Open {result.deepLink} →
              </a>
            )}
            <button
              onClick={() => {
                setResult(null);
                setPendingConfirm(null);
              }}
              style={{
                marginLeft: "auto",
                border: "none",
                background: "none",
                color: "#aaa",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
