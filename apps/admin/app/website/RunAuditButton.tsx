"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function RunAuditButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${API}/website/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "admin_ui" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? "Audit failed");
      if (body.status === "FAILED") {
        setError(body.failureReason ?? "Audit failed");
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ textAlign: "right" }}>
      <button
        onClick={run}
        disabled={running || disabled}
        style={{
          padding: "0.45rem 0.9rem",
          borderRadius: 6,
          border: "none",
          background: running || disabled ? "#999" : "#1a1a1a",
          color: "#fff",
          fontSize: "0.82rem",
          fontWeight: 600,
          cursor: running || disabled ? "default" : "pointer",
        }}
      >
        {running ? "Auditing…" : "Run audit"}
      </button>
      {error && (
        <p style={{ color: "#a02a2a", fontSize: "0.75rem", marginTop: "0.3rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
