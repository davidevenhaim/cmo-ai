import { WhatsAppSessionService } from "./whatsapp-session.service";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    brandId: "luminesce-brand-001",
    sessionName: "default",
    status: "STOPPED",
    meNumber: null,
    meName: null,
    lastSyncAt: null,
    lastQrAt: null,
    lastError: null,
    ...overrides,
  };
}

function makePrisma(row = makeRow()) {
  let current = { ...row };
  return {
    whatsAppSession: {
      findUnique: jest.fn(async () => current),
      create: jest.fn(async ({ data }: any) => {
        current = { ...current, ...data };
        return current;
      }),
      update: jest.fn(async ({ data }: any) => {
        current = { ...current, ...data };
        return current;
      }),
      updateMany: jest.fn(),
    },
    _current: () => current,
  };
}

function makeWaha(overrides: Record<string, any> = {}) {
  return {
    configured: true,
    sessionName: "default",
    getSessionStatus: jest.fn().mockResolvedValue({
      ok: true,
      data: { status: "WORKING", meNumber: "972501234567", meName: "Brand" },
    }),
    startSession: jest.fn().mockResolvedValue({ ok: true }),
    stopSession: jest.fn().mockResolvedValue({ ok: true }),
    logoutSession: jest.fn().mockResolvedValue({ ok: true }),
    getQr: jest
      .fn()
      .mockResolvedValue({ ok: true, data: { qrDataUrl: "data:image/png;base64,AAA" } }),
    ...overrides,
  };
}

describe("WhatsAppSessionService", () => {
  describe("connection lifecycle", () => {
    it("reports NOT_CONFIGURED without ever calling WAHA", async () => {
      const prisma = makePrisma();
      const waha = makeWaha({ configured: false });
      const service = new WhatsAppSessionService(prisma as any, waha as any);

      const connection = await service.getConnection();

      expect(connection.status).toBe("NOT_CONFIGURED");
      expect(connection.configured).toBe(false);
      expect(waha.getSessionStatus).not.toHaveBeenCalled();
    });

    it("mirrors a WORKING session and its safe identifier", async () => {
      const service = new WhatsAppSessionService(
        makePrisma() as any,
        makeWaha() as any,
      );
      const connection = await service.getConnection();

      expect(connection.status).toBe("WORKING");
      expect(connection.meNumber).toBe("972501234567");
      expect(connection.lastError).toBeNull();
    });

    it("marks the session FAILED when WAHA is unreachable", async () => {
      const waha = makeWaha({
        getSessionStatus: jest
          .fn()
          .mockResolvedValue({ ok: false, error: "ECONNREFUSED" }),
      });
      const service = new WhatsAppSessionService(makePrisma() as any, waha as any);

      const connection = await service.getConnection();

      // Unreachable is distinct from "disconnected" — sends must not proceed.
      expect(connection.status).toBe("FAILED");
      expect(connection.lastError).toBe("ECONNREFUSED");
    });

    it("starts the session on connect", async () => {
      const waha = makeWaha();
      const service = new WhatsAppSessionService(makePrisma() as any, waha as any);
      await service.connect();
      expect(waha.startSession).toHaveBeenCalled();
    });

    it("treats 'already started' as success, not failure", async () => {
      const waha = makeWaha({
        startSession: jest
          .fn()
          .mockResolvedValue({ ok: false, error: "Session already started" }),
      });
      const service = new WhatsAppSessionService(makePrisma() as any, waha as any);

      const connection = await service.connect();
      expect(connection.status).toBe("WORKING");
    });

    it("stops then starts on reconnect", async () => {
      const waha = makeWaha();
      const service = new WhatsAppSessionService(makePrisma() as any, waha as any);
      await service.reconnect();
      expect(waha.stopSession).toHaveBeenCalled();
      expect(waha.startSession).toHaveBeenCalled();
    });

    it("clears the account identity on disconnect", async () => {
      const prisma = makePrisma(makeRow({ status: "WORKING", meNumber: "972501234567" }));
      const waha = makeWaha();
      const service = new WhatsAppSessionService(prisma as any, waha as any);

      const connection = await service.disconnect();

      expect(waha.logoutSession).toHaveBeenCalled();
      expect(connection.status).toBe("STOPPED");
      expect(connection.meNumber).toBeNull();
    });
  });

  describe("QR handling", () => {
    it("returns a QR while the session awaits a scan", async () => {
      const waha = makeWaha({
        getSessionStatus: jest
          .fn()
          .mockResolvedValue({
            ok: true,
            data: { status: "SCAN_QR", meNumber: null, meName: null },
          }),
      });
      const service = new WhatsAppSessionService(makePrisma() as any, waha as any);

      const qr = await service.getQr();

      expect(qr.status).toBe("SCAN_QR");
      expect(qr.qrDataUrl).toBe("data:image/png;base64,AAA");
      expect(qr.expired).toBe(false);
    });

    it("returns no QR once the session is connected", async () => {
      const waha = makeWaha();
      const service = new WhatsAppSessionService(makePrisma() as any, waha as any);

      const qr = await service.getQr();

      expect(qr.status).toBe("WORKING");
      expect(qr.qrDataUrl).toBeNull();
      expect(waha.getQr).not.toHaveBeenCalled();
    });

    it("marks a stale QR expired when a fresh one cannot be fetched", async () => {
      const twoMinutesAgo = new Date(Date.now() - 120_000);
      const prisma = makePrisma(
        makeRow({ status: "SCAN_QR", lastQrAt: twoMinutesAgo }),
      );
      const waha = makeWaha({
        getSessionStatus: jest.fn().mockResolvedValue({
          ok: true,
          data: { status: "SCAN_QR", meNumber: null, meName: null },
        }),
        getQr: jest.fn().mockResolvedValue({ ok: true, data: { qrDataUrl: null } }),
      });
      const service = new WhatsAppSessionService(prisma as any, waha as any);

      const qr = await service.getQr();

      expect(qr.qrDataUrl).toBeNull();
      expect(qr.expired).toBe(true);
    });

    it("does not claim expiry when no QR was ever shown", async () => {
      const prisma = makePrisma(makeRow({ status: "STOPPED", lastQrAt: null }));
      const waha = makeWaha({
        getSessionStatus: jest.fn().mockResolvedValue({
          ok: true,
          data: { status: "STOPPED", meNumber: null, meName: null },
        }),
        getQr: jest.fn().mockResolvedValue({ ok: true, data: { qrDataUrl: null } }),
      });
      const service = new WhatsAppSessionService(prisma as any, waha as any);

      const qr = await service.getQr();
      expect(qr.expired).toBe(false);
    });
  });

  describe("canSend", () => {
    it("is true only for a WORKING session", async () => {
      const service = new WhatsAppSessionService(
        makePrisma(makeRow({ status: "WORKING" })) as any,
        makeWaha() as any,
      );
      expect(await service.canSend()).toBe(true);
    });

    it("is false for a disconnected session", async () => {
      const service = new WhatsAppSessionService(
        makePrisma(makeRow({ status: "STOPPED" })) as any,
        makeWaha() as any,
      );
      expect(await service.canSend()).toBe(false);
    });

    it("is false while the session is still awaiting a QR scan", async () => {
      const service = new WhatsAppSessionService(
        makePrisma(makeRow({ status: "SCAN_QR" })) as any,
        makeWaha() as any,
      );
      expect(await service.canSend()).toBe(false);
    });

    it("is false when WAHA is not configured at all", async () => {
      const service = new WhatsAppSessionService(
        makePrisma(makeRow({ status: "WORKING" })) as any,
        makeWaha({ configured: false }) as any,
      );
      expect(await service.canSend()).toBe(false);
    });
  });
});
