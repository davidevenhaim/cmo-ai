"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Safe read-only health checks only — no mutations.
const TEST_ENDPOINTS: Record<string, string> = {
  shopify: "/shopify/status",
  wordpress: "/wordpress/health",
  postiz: "/social/health",
};

export default function TestConnectionButton({
  providerKey,
}: {
  providerKey: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "fail">(
    "idle",
  );
  const [detail, setDetail] = useState<string | null>(null);
  const endpoint = TEST_ENDPOINTS[providerKey];
  if (!endpoint) return null;

  async function test() {
    setState("loading");
    setDetail(null);
    try {
      const res = await fetch(`${API}${endpoint}`);
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setState("ok");
        setDetail(
          json && typeof json === "object"
            ? JSON.stringify(json).slice(0, 200)
            : null,
        );
      } else {
        setState("fail");
        setDetail(`HTTP ${res.status}`);
      }
    } catch {
      setState("fail");
      setDetail("Backend unreachable");
    }
  }

  return (
    <div style={{ marginTop: "0.6rem" }}>
      <button
        onClick={() => void test()}
        disabled={state === "loading"}
        style={{
          padding: "0.3rem 0.75rem",
          borderRadius: 6,
          border: "1px solid #d0d0d0",
          background: "#f7f7f5",
          fontSize: "0.75rem",
          fontWeight: 600,
          cursor: state === "loading" ? "wait" : "pointer",
          color: "#444",
        }}
      >
        {state === "loading" ? "Testing…" : "Test connection"}
      </button>
      {state === "ok" && (
        <span
          style={{
            marginLeft: "0.6rem",
            fontSize: "0.75rem",
            color: "#1a7a3d",
          }}
        >
          Reachable
        </span>
      )}
      {state === "fail" && (
        <span
          style={{
            marginLeft: "0.6rem",
            fontSize: "0.75rem",
            color: "#a02a2a",
          }}
        >
          Failed{detail ? ` — ${detail}` : ""}
        </span>
      )}
    </div>
  );
}
