import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";
import { ContentBrainAdapter } from "./content-brain.adapter";
import {
  type ContentGenerationRequest,
  type ContentCriticRequest,
} from "@ai-cmo/contracts";

const BASE_URL = "http://brain:8000";

const mockHttp = {
  post: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string, fallback?: string) => {
    if (key === "BRAIN_URL") return BASE_URL;
    if (key === "BRAIN_TIMEOUT_MS") return "30000";
    return fallback;
  }),
};

const validGeneratedContent = {
  channel: "INSTAGRAM",
  format: "POST",
  caption: "Test caption",
  hashtags: ["#skincare"],
  callToAction: "Shop now",
};

const validCriticEvaluation = {
  brandFit: 0.9,
  channelFit: 0.85,
  evidenceAlignment: 0.8,
  clarity: 0.9,
  originality: 0.75,
  promotionalIntensity: 0.8,
  claimRisk: 1.0,
  ctaQuality: 0.85,
  overall: 0.85,
  issues: [],
  passesReview: true,
};

const genRequest: ContentGenerationRequest = {
  brief: {
    objective: "Drive awareness",
    topic: "Barrier repair",
    angle: "Science-first",
    targetAudience: "Women 28-45",
    channel: "INSTAGRAM",
    format: "POST",
    keyMessage: "Ceramides repair skin barrier",
    tone: "educational",
    constraints: [],
  },
  brandContext: {
    name: "Luminesce",
    guidelines: [],
    activeProducts: [],
  },
  evidence: {
    brandFacts: ["Founded by a biochemist"],
    researchFindings: [],
  },
};

const critiqueRequest: ContentCriticRequest = {
  content: validGeneratedContent as any,
  brief: genRequest.brief,
  brandContext: genRequest.brandContext,
};

describe("ContentBrainAdapter", () => {
  let adapter: ContentBrainAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentBrainAdapter,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    adapter = module.get<ContentBrainAdapter>(ContentBrainAdapter);
    jest.clearAllMocks();
  });

  // --- generate() ---

  describe("generate()", () => {
    it("calls correct brain endpoint with request body", async () => {
      mockHttp.post.mockReturnValue(
        of({
          data: validGeneratedContent,
          status: 200,
          headers: {},
          config: {},
          statusText: "OK",
        }),
      );

      await adapter.generate(genRequest);

      expect(mockHttp.post).toHaveBeenCalledWith(
        `${BASE_URL}/brain/content/generate`,
        genRequest,
        expect.objectContaining({ timeout: 30000 }),
      );
    });

    it("returns parsed GeneratedContent on success", async () => {
      mockHttp.post.mockReturnValue(of({ data: validGeneratedContent }));

      const result = await adapter.generate(genRequest);

      expect(result.channel).toBe("INSTAGRAM");
      expect(result.format).toBe("POST");
      expect(result.caption).toBe("Test caption");
    });

    it("throws when brain returns invalid schema", async () => {
      mockHttp.post.mockReturnValue(
        of({ data: { channel: "INSTAGRAM" /* missing format */ } }),
      );

      await expect(adapter.generate(genRequest)).rejects.toThrow(
        /schema validation/,
      );
    });

    it("throws when channel value is invalid", async () => {
      mockHttp.post.mockReturnValue(
        of({ data: { ...validGeneratedContent, channel: "TIKTOK" } }),
      );

      await expect(adapter.generate(genRequest)).rejects.toThrow(
        /schema validation/,
      );
    });

    it("propagates HTTP timeout error", async () => {
      mockHttp.post.mockReturnValue(
        throwError(() =>
          Object.assign(new Error("timeout"), { code: "ECONNABORTED" }),
        ),
      );

      await expect(adapter.generate(genRequest)).rejects.toThrow("timeout");
    });

    it("propagates brain 500 error", async () => {
      mockHttp.post.mockReturnValue(
        throwError(() =>
          Object.assign(new Error("Request failed with status 500"), {
            response: { status: 500 },
          }),
        ),
      );

      await expect(adapter.generate(genRequest)).rejects.toThrow("500");
    });
  });

  // --- critique() ---

  describe("critique()", () => {
    it("calls correct brain endpoint with request body", async () => {
      mockHttp.post.mockReturnValue(of({ data: validCriticEvaluation }));

      await adapter.critique(critiqueRequest);

      expect(mockHttp.post).toHaveBeenCalledWith(
        `${BASE_URL}/brain/content/critique`,
        critiqueRequest,
        expect.objectContaining({ timeout: 30000 }),
      );
    });

    it("returns parsed CriticEvaluation on success", async () => {
      mockHttp.post.mockReturnValue(of({ data: validCriticEvaluation }));

      const result = await adapter.critique(critiqueRequest);

      expect(result.overall).toBe(0.85);
      expect(result.passesReview).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it("throws when brain returns missing score fields", async () => {
      mockHttp.post.mockReturnValue(
        of({ data: { overall: 0.85 /* missing other fields */ } }),
      );

      await expect(adapter.critique(critiqueRequest)).rejects.toThrow(
        /schema validation/,
      );
    });

    it("throws when score is out of 0-1 range", async () => {
      mockHttp.post.mockReturnValue(
        of({
          data: { ...validCriticEvaluation, overall: 1.5 /* invalid */ },
        }),
      );

      await expect(adapter.critique(critiqueRequest)).rejects.toThrow(
        /schema validation/,
      );
    });

    it("propagates HTTP timeout on critique", async () => {
      mockHttp.post.mockReturnValue(
        throwError(() => new Error("timeout exceeded")),
      );

      await expect(adapter.critique(critiqueRequest)).rejects.toThrow(
        "timeout",
      );
    });

    it("propagates brain 500 on critique", async () => {
      mockHttp.post.mockReturnValue(
        throwError(() => new Error("Request failed with status 500")),
      );

      await expect(adapter.critique(critiqueRequest)).rejects.toThrow("500");
    });
  });

  // --- config ---

  describe("config", () => {
    it("uses BRAIN_URL from config", async () => {
      mockConfig.get.mockImplementation((key: string, fallback?: string) => {
        if (key === "BRAIN_URL") return "http://custom-brain:9000";
        if (key === "BRAIN_TIMEOUT_MS") return "30000";
        return fallback;
      });
      mockHttp.post.mockReturnValue(of({ data: validGeneratedContent }));

      await adapter.generate(genRequest);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "http://custom-brain:9000/brain/content/generate",
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
