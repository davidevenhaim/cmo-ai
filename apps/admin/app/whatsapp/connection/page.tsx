"use client";

import { useCallback, useEffect, useState } from "react";
import { card, PageHeader, sectionLabel, StatusBadge } from "../../components/ui";
import WhatsAppTabs from "../WhatsAppTabs";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** WAHA rotates the pairing code, so poll while a scan is pending. */
const POLL_MS = 4000;

interface Connection {
  status:
    | "NOT_CONFIGURED"
    | "STOPPED"
    | "STARTING"
    | "SCAN_QR"
    | "WORKING"
    | "FAILED";
  configured: boolean;
  sessionName: string;
  meNumber: string | null;
  meName: string | null;
  lastSyncAt: string | null;
  lastQrAt: string | null;
  lastError: string | null;
}

interface Qr {
  qrDataUrl: string | null;
  status: string;
  expired: boolean;
  retrievedAt: string | null;
}

const buttonStyle: React.CSSProperties = {
  padding: "0.45rem 0.9rem",
  borderRadius: 6,
  border: "none",
  background: "#1a1a1a",
  color: "#fff",
  fontSize: "0.82rem",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  ...buttonStyle,
  background: "#fff",
  color: "#444",
  border: "1px solid #ccc",
};

export default function WhatsAppConnectionPage() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/whatsapp/connection`);
      const body = await res.json();
      setConnection(body);
      return body as Connection;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, []);

  const loadQr = useCallback(async () => {
    try {
      const res = await fetch(`${API}/whatsapp/connection/qr`);
      setQr(await res.json());
    } catch {
      // A failed QR poll is not worth surfacing — the next tick retries.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll only while a scan is actually pending.
  useEffect(() => {
    if (connection?.status !== "SCAN_QR" && connection?.status !== "STARTING") {
      return;
    }
    loadQr();
    const timer = setInterval(async () => {
      const next = await load();
      if (next?.status === "SCAN_QR" || next?.status === "STARTING") {
        loadQr();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [connection?.status, load, loadQr]);

  async function act(path: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/whatsapp/connection/${path}`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? "Request failed");
      setConnection(body);
      if (body.status === "SCAN_QR") await loadQr();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="WhatsApp — Connection"
        subtitle="The backend owns the WAHA session. Credentials never reach this page."
      />
      <WhatsAppTabs active="connection" />

      {!connection ? (
        <p style={{ color: "#888" }}>Loading…</p>
      ) : (
        <div style={{ ...card, maxWidth: 560 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: "1rem",
            }}
          >
            <div style={sectionLabel}>Session {connection.sessionName}</div>
            <StatusBadge status={connection.status} />
          </div>

          {connection.status === "NOT_CONFIGURED" && (
            <p style={{ fontSize: "0.85rem", color: "#666" }}>
              WAHA is not configured. Set <code>WAHA_BASE_URL</code> and start
              the WAHA container, then reload this page.
            </p>
          )}

          {connection.status === "STOPPED" && (
            <>
              <p
                style={{
                  fontSize: "0.85rem",
                  color: "#666",
                  marginBottom: "0.8rem",
                }}
              >
                WhatsApp is disconnected. Connecting will show a QR code to scan
                with your phone.
              </p>
              <button style={buttonStyle} disabled={busy} onClick={() => act("connect")}>
                {busy ? "Connecting…" : "Connect WhatsApp"}
              </button>
            </>
          )}

          {(connection.status === "SCAN_QR" || connection.status === "STARTING") && (
            <>
              <p
                style={{
                  fontSize: "0.85rem",
                  color: "#666",
                  marginBottom: "0.8rem",
                }}
              >
                Open WhatsApp on your phone → Settings → Linked devices → Link a
                device, then scan this code.
              </p>

              {qr?.qrDataUrl ? (
                <img
                  src={qr.qrDataUrl}
                  alt="WhatsApp pairing QR code"
                  style={{
                    width: 260,
                    height: 260,
                    border: "1px solid #e5e5e5",
                    borderRadius: 8,
                    display: "block",
                    marginBottom: "0.8rem",
                  }}
                />
              ) : qr?.expired ? (
                <div
                  style={{
                    ...card,
                    background: "#fdf3d7",
                    marginBottom: "0.8rem",
                  }}
                >
                  <p style={{ fontSize: "0.82rem", color: "#8a6d1a" }}>
                    This QR code expired before it was scanned. Reconnect to get
                    a fresh one.
                  </p>
                </div>
              ) : (
                <p
                  style={{
                    fontSize: "0.82rem",
                    color: "#888",
                    marginBottom: "0.8rem",
                  }}
                >
                  Waiting for a QR code…
                </p>
              )}

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  style={secondaryButton}
                  disabled={busy}
                  onClick={() => act("reconnect")}
                >
                  Refresh QR
                </button>
                <button
                  style={secondaryButton}
                  disabled={busy}
                  onClick={() => act("disconnect")}
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {connection.status === "WORKING" && (
            <>
              <dl style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <dt style={{ color: "#888", minWidth: 120 }}>Account</dt>
                  <dd>
                    {connection.meName ?? "—"}
                    {connection.meNumber ? ` (${connection.meNumber})` : ""}
                  </dd>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <dt style={{ color: "#888", minWidth: 120 }}>Last sync</dt>
                  <dd>
                    {connection.lastSyncAt
                      ? new Date(connection.lastSyncAt).toLocaleString()
                      : "—"}
                  </dd>
                </div>
              </dl>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  style={secondaryButton}
                  disabled={busy}
                  onClick={() => act("reconnect")}
                >
                  Reconnect
                </button>
                <button
                  style={secondaryButton}
                  disabled={busy}
                  onClick={() => act("disconnect")}
                >
                  Disconnect
                </button>
              </div>
            </>
          )}

          {connection.status === "FAILED" && (
            <>
              <p
                style={{
                  fontSize: "0.85rem",
                  color: "#a02a2a",
                  marginBottom: "0.8rem",
                }}
              >
                {connection.lastError ?? "The WAHA session failed."}
              </p>
              <button style={buttonStyle} disabled={busy} onClick={() => act("reconnect")}>
                Retry
              </button>
            </>
          )}

          {error && (
            <p style={{ color: "#a02a2a", fontSize: "0.8rem", marginTop: "0.8rem" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
