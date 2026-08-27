"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const REJECTION_REASONS = [
  "NOT_RELEVANT",
  "BAD_TIMING",
  "BRAND_MISMATCH",
  "TOO_EXPENSIVE",
  "TOO_RISKY",
  "ALREADY_PLANNED",
  "OTHER",
] as const;

const btn: React.CSSProperties = {
  padding: "0.28rem 0.7rem",
  borderRadius: 6,
  border: "1px solid #d0d0d0",
  background: "#f7f7f5",
  fontSize: "0.72rem",
  fontWeight: 600,
  cursor: "pointer",
  color: "#444",
};

export default function DecideActions({
  recommendationId,
}: {
  recommendationId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] =
    useState<(typeof REJECTION_REASONS)[number]>("NOT_RELEVANT");
  const [note, setNote] = useState("");

  async function decide(body: {
    status: "APPROVED" | "REJECTED";
    rejectionReason?: string;
    rejectionNote?: string;
  }) {
    setBusy(body.status);
    setError(null);
    try {
      const res = await fetch(
        `${API}/measurement/recommendations/${recommendationId}/decide`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.message ?? `HTTP ${res.status}`);
      } else {
        setRejecting(false);
        router.refresh();
      }
    } catch {
      setError("Backend unreachable");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ marginTop: "0.6rem" }}>
      <div
        style={{
          display: "flex",
          gap: "0.4rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button
          style={{ ...btn, borderColor: "#1a7a3d", color: "#1a7a3d" }}
          disabled={busy !== null}
          onClick={() => void decide({ status: "APPROVED" })}
        >
          {busy === "APPROVED" ? "Approving…" : "Approve"}
        </button>
        <button
          style={{ ...btn, borderColor: "#a02a2a", color: "#a02a2a" }}
          disabled={busy !== null}
          onClick={() => setRejecting((v) => !v)}
        >
          {rejecting ? "Cancel reject" : "Reject…"}
        </button>
        {error && (
          <span style={{ fontSize: "0.72rem", color: "#a02a2a" }}>{error}</span>
        )}
      </div>
      {rejecting && (
        <div
          style={{
            display: "flex",
            gap: "0.4rem",
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: "0.5rem",
          }}
        >
          <select
            value={reason}
            onChange={(e) =>
              setReason(e.target.value as (typeof REJECTION_REASONS)[number])
            }
            style={{ ...btn, cursor: "pointer" }}
          >
            {REJECTION_REASONS.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (helps the CMO learn)"
            maxLength={500}
            style={{ ...btn, cursor: "text", minWidth: 240 }}
          />
          <button
            style={{ ...btn, borderColor: "#a02a2a", color: "#a02a2a" }}
            disabled={busy !== null}
            onClick={() =>
              void decide({
                status: "REJECTED",
                rejectionReason: reason,
                rejectionNote: note.trim() || undefined,
              })
            }
          >
            {busy === "REJECTED" ? "Rejecting…" : "Confirm reject"}
          </button>
        </div>
      )}
    </div>
  );
}
