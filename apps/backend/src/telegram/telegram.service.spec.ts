import { Test, TestingModule } from "@nestjs/testing";
import { TelegramService } from "./telegram.service";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma.service";
import { of, throwError } from "rxjs";

const mockHttp = { post: jest.fn(), get: jest.fn() };
const mockConfig = {
  get: jest.fn((key: string, def?: string) => {
    const cfg: Record<string, string> = {
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_ALLOWED_CHAT_IDS: "111,222",
      TELEGRAM_WEBHOOK_SECRET: "secret123",
    };
    return cfg[key] ?? def ?? "";
  }),
};
const mockPrisma = {
  telegramMessage: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
};

describe("TelegramService", () => {
  let service: TelegramService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramService,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<TelegramService>(TelegramService);
    jest.clearAllMocks();
  });

  it("isChatAllowed returns true for configured chat ID", () => {
    expect(service.isChatAllowed("111")).toBe(true);
    expect(service.isChatAllowed("999")).toBe(false);
  });

  it("sendMessage persists outbound record and marks delivered on success", async () => {
    const fakeRecord = { id: "msg-001" };
    mockPrisma.telegramMessage.create.mockResolvedValue(fakeRecord);
    mockPrisma.telegramMessage.update.mockResolvedValue({});
    mockHttp.post.mockReturnValue(of({ data: { result: { message_id: 42 } } }));

    await service.sendMessage("111", "Hello");

    expect(mockPrisma.telegramMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: "outbound",
          delivered: false,
        }),
      }),
    );
    expect(mockPrisma.telegramMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ delivered: true, telegramMsgId: 42 }),
      }),
    );
  });

  it("sendMessage records failureReason and rethrows on API error", async () => {
    const fakeRecord = { id: "msg-002" };
    mockPrisma.telegramMessage.create.mockResolvedValue(fakeRecord);
    mockPrisma.telegramMessage.update.mockResolvedValue({});
    mockHttp.post.mockReturnValue(
      throwError(() =>
        Object.assign(new Error("API error"), {
          response: { data: { description: "Bad request" } },
        }),
      ),
    );

    await expect(service.sendMessage("111", "Hello")).rejects.toThrow();
    expect(mockPrisma.telegramMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failureReason: "Bad request" }),
      }),
    );
  });

  it("sendMessage skips HTTP call when bot not configured", async () => {
    // Override config to return empty token
    const unconfiguredConfig = {
      get: jest.fn((key: string, def?: string) =>
        key === "TELEGRAM_BOT_TOKEN" ? "" : (def ?? ""),
      ),
    };
    const module2: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramService,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: unconfiguredConfig },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    const unconfigured = module2.get<TelegramService>(TelegramService);

    mockPrisma.telegramMessage.create.mockResolvedValue({ id: "msg-003" });
    mockPrisma.telegramMessage.update.mockResolvedValue({});

    await unconfigured.sendMessage("111", "Hello");

    expect(mockHttp.post).not.toHaveBeenCalled();
    expect(mockPrisma.telegramMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failureReason: "Bot not configured" }),
      }),
    );
  });

  it("persistInbound creates inbound message record", async () => {
    mockPrisma.telegramMessage.create.mockResolvedValue({ id: "msg-004" });
    await service.persistInbound("111", "/today");
    expect(mockPrisma.telegramMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: "inbound",
          delivered: true,
        }),
      }),
    );
  });
});
