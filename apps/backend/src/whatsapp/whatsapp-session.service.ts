import { Injectable, Logger } from "@nestjs/common";
import type { WhatsAppConnection, WhatsAppQr } from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { WahaClient } from "./waha.client";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

/**
 * WAHA rotates the pairing QR roughly every 20s and expires the whole scan
 * window after a minute or so. Anything older is presented as expired so the
 * owner is told to re-request rather than scanning a dead code (B1).
 */
const QR_TTL_MS = 60_000;

/**
 * Owns the WAHA session lifecycle. The browser never talks to WAHA directly
 * and never receives WAHA credentials — the admin UI only ever sees the
 * fields on WhatsAppConnection.
 */
@Injectable()
export class WhatsAppSessionService {
  private readonly logger = new Logger(WhatsAppSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
  ) {}

  private async ensureRow(brandId = DEFAULT_BRAND_ID) {
    const existing = await this.prisma.whatsAppSession.findUnique({
      where: { brandId },
    });
    if (existing) return existing;
    return this.prisma.whatsAppSession.create({
      data: {
        brandId,
        sessionName: this.waha.sessionName,
        status: this.waha.configured ? "STOPPED" : "NOT_CONFIGURED",
      },
    });
  }

  /** Live status, refreshed from WAHA and mirrored into the DB. */
  async getConnection(brandId = DEFAULT_BRAND_ID): Promise<WhatsAppConnection> {
    const row = await this.ensureRow(brandId);

    if (!this.waha.configured) {
      return this.toConnection({
        ...row,
        status: "NOT_CONFIGURED",
        lastError: "WAHA_BASE_URL not set",
      });
    }

    const res = await this.waha.getSessionStatus();
    if (!res.ok || !res.data) {
      const updated = await this.prisma.whatsAppSession.update({
        where: { brandId },
        data: {
          // A provider we cannot reach is FAILED, not "disconnected" — the
          // distinction matters when deciding whether sends may proceed.
          status: "FAILED",
          lastError: res.error ?? "WAHA unreachable",
        },
      });
      return this.toConnection(updated);
    }

    const updated = await this.prisma.whatsAppSession.update({
      where: { brandId },
      data: {
        sessionName: this.waha.sessionName,
        status: res.data.status,
        meNumber: res.data.meNumber,
        meName: res.data.meName,
        lastSyncAt: new Date(),
        lastError: null,
      },
    });
    return this.toConnection(updated);
  }

  async connect(brandId = DEFAULT_BRAND_ID): Promise<WhatsAppConnection> {
    await this.ensureRow(brandId);
    if (!this.waha.configured) return this.getConnection(brandId);

    const res = await this.waha.startSession();
    if (!res.ok) {
      // WAHA 422s when the session already exists — that is not a failure.
      const alreadyRunning = /already/i.test(res.error ?? "");
      if (!alreadyRunning) {
        await this.prisma.whatsAppSession.update({
          where: { brandId },
          data: { status: "FAILED", lastError: res.error ?? "start failed" },
        });
        return this.getConnection(brandId);
      }
    }
    return this.getConnection(brandId);
  }

  async reconnect(brandId = DEFAULT_BRAND_ID): Promise<WhatsAppConnection> {
    if (this.waha.configured) {
      await this.waha.stopSession();
      await this.waha.startSession();
    }
    return this.getConnection(brandId);
  }

  /** Full logout — the owner must re-scan a QR afterwards. */
  async disconnect(brandId = DEFAULT_BRAND_ID): Promise<WhatsAppConnection> {
    await this.ensureRow(brandId);
    if (this.waha.configured) {
      await this.waha.logoutSession();
      await this.waha.stopSession();
    }
    const updated = await this.prisma.whatsAppSession.update({
      where: { brandId },
      data: {
        status: this.waha.configured ? "STOPPED" : "NOT_CONFIGURED",
        meNumber: null,
        meName: null,
        lastQrAt: null,
      },
    });
    return this.toConnection(updated);
  }

  async getQr(brandId = DEFAULT_BRAND_ID): Promise<WhatsAppQr> {
    const connection = await this.getConnection(brandId);

    if (connection.status === "WORKING") {
      return {
        qrDataUrl: null,
        status: "WORKING",
        expired: false,
        retrievedAt: null,
      };
    }
    if (!this.waha.configured) {
      return {
        qrDataUrl: null,
        status: "NOT_CONFIGURED",
        expired: false,
        retrievedAt: null,
      };
    }

    const res = await this.waha.getQr();
    if (!res.ok || !res.data?.qrDataUrl) {
      const row = await this.prisma.whatsAppSession.findUnique({
        where: { brandId },
      });
      const lastQrAt = row?.lastQrAt ?? null;
      return {
        qrDataUrl: null,
        status: connection.status,
        // If we previously showed a QR and can no longer fetch one, the code
        // the owner is looking at is stale.
        expired: !!lastQrAt && Date.now() - lastQrAt.getTime() > QR_TTL_MS,
        retrievedAt: lastQrAt,
      };
    }

    const now = new Date();
    await this.prisma.whatsAppSession.update({
      where: { brandId },
      data: { lastQrAt: now, status: "SCAN_QR" },
    });

    return {
      qrDataUrl: res.data.qrDataUrl,
      status: "SCAN_QR",
      expired: false,
      retrievedAt: now,
    };
  }

  /** True only when WhatsApp can actually deliver a message right now. */
  async canSend(brandId = DEFAULT_BRAND_ID): Promise<boolean> {
    if (!this.waha.configured) return false;
    const row = await this.prisma.whatsAppSession.findUnique({
      where: { brandId },
    });
    return row?.status === "WORKING";
  }

  private toConnection(row: {
    status: string;
    sessionName: string;
    meNumber: string | null;
    meName: string | null;
    lastSyncAt: Date | null;
    lastQrAt: Date | null;
    lastError: string | null;
  }): WhatsAppConnection {
    return {
      status: row.status as WhatsAppConnection["status"],
      configured: this.waha.configured,
      sessionName: row.sessionName,
      meNumber: row.meNumber,
      meName: row.meName,
      lastSyncAt: row.lastSyncAt,
      lastQrAt: row.lastQrAt,
      lastError: row.lastError,
    };
  }
}
