"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function GenerateButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`${API}/website/recommendations/generate`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? "Generation failed");
      setNote(
        body.reason
          ? `No recommendations generated: ${body.reason}`
          : `Generated ${body.created} recommendation(s)${body.skipped ? `, dropped ${body.skipped} ungrounded` : ""}.`,
      );
      router.refresh();
    } catch (err: any) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ textAlign: "right" }}>
      <button
        onClick={generate}
        disabled={busy}
        style={{
          padding: "0.45rem 0.9rem",
          borderRadius: 6,
          border: "none",
          background: busy ? "#999" : "#1a1a1a",
          color: "#fff",
          fontSize: "0.82rem",
          fontWeight: 600,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "Analysing…" : "Generate recommendations"}
      </button>
      {note && (
        <p style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.3rem" }}>
          {note}
        </p>
      )}
    </div>
  );
}
