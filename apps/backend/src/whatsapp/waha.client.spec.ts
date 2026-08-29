import { of, throwError } from "rxjs";
import {
  chatIdToPhone,
  mapWahaStatus,
  phoneToChatId,
  redactSecrets,
  WahaClient,
} from "./waha.client";

const CONFIG_VALUES: Record<string, string> = {
  WAHA_BASE_URL: "http://waha:3000",
  WAHA_SESSION: "default",
  WAHA_API_KEY: "super-secret-key-123",
  WAHA_TIMEOUT_MS: "15000",
};

function makeConfig(overrides: Record<string, string> = {}) {
  const values = { ...CONFIG_VALUES, ...overrides };
  return { get: jest.fn((key: string) => values[key]) };
}

describe("redactSecrets", () => {
  it("redacts an api key echoed back in an error", () => {
    const redacted = redactSecrets(
      'Request failed with headers {"X-Api-Key":"super-secret-key-123"}',
    );
    expect(redacted).not.toContain("super-secret-key-123");
    expect(redacted).toContain("[redacted]");
  });

  it("redacts bearer tokens", () => {
    expect(redactSecrets('authorization: Bearer abc.def.ghi')).not.toContain(
      "abc.def.ghi",
    );
  });

  it("redacts passwords and generic tokens", () => {
    expect(redactSecrets('password="hunter2"')).not.toContain("hunter2");
    expect(redactSecrets("token=tok_live_9999")).not.toContain("tok_live_9999");
  });

  it("leaves ordinary text alone", () => {
    expect(redactSecrets("Session is not connected")).toBe(
      "Session is not connected",
    );
  });
});

describe("phone helpers", () => {
  it("converts a formatted phone to a chat id", () => {
    expect(phoneToChatId("+972 50-123-4567")).toBe("972501234567@c.us");
  });

  it("rejects a phone that is too short to dial", () => {
    expect(phoneToChatId("12345")).toBeNull();
  });

  it("rejects a phone that is too long for E.164", () => {
    expect(phoneToChatId("1234567890123456")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(phoneToChatId("")).toBeNull();
  });

  it("extracts a phone back out of a chat id", () => {
    expect(chatIdToPhone("972501234567@c.us")).toBe("972501234567");
  });

  it("returns null for a group chat id", () => {
    expect(chatIdToPhone("some-group-id@g.us")).toBeNull();
  });
});

describe("mapWahaStatus", () => {
  it("maps WAHA states onto the internal vocabulary", () => {
    expect(mapWahaStatus("WORKING")).toBe("WORKING");
    expect(mapWahaStatus("SCAN_QR_CODE")).toBe("SCAN_QR");
    expect(mapWahaStatus("STARTING")).toBe("STARTING");
    expect(mapWahaStatus("FAILED")).toBe("FAILED");
  });

  it("falls back to STOPPED for anything unrecognised", () => {
    expect(mapWahaStatus("SOMETHING_NEW")).toBe("STOPPED");
    expect(mapWahaStatus(undefined)).toBe("STOPPED");
  });
});

describe("WahaClient", () => {
  describe("configuration", () => {
    it("is unconfigured without a base url", () => {
      const client = new WahaClient(
        {} as any,
        makeConfig({ WAHA_BASE_URL: "" }) as any,
      );
      expect(client.configured).toBe(false);
    });

    it("fails terminally rather than calling out when unconfigured", async () => {
      const http = { get: jest.fn() };
      const client = new WahaClient(
        http as any,
        makeConfig({ WAHA_BASE_URL: "" }) as any,
      );
      const res = await client.getSessionStatus();
      expect(res.ok).toBe(false);
      expect(res.outcome).toBe("TERMINAL");
      expect(http.get).not.toHaveBeenCalled();
    });
  });

  describe("getSessionStatus", () => {
    it("returns only the safe account identifier", async () => {
      const http = {
        get: jest.fn().mockReturnValue(
          of({
            data: {
              status: "WORKING",
              me: { id: "972501234567@c.us", pushName: "Luminesce" },
            },
          }),
        ),
      };
      const client = new WahaClient(http as any, makeConfig() as any);
      const res = await client.getSessionStatus();

      expect(res.ok).toBe(true);
      expect(res.data).toEqual({
        status: "WORKING",
        meNumber: "972501234567",
        meName: "Luminesce",
      });
    });

    it("never leaks the api key in an error", async () => {
      const http = {
        get: jest.fn().mockReturnValue(
          throwError(() =>
            Object.assign(
              new Error(
                'connect failed with {"x-api-key":"super-secret-key-123"}',
              ),
              { response: { status: 500 } },
            ),
          ),
        ),
      };
      const client = new WahaClient(http as any, makeConfig() as any);
      const res = await client.getSessionStatus();

      expect(res.ok).toBe(false);
      expect(res.error).not.toContain("super-secret-key-123");
      expect(JSON.stringify(res)).not.toContain("super-secret-key-123");
    });

    it("sends the api key as a header, not in the URL", async () => {
      const http = {
        get: jest.fn().mockReturnValue(of({ data: { status: "WORKING" } })),
      };
      const client = new WahaClient(http as any, makeConfig() as any);
      await client.getSessionStatus();

      const [url, options] = http.get.mock.calls[0]!;
      expect(url).not.toContain("super-secret-key-123");
      expect(options.headers["X-Api-Key"]).toBe("super-secret-key-123");
    });
  });

  describe("getQr", () => {
    it("returns a data URI built from the PNG body", async () => {
      const http = {
        get: jest.fn().mockReturnValue(
          of({
            data: Buffer.from("fake-png"),
            headers: { "content-type": "image/png" },
          }),
        ),
      };
      const client = new WahaClient(http as any, makeConfig() as any);
      const res = await client.getQr();

      expect(res.ok).toBe(true);
      expect(res.data!.qrDataUrl).toBe(
        `data:image/png;base64,${Buffer.from("fake-png").toString("base64")}`,
      );
    });

    it("treats a 404 as 'no QR right now', not an outage", async () => {
      const http = {
        get: jest
          .fn()
          .mockReturnValue(
            throwError(() =>
              Object.assign(new Error("not found"), {
                response: { status: 404 },
              }),
            ),
          ),
      };
      const client = new WahaClient(http as any, makeConfig() as any);
      const res = await client.getQr();

      expect(res.ok).toBe(true);
      expect(res.data!.qrDataUrl).toBeNull();
    });

    it("returns no QR when the session is already authenticated", async () => {
      const http = {
        get: jest.fn().mockReturnValue(
          of({
            data: Buffer.from("{}"),
            headers: { "content-type": "application/json" },
          }),
        ),
      };
      const client = new WahaClient(http as any, makeConfig() as any);
      const res = await client.getQr();
      expect(res.data!.qrDataUrl).toBeNull();
    });
  });

  describe("sendText", () => {
    it("returns the provider message id", async () => {
      const http = {
        post: jest
          .fn()
          .mockReturnValue(of({ data: { id: { _serialized: "msg-123" } } })),
      };
      const client = new WahaClient(http as any, makeConfig() as any);
      const res = await client.sendText("972501234567@c.us", "hello");

      expect(res.ok).toBe(true);
      expect(res.data!.providerMessageId).toBe("msg-123");
    });

    it("classifies a timeout as UNKNOWN so it is never blind-retried", async () => {
      const http = {
        post: jest.fn().mockReturnValue(
          throwError(() =>
            Object.assign(new Error("timeout of 15000ms exceeded"), {
              code: "ECONNABORTED",
            }),
          ),
        ),
      };
      const client = new WahaClient(http as any, makeConfig() as any);
      const res = await client.sendText("972501234567@c.us", "hello");

      expect(res.ok).toBe(false);
      expect(res.outcome).toBe("UNKNOWN");
    });

    it("classifies a 4xx as TERMINAL", async () => {
      const http = {
        post: jest.fn().mockReturnValue(
          throwError(() =>
            Object.assign(new Error("bad request"), {
              response: { status: 422, data: { message: "invalid chatId" } },
            }),
          ),
        ),
      };
      const client = new WahaClient(http as any, makeConfig() as any);
      const res = await client.sendText("bad", "hello");

      expect(res.outcome).toBe("TERMINAL");
      expect(res.error).toContain("invalid chatId");
    });

    it("classifies a 5xx as RETRYABLE", async () => {
      const http = {
        post: jest.fn().mockReturnValue(
          throwError(() =>
            Object.assign(new Error("server error"), {
              response: { status: 503 },
            }),
          ),
        ),
      };
      const client = new WahaClient(http as any, makeConfig() as any);
      const res = await client.sendText("972501234567@c.us", "hello");
      expect(res.outcome).toBe("RETRYABLE");
    });
  });

  describe("listChats", () => {
    it("normalises the chat shape and drops entries without an id", async () => {
      const http = {
        get: jest.fn().mockReturnValue(
          of({
            data: [
              {
                id: { _serialized: "972501234567@c.us" },
                name: "Dana",
                timestamp: 1700000000,
                unreadCount: 2,
                lastMessage: { body: "is my order shipped?" },
              },
              { name: "no id here" },
            ],
          }),
        ),
      };
      const client = new WahaClient(http as any, makeConfig() as any);
      const res = await client.listChats();

      expect(res.data).toHaveLength(1);
      expect(res.data![0]).toEqual({
        id: "972501234567@c.us",
        name: "Dana",
        timestamp: 1700000000,
        unreadCount: 2,
        lastMessage: "is my order shipped?",
      });
    });
  });
});
