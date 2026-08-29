"use client";

import { useEffect, useState } from "react";
import { card, PageHeader, sectionLabel } from "../../components/ui";
import WebsiteTabs from "../WebsiteTabs";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const CATEGORIES = [
  "PERFORMANCE",
  "SEO",
  "ACCESSIBILITY",
  "BEST_PRACTICE",
  "CONVERSION",
  "CONTENT",
  "MOBILE",
  "TRUST",
  "PRODUCT_PAGE",
  "CHECKOUT",
  "TECHNICAL",
] as const;

const PAGE_TYPES = [
  "HOMEPAGE",
  "PRODUCT",
  "COLLECTION",
  "BLOG",
  "BLOG_POST",
  "CART",
  "CHECKOUT",
  "LANDING",
  "POLICY",
  "CONTACT",
  "OTHER",
] as const;

interface AuditUrl {
  url: string;
  pageType: string;
  label?: string;
}

interface WebsiteSettings {
  websiteUrl: string | null;
  auditUrls: AuditUrl[];
  enabledCategories: string[];
  cadence: "MANUAL" | "DAILY" | "WEEKLY";
  maxPages: number;
  formFactor: "MOBILE" | "DESKTOP";
  croReviewEnabled: boolean;
  auditTimeoutMs: number;
}

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  marginBottom: "0.9rem",
};
const labelStyle: React.CSSProperties = {
  fontSize: "0.8rem",
  fontWeight: 700,
  color: "#222",
};
const helpStyle: React.CSSProperties = {
  fontSize: "0.72rem",
  color: "#666",
  lineHeight: 1.35,
};
const inputStyle: React.CSSProperties = {
  padding: "0.45rem 0.6rem",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: "0.85rem",
  maxWidth: 420,
};

export default function WebsiteSettingsPage() {
  const [settings, setSettings] = useState<WebsiteSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API}/website/settings`)
      .then((r) => r.json())
      .then(setSettings)
      .catch((e) => setError(`Failed to load settings: ${e.message}`));
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(`${API}/website/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          // An empty string is "unset", not an invalid URL.
          websiteUrl: settings.websiteUrl?.trim() || null,
          auditUrls: settings.auditUrls.filter((u) => u.url.trim()),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(
          body?.details
            ? JSON.stringify(body.details.fieldErrors ?? body.details)
            : (body?.message ?? "Save failed"),
        );
      }
      setSettings(body);
      setStatus("Saved.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function patch(update: Partial<WebsiteSettings>) {
    setSettings((s) => (s ? { ...s, ...update } : s));
  }

  if (error && !settings) {
    return (
      <>
        <PageHeader title="Website — Settings" />
        <WebsiteTabs active="settings" />
        <p style={{ color: "#a02a2a" }}>{error}</p>
      </>
    );
  }
  if (!settings) {
    return (
      <>
        <PageHeader title="Website — Settings" />
        <WebsiteTabs active="settings" />
        <p style={{ color: "#888" }}>Loading…</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Website — Settings"
        subtitle="Business configuration lives here, not in environment variables."
      />
      <WebsiteTabs active="settings" />

      <div style={{ ...card, maxWidth: 720 }}>
        <div style={sectionLabel}>Site</div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Website URL</label>
          <span style={helpStyle}>
            The site root. Works for any platform — no Shopify assumption.
          </span>
          <input
            style={inputStyle}
            value={settings.websiteUrl ?? ""}
            placeholder="https://example.com"
            onChange={(e) => patch({ websiteUrl: e.target.value })}
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Audit URLs</label>
          <span style={helpStyle}>
            The specific pages to audit. Include your important product,
            collection and blog pages — scores are only as representative as the
            pages you list.
          </span>
          {settings.auditUrls.map((entry, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: "0.4rem", marginTop: "0.3rem" }}
            >
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={entry.url}
                placeholder="https://example.com/products/serum"
                onChange={(e) => {
                  const next = [...settings.auditUrls];
                  next[i] = { ...entry, url: e.target.value };
                  patch({ auditUrls: next });
                }}
              />
              <select
                style={{ ...inputStyle, maxWidth: 160 }}
                value={entry.pageType}
                onChange={(e) => {
                  const next = [...settings.auditUrls];
                  next[i] = { ...entry, pageType: e.target.value };
                  patch({ auditUrls: next });
                }}
              >
                {PAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  patch({
                    auditUrls: settings.auditUrls.filter((_, j) => j !== i),
                  })
                }
                style={{
                  padding: "0.35rem 0.6rem",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              patch({
                auditUrls: [
                  ...settings.auditUrls,
                  { url: "", pageType: "OTHER" },
                ],
              })
            }
            style={{
              marginTop: "0.4rem",
              padding: "0.35rem 0.7rem",
              borderRadius: 6,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
              fontSize: "0.8rem",
              alignSelf: "flex-start",
            }}
          >
            + Add URL
          </button>
        </div>

        <div style={sectionLabel}>Audit</div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Cadence</label>
          <span style={helpStyle}>
            MANUAL runs only when you click Run audit.
          </span>
          <select
            style={inputStyle}
            value={settings.cadence}
            onChange={(e) => patch({ cadence: e.target.value as any })}
          >
            <option value="MANUAL">Manual</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Max pages per audit</label>
          <span style={helpStyle}>
            Each page is a full Lighthouse run, so this bounds audit duration.
          </span>
          <input
            style={inputStyle}
            type="number"
            min={1}
            max={50}
            value={settings.maxPages}
            onChange={(e) => patch({ maxPages: Number(e.target.value) })}
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Form factor</label>
          <span style={helpStyle}>
            Mobile is the default because it is what Google indexes.
          </span>
          <select
            style={inputStyle}
            value={settings.formFactor}
            onChange={(e) => patch({ formFactor: e.target.value as any })}
          >
            <option value="MOBILE">Mobile</option>
            <option value="DESKTOP">Desktop</option>
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Per-page timeout (ms)</label>
          <input
            style={inputStyle}
            type="number"
            min={10000}
            max={600000}
            step={5000}
            value={settings.auditTimeoutMs}
            onChange={(e) => patch({ auditTimeoutMs: Number(e.target.value) })}
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={settings.croReviewEnabled}
              onChange={(e) => patch({ croReviewEnabled: e.target.checked })}
              style={{ marginRight: "0.4rem" }}
            />
            Enable AI conversion review
          </label>
          <span style={helpStyle}>
            Reads page content and produces qualitative observations. These are
            interpretations, never measurements, and are labelled as such
            everywhere they appear.
          </span>
        </div>

        <div style={sectionLabel}>Enabled finding categories</div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            marginBottom: "1rem",
          }}
        >
          {CATEGORIES.map((c) => (
            <label
              key={c}
              style={{
                fontSize: "0.76rem",
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.2rem 0.5rem",
                border: "1px solid #e5e5e5",
                borderRadius: 6,
              }}
            >
              <input
                type="checkbox"
                checked={settings.enabledCategories.includes(c)}
                onChange={(e) =>
                  patch({
                    enabledCategories: e.target.checked
                      ? [...settings.enabledCategories, c]
                      : settings.enabledCategories.filter((x) => x !== c),
                  })
                }
              />
              {c.replace(/_/g, " ")}
            </label>
          ))}
        </div>

        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: 6,
            border: "none",
            background: saving ? "#999" : "#1a1a1a",
            color: "#fff",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save settings"}
        </button>

        {status && (
          <p style={{ color: "#1a7a3d", fontSize: "0.8rem", marginTop: "0.5rem" }}>
            {status}
          </p>
        )}
        {error && (
          <p style={{ color: "#a02a2a", fontSize: "0.8rem", marginTop: "0.5rem" }}>
            {error}
          </p>
        )}
      </div>
    </>
  );
}
