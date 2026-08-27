import { Test, TestingModule } from "@nestjs/testing";
import { BrainAdapter } from "./brain.adapter";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of } from "rxjs";

const mockHttp = { post: jest.fn() };
const mockConfig = { get: jest.fn().mockReturnValue("http://brain:8000") };

describe("BrainAdapter", () => {
  let adapter: BrainAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrainAdapter,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    adapter = module.get<BrainAdapter>(BrainAdapter);
    jest.clearAllMocks();
  });

  it("throws when brain returns invalid schema", async () => {
    mockHttp.post.mockReturnValue(of({ data: { invalid: true } }));
    await expect(adapter.callBrain({} as any)).rejects.toThrow(
      "Brain response failed schema validation",
    );
  });

  it("returns parsed result for valid brain response", async () => {
    const validResult = {
      decisionType: "CREATE_CONTENT",
      decisionPayload: {
        type: "CREATE_CONTENT",
        contentType: "blog_post",
        topic: "Barrier repair basics",
        keyMessages: ["Ceramides restore barrier"],
        targetAudience: "Women 28-45 with sensitive skin",
        suggestedChannels: ["instagram", "email"],
      },
      rationale:
        "Brand has strong barrier repair product. Content gap identified.",
      evidenceRefs: ["fact-ingredient-philosophy-001"],
      confidence: 0.85,
      modelId: "claude-sonnet-4-6",
      durationMs: 1200,
    };
    mockHttp.post.mockReturnValue(of({ data: validResult }));
    const result = await adapter.callBrain({} as any);
    expect(result.decisionType).toBe("CREATE_CONTENT");
    expect(result.confidence).toBe(0.85);
  });
});
