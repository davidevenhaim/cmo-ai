"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const btn: React.CSSProperties = {
  padding: "0.2rem 0.5rem",
  borderRadius: 5,
  border: "1px solid #d0d0d0",
  background: "#fff",
  fontSize: "0.68rem",
  fontWeight: 600,
  cursor: "pointer",
  color: "#444",
};

// Schedule / reschedule / cancel a publish request. Execution still goes
// through the approval + safety-check flow — these buttons never publish.
export default function RequestActions({
  publishRequestId,
  status,
  scheduledAt,
}: {
  publishRequestId: string;
  status: string;
  scheduledAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const schedulable = ["PENDING", "APPROVED"].includes(status);
  const cancellable = ["PENDING", "APPROVED"].includes(status);

  async function call(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.message ?? `HTTP ${res.status}`);
      } else {
        router.refresh();
      }
    } catch {
      setError("Backend unreachable");
    } finally {
      setBusy(false);
    }
  }

  function reschedule() {
    const suggestion = scheduledAt
      ? new Date(scheduledAt).toISOString().slice(0, 16)
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
    const input = window.prompt(
      "Publish at (local time, YYYY-MM-DDTHH:MM):",
      suggestion,
    );
    if (!input) return;
    const date = new Date(input);
    if (isNaN(date.getTime())) {
      setError("Invalid date");
      return;
    }
    void call(`/publishing/requests/${publishRequestId}/schedule`, "PATCH", {
      scheduledAt: date.toISOString(),
    });
  }

  function cancel() {
    if (!window.confirm("Cancel this publish request?")) return;
    void call(`/publishing/requests/${publishRequestId}/cancel`, "POST");
  }

  if (!schedulable && !cancellable) return null;

  return (
    <span
      style={{
        display: "inline-flex",
        gap: "0.3rem",
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      {schedulable && (
        <button style={btn} disabled={busy} onClick={reschedule}>
          {scheduledAt ? "Reschedule" : "Schedule"}
        </button>
      )}
      {cancellable && (
        <button
          style={{ ...btn, color: "#a02a2a", borderColor: "#e0b0b0" }}
          disabled={busy}
          onClick={cancel}
        >
          Cancel
        </button>
      )}
      {error && (
        <span style={{ fontSize: "0.68rem", color: "#a02a2a" }}>{error}</span>
      )}
    </span>
  );
}
