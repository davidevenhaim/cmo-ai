import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { TelegramController } from "./telegram.controller";
import { TelegramService } from "./telegram.service";
import { TelegramCommandService } from "./telegram-command.service";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma.service";

const mockConfig = { get: jest.fn() };
const mockTelegramService = {
  configured: true,
  isChatAllowed: jest.fn().mockReturnValue(true),
  getAllowedChatIds: jest.fn().mockReturnValue(["111"]),
  persistInbound: jest.fn(),
  sendMessage: jest.fn(),
  answerCallbackQuery: jest.fn(),
  setupWebhook: jest.fn(),
  getWebhookInfo: jest.fn(),
  getLastDeliveredAt: jest.fn(),
  retrySend: jest.fn(),
};
const mockCommandService = {
  handleToday: jest.fn(),
  handleStatus: jest.fn(),
  handleRuns: jest.fn(),
  handleShopify: jest.fn(),
  handleSales: jest.fn(),
  handleResearch: jest.fn(),
  handleOpportunities: jest.fn(),
  handleNaturalLanguage: jest.fn(),
  handleCallbackQuery: jest.fn(),
};
const mockPrisma = {
  processedTelegramUpdate: {
    create: jest.fn(),
  },
};

function makeMessageUpdate(updateId: number, text: string, chatId = 111) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: chatId, type: "private" },
      text,
    },
  };
}

describe("TelegramController", () => {
  let controller: TelegramController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelegramController],
      providers: [
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TelegramService, useValue: mockTelegramService },
        { provide: TelegramCommandService, useValue: mockCommandService },
      ],
    }).compile();
    controller = module.get<TelegramController>(TelegramController);
    jest.clearAllMocks();

    mockConfig.get.mockImplementation((key: string, def?: string) => {
      const cfg: Record<string, string> = {
        NODE_ENV: "production",
        TELEGRAM_WEBHOOK_SECRET: "secret123",
      };
      return cfg[key] ?? def ?? "";
    });
    mockTelegramService.isChatAllowed.mockReturnValue(true);
    mockPrisma.processedTelegramUpdate.create.mockResolvedValue({});
    mockTelegramService.persistInbound.mockResolvedValue(undefined);
    mockCommandService.handleToday.mockResolvedValue(undefined);
  });

  describe("handleWebhook", () => {
    it("rejects with 401 when webhook secret mismatch", async () => {
      await expect(
        controller.handleWebhook(
          makeMessageUpdate(1, "/today"),
          "wrong-secret",
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("accepts when webhook secret matches", async () => {
      const result = await controller.handleWebhook(
        makeMessageUpdate(1, "/today"),
        "secret123",
      );
      expect(result).toEqual({ ok: true });
    });

    it("deduplicates: second call with same update_id returns ok without processing", async () => {
      // First call succeeds
      mockPrisma.processedTelegramUpdate.create.mockResolvedValueOnce({});
      await controller.handleWebhook(
        makeMessageUpdate(42, "/today"),
        "secret123",
      );
      expect(mockCommandService.handleToday).toHaveBeenCalledTimes(1);

      // Second call — unique constraint violation
      mockPrisma.processedTelegramUpdate.create.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );
      const result = await controller.handleWebhook(
        makeMessageUpdate(42, "/today"),
        "secret123",
      );
      expect(result).toEqual({ ok: true });
      // Command must NOT be called a second time
      expect(mockCommandService.handleToday).toHaveBeenCalledTimes(1);
    });

    it("routes /today to handleToday", async () => {
      await controller.handleWebhook(
        makeMessageUpdate(1, "/today"),
        "secret123",
      );
      expect(mockCommandService.handleToday).toHaveBeenCalledWith("111");
    });

    it("routes /research to handleResearch", async () => {
      mockCommandService.handleResearch.mockResolvedValue(undefined);
      await controller.handleWebhook(
        makeMessageUpdate(2, "/research"),
        "secret123",
      );
      expect(mockCommandService.handleResearch).toHaveBeenCalledWith("111");
    });

    it("routes free text to handleNaturalLanguage", async () => {
      mockCommandService.handleNaturalLanguage.mockResolvedValue(undefined);
      await controller.handleWebhook(
        makeMessageUpdate(3, "What should we do?"),
        "secret123",
      );
      expect(mockCommandService.handleNaturalLanguage).toHaveBeenCalledWith(
        "111",
        "What should we do?",
      );
    });

    it("blocks updates from unauthorized chat IDs", async () => {
      mockTelegramService.isChatAllowed.mockReturnValue(false);
      await controller.handleWebhook(
        makeMessageUpdate(4, "/today", 999),
        "secret123",
      );
      expect(mockCommandService.handleToday).not.toHaveBeenCalled();
    });

    it("routes valid approval callback to handleCallbackQuery", async () => {
      mockCommandService.handleCallbackQuery.mockResolvedValue(undefined);
      const update = {
        update_id: 5,
        callback_query: {
          id: "cq-001",
          from: { id: 111 },
          message: { chat: { id: 111 } },
          data: "approval:appr-001:APPROVED",
        },
      };
      await controller.handleWebhook(update as any, "secret123");
      expect(mockCommandService.handleCallbackQuery).toHaveBeenCalledWith(
        "cq-001",
        "111",
        "approval:appr-001:APPROVED",
      );
    });

    it("answers Unknown action for invalid callback data without routing", async () => {
      const update = {
        update_id: 6,
        callback_query: {
          id: "cq-002",
          from: { id: 111 },
          message: { chat: { id: 111 } },
          data: "garbage",
        },
      };
      mockTelegramService.answerCallbackQuery.mockResolvedValue(undefined);
      await controller.handleWebhook(update as any, "secret123");
      expect(mockTelegramService.answerCallbackQuery).toHaveBeenCalledWith(
        "cq-002",
        "Unknown action",
      );
      expect(mockCommandService.handleCallbackQuery).not.toHaveBeenCalled();
    });
  });

  describe("simulateUpdate (dev/simulate)", () => {
    it("blocked in production", async () => {
      await expect(
        controller.simulateUpdate(makeMessageUpdate(10, "/today")),
      ).rejects.toThrow(ForbiddenException);
    });

    it("allowed in development", async () => {
      mockConfig.get.mockImplementation((key: string, def?: string) => {
        if (key === "NODE_ENV") return "development";
        return def ?? "";
      });
      const result = await controller.simulateUpdate(
        makeMessageUpdate(10, "/today"),
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe("setupWebhook", () => {
    it("blocked in production", async () => {
      await expect(
        controller.setupWebhook({ url: "https://example.com/webhook" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("allowed in development", async () => {
      mockConfig.get.mockImplementation((key: string, def?: string) => {
        if (key === "NODE_ENV") return "development";
        return def ?? "";
      });
      mockTelegramService.setupWebhook.mockResolvedValue(undefined);
      const result = await controller.setupWebhook({
        url: "https://example.com/webhook",
      });
      expect(result).toEqual({ ok: true });
      expect(mockTelegramService.setupWebhook).toHaveBeenCalledWith(
        "https://example.com/webhook",
      );
    });
  });
});
