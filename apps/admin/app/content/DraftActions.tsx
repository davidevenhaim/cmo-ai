"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

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

export default function DraftActions({
  draftId,
  briefId,
  approvalId,
  status,
  channel,
  hasOpenPublishRequest,
}: {
  draftId: string;
  briefId: string;
  approvalId: string | null;
  status: string;
  channel: string;
  hasOpenPublishRequest: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(
    key: string,
    path: string,
    method: string,
    body?: unknown,
  ) {
    setBusy(key);
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
      setBusy(null);
    }
  }

  function regenerate() {
    const feedback = window.prompt(
      "Optional revision feedback for the next version (leave empty for none):",
    );
    if (feedback === null) return;
    void call("regenerate", `/content/briefs/${briefId}/generate`, "POST", {
      revisionFeedback: feedback.trim() || undefined,
    });
  }

  function createPublishRequest() {
    const isBlog = channel === "BLOG";
    void call("publish", "/publishing/requests", "POST", {
      contentDraftId: draftId,
      provider: isBlog ? "wordpress" : "postiz",
      destination: isBlog
        ? "wordpress:primary"
        : `postiz:${channel.toLowerCase()}`,
    });
  }

  return (
    <div
      style={{
        display: "flex",
        gap: "0.4rem",
        flexWrap: "wrap",
        alignItems: "center",
        marginTop: "0.6rem",
      }}
    >
      {status === "PENDING_REVIEW" && approvalId && (
        <>
          <button
            style={{ ...btn, borderColor: "#1a7a3d", color: "#1a7a3d" }}
            disabled={busy !== null}
            onClick={() =>
              void call(
                "approve",
                `/approvals/${approvalId}/resolve`,
                "PATCH",
                {
                  status: "APPROVED",
                },
              )
            }
          >
            {busy === "approve" ? "Approving…" : "Approve"}
          </button>
          <button
            style={{ ...btn, borderColor: "#a02a2a", color: "#a02a2a" }}
            disabled={busy !== null}
            onClick={() =>
              void call("reject", `/approvals/${approvalId}/resolve`, "PATCH", {
                status: "REJECTED",
              })
            }
          >
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
        </>
      )}
      {["GENERATED", "PENDING_REVIEW", "REJECTED"].includes(status) && (
        <button style={btn} disabled={busy !== null} onClick={regenerate}>
          {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
        </button>
      )}
      {status === "APPROVED" && !hasOpenPublishRequest && (
        <button
          style={btn}
          disabled={busy !== null}
          onClick={createPublishRequest}
        >
          {busy === "publish" ? "Creating…" : "Create publish request"}
        </button>
      )}
      <button
        style={{ ...btn, color: "#aaa", cursor: "not-allowed" }}
        disabled
        title="No creative provider is configured. Weave/HeyGen integration is a later milestone — no fake images are generated."
      >
        Generate creative — not configured
      </button>
      {error && (
        <span style={{ fontSize: "0.72rem", color: "#a02a2a" }}>{error}</span>
      )}
    </div>
  );
}
