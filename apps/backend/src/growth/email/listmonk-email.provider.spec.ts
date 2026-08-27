import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { ListmonkEmailProvider } from "./listmonk-email.provider";
import { PrismaService } from "../../prisma.service";

describe("ListmonkEmailProvider", () => {
  let provider: ListmonkEmailProvider;
  const mockHttp = { get: jest.fn(), post: jest.fn() };
  const mockPrisma = {
    emailMessage: {
      create: jest.fn().mockResolvedValue({ id: "msg-1" }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const mockConfig = {
    get: jest.fn((key: string, def = "") => {
      const map: Record<string, string> = {
        LISTMONK_BASE_URL: "http://listmonk:9000",
        LISTMONK_USERNAME: "admin",
        LISTMONK_PASSWORD: "secret",
        LISTMONK_FROM_EMAIL: "cmo@example.com",
      };
      return map[key] ?? def;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListmonkEmailProvider,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    provider = module.get(ListmonkEmailProvider);
  });

  it("is configured when credentials present", () => {
    expect(provider.configured).toBe(true);
  });

  it("sends via transactional API after recording EmailMessage", async () => {
    mockHttp.post.mockReturnValue(of({ data: { data: { id: "tx-9" } } }));
    const result = await provider.send({
      to: "a@example.com",
      subject: "Hi",
      body: "Body",
      campaignId: "c1",
      contactId: "ct1",
    });
    expect(result.status).toBe("SENT");
    expect(mockPrisma.emailMessage.create).toHaveBeenCalled();
    expect(mockHttp.post).toHaveBeenCalledWith(
      "http://listmonk:9000/api/tx",
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      }),
    );
    // secrets must not appear in body payload keys as raw password
    const body = mockHttp.post.mock.calls[0][1];
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("returns FAILED on provider error without throwing", async () => {
    mockHttp.post.mockReturnValue(throwError(() => new Error("down")));
    const result = await provider.send({
      to: "a@example.com",
      subject: "Hi",
      body: "Body",
    });
    expect(result.status).toBe("FAILED");
  });
});
