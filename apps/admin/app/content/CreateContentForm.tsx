"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const CHANNELS = ["BLOG", "INSTAGRAM", "FACEBOOK", "LINKEDIN", "X"];

export default function CreateContentForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [instruction, setInstruction] = useState("");
  const [channels, setChannels] = useState<string[]>(["BLOG"]);
  const [state, setState] = useState<"idle" | "loading" | "fail">("idle");

  function toggleChannel(c: string) {
    setChannels((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  async function submit() {
    if (!topic.trim() || channels.length === 0) return;
    setState("loading");
    try {
      const res = await fetch(`${API}/content/briefs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          instruction: instruction.trim() || undefined,
          channels,
        }),
      });
      if (!res.ok) {
        setState("fail");
        return;
      }
      setTopic("");
      setInstruction("");
      setOpen(false);
      setState("idle");
      router.refresh();
    } catch {
      setState("fail");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: "0.4rem 0.9rem",
          borderRadius: 6,
          border: "1px solid #1a1a1a",
          background: "#1a1a1a",
          color: "#fff",
          fontSize: "0.8rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Create content
      </button>
    );
  }

  return (
    <div
      style={{
        padding: "1rem 1.1rem",
        background: "#fff",
        border: "1px solid #e0e0dc",
        borderRadius: 8,
        marginBottom: "1rem",
        maxWidth: 560,
      }}
    >
      <div
        style={{
          fontSize: "0.7rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#888",
          marginBottom: "0.6rem",
        }}
      >
        Create content
      </div>
      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Topic (required)"
        style={{
          width: "100%",
          padding: "0.45rem 0.6rem",
          borderRadius: 6,
          border: "1px solid #d0d0d0",
          fontSize: "0.85rem",
          marginBottom: "0.5rem",
        }}
      />
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Optional instruction / angle"
        rows={2}
        style={{
          width: "100%",
          padding: "0.45rem 0.6rem",
          borderRadius: 6,
          border: "1px solid #d0d0d0",
          fontSize: "0.85rem",
          marginBottom: "0.5rem",
          fontFamily: "inherit",
        }}
      />
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          flexWrap: "wrap",
          marginBottom: "0.7rem",
        }}
      >
        {CHANNELS.map((c) => (
          <label
            key={c}
            style={{
              fontSize: "0.75rem",
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={channels.includes(c)}
              onChange={() => toggleChannel(c)}
            />
            {c}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button
          onClick={() => void submit()}
          disabled={state === "loading" || !topic.trim()}
          style={{
            padding: "0.35rem 0.85rem",
            borderRadius: 6,
            border: "1px solid #1a1a1a",
            background: "#1a1a1a",
            color: "#fff",
            fontSize: "0.78rem",
            fontWeight: 600,
            cursor: state === "loading" ? "wait" : "pointer",
          }}
        >
          {state === "loading"
            ? "Creating…"
            : "Create briefs & generate drafts"}
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{
            padding: "0.35rem 0.85rem",
            borderRadius: 6,
            border: "1px solid #d0d0d0",
            background: "#fff",
            fontSize: "0.78rem",
            cursor: "pointer",
            color: "#555",
          }}
        >
          Cancel
        </button>
        {state === "fail" && (
          <span style={{ fontSize: "0.75rem", color: "#a02a2a" }}>
            Failed — is the backend running?
          </span>
        )}
      </div>
    </div>
  );
}
