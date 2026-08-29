import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import type { WhatsAppSessionStatus } from "@ai-cmo/contracts";

export interface WahaResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** RETRYABLE errors may be retried; TERMINAL must not be. UNKNOWN = send may have landed. */
  outcome?: "RETRYABLE" | "TERMINAL" | "UNKNOWN";
}

export interface WahaChat {
  id: string;
  name: string | null;
  timestamp: number | null;
  unreadCount: number;
  lastMessage: string | null;
}

export interface WahaMessage {
  id: string;
  fromMe: boolean;
  body: string;
  timestamp: number;
  ack: number | null;
}

/**
 * Redacts anything that looks like a credential before a provider error is
 * stored or logged (invariant 14). WAHA echoes request config — including the
 * X-Api-Key header — inside axios error messages.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  return input
    .replace(/(x-api-key["'\s:=]+)[^\s,"'}]+/gi, "$1[redacted]")
    .replace(/(api[-_]?key["'\s:=]+)[^\s,"'}]+/gi, "$1[redacted]")
    .replace(/(authorization["'\s:=]+)(bearer\s+)?[^\s,"'}]+/gi, "$1[redacted]")
    .replace(/(token["'\s:=]+)[^\s,"'}]+/gi, "$1[redacted]")
    .replace(/(password["'\s:=]+)[^\s,"'}]+/gi, "$1[redacted]");
}

/** WAHA's session states, mapped onto our stable internal vocabulary. */
export function mapWahaStatus(raw: unknown): WhatsAppSessionStatus {
  const s = String(raw ?? "").toUpperCase();
  switch (s) {
    case "WORKING":
      return "WORKING";
    case "SCAN_QR_CODE":
    case "SCAN_QR":
      return "SCAN_QR";
    case "STARTING":
      return "STARTING";
    case "STOPPED":
      return "STOPPED";
    case "FAILED":
      return "FAILED";
    default:
      return "STOPPED";
  }
}

/**
 * Thin, typed WAHA HTTP client.
 *
 * All credentials stay here: nothing this class returns carries the API key,
 * and every error passes through redactSecrets before it leaves.
 */
@Injectable()
export class WahaClient {
  private readonly logger = new Logger(WahaClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  get baseUrl(): string {
    return (this.config.get<string>("WAHA_BASE_URL") ?? "")
      .trim()
      .replace(/\/$/, "");
  }

  get sessionName(): string {
    return (this.config.get<string>("WAHA_SESSION") ?? "default").trim();
  }

  get configured(): boolean {
    return !!this.baseUrl;
  }

  private get headers(): Record<string, string> {
    const apiKey = (this.config.get<string>("WAHA_API_KEY") ?? "").trim();
    return {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-Api-Key": apiKey } : {}),
    };
  }

  private get timeoutMs(): number {
    const raw = this.config.get<string>("WAHA_TIMEOUT_MS") ?? "15000";
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 15_000;
  }

  private async request<T>(
    method: "get" | "post" | "delete",
    path: string,
    body?: unknown,
  ): Promise<WahaResult<T>> {
    if (!this.configured) {
      return { ok: false, error: "WAHA_BASE_URL not set", outcome: "TERMINAL" };
    }
    try {
      const url = `${this.baseUrl}${path}`;
      const response = await firstValueFrom(
        method === "get"
          ? this.http.get(url, { headers: this.headers, timeout: this.timeoutMs })
          : method === "delete"
            ? this.http.delete(url, {
                headers: this.headers,
                timeout: this.timeoutMs,
              })
            : this.http.post(url, body ?? {}, {
                headers: this.headers,
                timeout: this.timeoutMs,
              }),
      );
      return { ok: true, data: response.data as T };
    } catch (err: any) {
      const status = err?.response?.status;
      const raw =
        err?.response?.data?.message ?? err?.message ?? "unknown WAHA error";
      const error = redactSecrets(String(raw)).slice(0, 500);

      // A timeout on a send is genuinely ambiguous — the message may have gone
      // out. Callers must not blind-retry those.
      const timedOut =
        err?.code === "ECONNABORTED" || /timeout/i.test(err?.message ?? "");
      const outcome: WahaResult<T>["outcome"] = timedOut
        ? "UNKNOWN"
        : status && status >= 400 && status < 500
          ? "TERMINAL"
          : "RETRYABLE";

      return { ok: false, error, outcome };
    }
  }

  // --- Session lifecycle ---------------------------------------------------

  async getSessionStatus(): Promise<
    WahaResult<{ status: WhatsAppSessionStatus; meNumber: string | null; meName: string | null }>
  > {
    const res = await this.request<any>(
      "get",
      `/api/sessions/${encodeURIComponent(this.sessionName)}`,
    );
    if (!res.ok) return { ...res, data: undefined };
    const raw = res.data ?? {};
    // WAHA's `me.id` is like "9725xxxxxxx@c.us"; keep only the safe number part.
    const meId: string | null = raw?.me?.id ?? null;
    return {
      ok: true,
      data: {
        status: mapWahaStatus(raw.status),
        meNumber: meId ? String(meId).split("@")[0]! : null,
        meName: raw?.me?.pushName ? String(raw.me.pushName).slice(0, 120) : null,
      },
    };
  }

  async startSession(): Promise<WahaResult<unknown>> {
    return this.request("post", "/api/sessions/start", {
      name: this.sessionName,
    });
  }

  async stopSession(): Promise<WahaResult<unknown>> {
    return this.request("post", "/api/sessions/stop", {
      name: this.sessionName,
    });
  }

  async logoutSession(): Promise<WahaResult<unknown>> {
    return this.request("post", "/api/sessions/logout", {
      name: this.sessionName,
    });
  }

  /** Returns a data: URI, or null when the session is not awaiting a scan. */
  async getQr(): Promise<WahaResult<{ qrDataUrl: string | null }>> {
    if (!this.configured) {
      return { ok: false, error: "WAHA_BASE_URL not set", outcome: "TERMINAL" };
    }
    try {
      const response = await firstValueFrom(
        this.http.get(
          `${this.baseUrl}/api/${encodeURIComponent(this.sessionName)}/auth/qr`,
          {
            headers: { ...this.headers, Accept: "image/png" },
            timeout: this.timeoutMs,
            responseType: "arraybuffer",
          },
        ),
      );
      const contentType = String(
        response.headers?.["content-type"] ?? "image/png",
      );
      // WAHA returns JSON (not an image) when the session is already authed.
      if (contentType.includes("application/json")) {
        return { ok: true, data: { qrDataUrl: null } };
      }
      const base64 = Buffer.from(response.data as ArrayBuffer).toString(
        "base64",
      );
      return {
        ok: true,
        data: { qrDataUrl: `data:${contentType};base64,${base64}` },
      };
    } catch (err: any) {
      const status = err?.response?.status;
      // 404/422 simply means "no QR right now" — not an outage.
      if (status === 404 || status === 422) {
        return { ok: true, data: { qrDataUrl: null } };
      }
      return {
        ok: false,
        error: redactSecrets(String(err?.message ?? "qr fetch failed")).slice(0, 500),
        outcome: "RETRYABLE",
      };
    }
  }

  // --- Inbox ---------------------------------------------------------------

  async listChats(limit = 50): Promise<WahaResult<WahaChat[]>> {
    const res = await this.request<any[]>(
      "get",
      `/api/${encodeURIComponent(this.sessionName)}/chats?limit=${limit}`,
    );
    if (!res.ok) return { ...res, data: undefined };
    const chats = Array.isArray(res.data) ? res.data : [];
    return {
      ok: true,
      data: chats.map((c: any) => ({
        id: String(c?.id?._serialized ?? c?.id ?? ""),
        name: c?.name ? String(c.name).slice(0, 160) : null,
        timestamp: typeof c?.timestamp === "number" ? c.timestamp : null,
        unreadCount: typeof c?.unreadCount === "number" ? c.unreadCount : 0,
        lastMessage: c?.lastMessage?.body
          ? String(c.lastMessage.body).slice(0, 200)
          : null,
      })).filter((c) => c.id),
    };
  }

  async listMessages(
    chatId: string,
    limit = 50,
  ): Promise<WahaResult<WahaMessage[]>> {
    const res = await this.request<any[]>(
      "get",
      `/api/${encodeURIComponent(this.sessionName)}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`,
    );
    if (!res.ok) return { ...res, data: undefined };
    const messages = Array.isArray(res.data) ? res.data : [];
    return {
      ok: true,
      data: messages
        .map((m: any) => ({
          id: String(m?.id?._serialized ?? m?.id ?? ""),
          fromMe: !!m?.fromMe,
          body: String(m?.body ?? "").slice(0, 4096),
          timestamp:
            typeof m?.timestamp === "number" ? m.timestamp : Date.now() / 1000,
          ack: typeof m?.ack === "number" ? m.ack : null,
        }))
        .filter((m) => m.id),
    };
  }

  async sendText(
    chatId: string,
    text: string,
  ): Promise<WahaResult<{ providerMessageId: string }>> {
    const res = await this.request<any>("post", "/api/sendText", {
      session: this.sessionName,
      chatId,
      text,
    });
    if (!res.ok) return { ...res, data: undefined };
    const data = res.data ?? {};
    const id = data?.id?._serialized ?? data?.id ?? data?.key?.id;
    return {
      ok: true,
      data: { providerMessageId: String(id ?? `waha-${Date.now()}`) },
    };
  }
}

/** Normalises a phone number into WAHA's chat-id form. */
export function phoneToChatId(phone: string): string | null {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  // E.164 allows 8–15 digits; anything outside that is not dialable.
  if (digits.length < 8 || digits.length > 15) return null;
  return `${digits}@c.us`;
}

/** Extracts the bare phone number from a WAHA chat id. */
export function chatIdToPhone(chatId: string): string | null {
  const [digits] = String(chatId ?? "").split("@");
  return digits && /^\d{8,15}$/.test(digits) ? digits : null;
}
