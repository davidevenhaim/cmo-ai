"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function CreateContentButton({
  topic,
  opportunityId,
}: {
  topic: string;
  opportunityId?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "fail">(
    "idle",
  );

  async function create() {
    setState("loading");
    try {
      const res = await fetch(`${API}/content/briefs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, opportunityId }),
      });
      setState(res.ok ? "done" : "fail");
    } catch {
      setState("fail");
    }
  }

  if (state === "done") {
    return (
      <a
        href="/content"
        style={{ fontSize: "0.72rem", fontWeight: 600, color: "#1a7a3d" }}
      >
        Brief created — open Content →
      </a>
    );
  }

  return (
    <button
      onClick={() => void create()}
      disabled={state === "loading"}
      style={{
        padding: "0.25rem 0.6rem",
        borderRadius: 6,
        border: "1px solid #d0d0d0",
        background: "#f7f7f5",
        fontSize: "0.72rem",
        fontWeight: 600,
        cursor: state === "loading" ? "wait" : "pointer",
        color: state === "fail" ? "#a02a2a" : "#444",
        whiteSpace: "nowrap",
      }}
    >
      {state === "loading"
        ? "Creating…"
        : state === "fail"
          ? "Failed — retry"
          : "Create content"}
    </button>
  );
}
