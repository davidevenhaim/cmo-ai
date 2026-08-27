"use client";

import { useEffect, useState } from "react";
import { card, PageHeader, StatusBadge } from "../components/ui";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface CommerceSettings {
  lowStockThreshold: number;
  defaultMetricsPeriodDays: number;
}

interface RevenuePolicy {
  maxDiscountPct: number;
  minContributionMarginPct: number;
  minOrderValue: number;
  maxDiscountsPerJourney: number;
  minHoursBeforeDiscount: number;
  recoveryLadderHours: number[];
  winBackDays: number;
  vipLtvThreshold: number;
  freeShippingNearFactor: number;
}

interface SettingsPayload {
  commerce: CommerceSettings;
  revenue: RevenuePolicy;
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
  maxWidth: 280,
};

export default function SettingsPage() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [commerce, setCommerce] = useState<CommerceSettings | null>(null);
  const [revenue, setRevenue] = useState<RevenuePolicy | null>(null);
  const [ladderText, setLadderText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API}/settings`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((payload: SettingsPayload) => {
        setData(payload);
        setCommerce(payload.commerce);
        setRevenue(payload.revenue);
        setLadderText(payload.revenue.recoveryLadderHours.join(", "));
      })
      .catch((e) => setError(`Failed to load settings: ${e.message}`));
  }, []);

  async function saveCommerce() {
    if (!commerce) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const r = await fetch(`${API}/settings/commerce`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commerce),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(
          body?.message
            ? `${body.message}: ${JSON.stringify(body.details ?? {})}`
            : `HTTP ${r.status}`,
        );
      }
      setCommerce(body);
      setData((d) => (d ? { ...d, commerce: body } : d));
      setOk("Commerce settings saved.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveRevenue() {
    if (!revenue) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const ladder = ladderText
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      const payload = { ...revenue, recoveryLadderHours: ladder };
      const r = await fetch(`${API}/settings/revenue`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(
          body?.message
            ? `${body.message}: ${JSON.stringify(body.details ?? {})}`
            : `HTTP ${r.status}`,
        );
      }
      setRevenue(body);
      setLadderText(body.recoveryLadderHours.join(", "));
      setData((d) => (d ? { ...d, revenue: body } : d));
      setOk("Revenue policy saved.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!data || !commerce || !revenue) {
    return (
      <div>
        <PageHeader
          title="Settings"
          subtitle="Owner-controlled business policy"
        />
        {error ? (
          <p style={{ color: "#b00020" }}>{error}</p>
        ) : (
          <p style={{ color: "#666" }}>Loading…</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Persisted brand policy. Secrets stay in Connections / .env — never here."
      />

      {error && (
        <p style={{ color: "#b00020", marginBottom: "0.75rem" }}>{error}</p>
      )}
      {ok && <p style={{ color: "#1b7a3d", marginBottom: "0.75rem" }}>{ok}</p>}

      <div style={{ display: "grid", gap: "1rem", maxWidth: 720 }}>
        <section style={{ ...card, padding: "1.1rem 1.2rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.75rem",
            }}
          >
            <h2 style={{ margin: 0, fontSize: "1rem" }}>Commerce</h2>
            <StatusBadge status="CONNECTED" />
          </div>
          <p style={{ fontSize: "0.78rem", color: "#666", marginTop: 0 }}>
            Provider-neutral owner policy. Applies to Shopify today and any
            future ecommerce adapter.
          </p>

          <div style={fieldStyle}>
            <span style={labelStyle}>Low stock threshold</span>
            <span style={helpStyle}>
              Products with inventory at or below this quantity are treated as
              low stock by recommendations and revenue optimization.
            </span>
            <input
              style={inputStyle}
              type="number"
              value={commerce.lowStockThreshold}
              onChange={(e) =>
                setCommerce({
                  ...commerce,
                  lowStockThreshold: Number(e.target.value),
                })
              }
            />
          </div>

          <div style={fieldStyle}>
            <span style={labelStyle}>Default metrics period (days)</span>
            <span style={helpStyle}>
              Number of days included in commerce metrics snapshots and period
              comparisons.
            </span>
            <input
              style={inputStyle}
              type="number"
              value={commerce.defaultMetricsPeriodDays}
              onChange={(e) =>
                setCommerce({
                  ...commerce,
                  defaultMetricsPeriodDays: Number(e.target.value),
                })
              }
            />
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={saveCommerce}
            style={{
              padding: "0.45rem 0.9rem",
              background: "#1a1a1a",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Save commerce
          </button>
        </section>

        <section style={{ ...card, padding: "1.1rem 1.2rem" }}>
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Revenue</h2>
          <p style={{ fontSize: "0.78rem", color: "#666", marginTop: 0 }}>
            Deterministic safety policy. Models cannot override these values.
          </p>

          {(
            [
              [
                "maxDiscountPct",
                "Maximum discount (%)",
                "Hard cap on any discount percentage offered in recovery or experiments.",
              ],
              [
                "minContributionMarginPct",
                "Minimum contribution margin (%)",
                "Discount is blocked if estimated margin after discount falls below this floor.",
              ],
              [
                "minOrderValue",
                "Minimum order value",
                "Carts below this value are not eligible for recovery offers.",
              ],
              [
                "maxDiscountsPerJourney",
                "Maximum discounts per recovery journey",
                "How many discount offers may be sent across one recovery journey.",
              ],
              [
                "minHoursBeforeDiscount",
                "Delay before discounts (hours)",
                "Hours after abandonment before any discount may be offered.",
              ],
              [
                "winBackDays",
                "Win-back period (days)",
                "Days without an order before a customer is considered win-back eligible.",
              ],
              [
                "vipLtvThreshold",
                "VIP lifetime-value threshold",
                "Customers at or above this lifetime value are treated as VIP for win-back.",
              ],
              [
                "freeShippingNearFactor",
                "Free-shipping proximity factor",
                "Carts at or above this fraction of the free-shipping threshold get a free-shipping nudge instead of a discount (e.g. 0.8 = 80%).",
              ],
            ] as const
          ).map(([key, label, help]) => (
            <div key={key} style={fieldStyle}>
              <span style={labelStyle}>{label}</span>
              <span style={helpStyle}>{help}</span>
              <input
                style={inputStyle}
                type="number"
                step={key === "freeShippingNearFactor" ? "0.01" : "1"}
                value={revenue[key]}
                onChange={(e) =>
                  setRevenue({
                    ...revenue,
                    [key]: Number(e.target.value),
                  })
                }
              />
            </div>
          ))}

          <div style={fieldStyle}>
            <span style={labelStyle}>Recovery message schedule (hours)</span>
            <span style={helpStyle}>
              Comma-separated delays after abandonment for each recovery step
              (must be strictly increasing). Example: 1, 6, 24, 48
            </span>
            <input
              style={{ ...inputStyle, maxWidth: 360 }}
              type="text"
              value={ladderText}
              onChange={(e) => setLadderText(e.target.value)}
            />
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={saveRevenue}
            style={{
              padding: "0.45rem 0.9rem",
              background: "#1a1a1a",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Save revenue policy
          </button>
        </section>
      </div>
    </div>
  );
}
