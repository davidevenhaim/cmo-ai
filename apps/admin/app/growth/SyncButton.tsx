"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function SyncButton() {
  const [state, setState] = useState<"idle" | "syncing" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function handleSync() {
    setState("syncing");
    setMessage("");
    try {
      const res = await fetch(`${API}/growth/sync`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const s = data.status ?? "COMPLETED";
      setState(s === "FAILED" ? "error" : "done");
      setMessage(
        s === "COMPLETED"
          ? `Synced — ${data.contactsCreated ?? 0} contacts created, ${data.checkoutsCreated ?? 0} checkouts ingested`
          : s === "PARTIAL"
            ? `Partial sync — some steps failed`
            : `Sync failed`,
      );
    } catch (e: unknown) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Unknown error");
    }
  }

  const btnStyle: React.CSSProperties = {
    padding: "0.4rem 1rem",
    borderRadius: 6,
    border: "none",
    cursor: state === "syncing" ? "wait" : "pointer",
    fontSize: "0.8rem",
    fontWeight: 600,
    background:
      state === "error" ? "#c44" : state === "done" ? "#2a7" : "#1877f2",
    color: "#fff",
    opacity: state === "syncing" ? 0.7 : 1,
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <button
        style={btnStyle}
        onClick={handleSync}
        disabled={state === "syncing"}
      >
        {state === "syncing" ? "Syncing…" : "Sync Shopify"}
      </button>
      {message && (
        <span
          style={{
            fontSize: "0.78rem",
            color: state === "error" ? "#c44" : "#555",
          }}
        >
          {message}
        </span>
      )}
    </div>
  );
}
