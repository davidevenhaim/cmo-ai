import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import {
  ContentGenerationRequestSchema,
  GeneratedContentSchema,
  CriticEvaluationSchema,
  type GeneratedContent,
  type CriticEvaluation,
  type ContentGenerationRequest,
  type ContentCriticRequest,
} from "@ai-cmo/contracts";

@Injectable()
export class ContentBrainAdapter {
  private readonly logger = new Logger(ContentBrainAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get brainUrl(): string {
    return this.config.get<string>("BRAIN_URL", "http://localhost:8000");
  }

  private get timeoutMs(): number {
    return parseInt(this.config.get<string>("BRAIN_TIMEOUT_MS") ?? "30000");
  }

  async generate(req: ContentGenerationRequest): Promise<GeneratedContent> {
    const response = await firstValueFrom(
      this.http.post(`${this.brainUrl}/brain/content/generate`, req, {
        timeout: this.timeoutMs,
      }),
    );
    const parsed = GeneratedContentSchema.safeParse(response.data);
    if (!parsed.success) {
      this.logger.error(
        "Brain generate returned invalid schema",
        parsed.error.format(),
      );
      throw new Error(
        `Brain generate response failed schema validation: ${JSON.stringify(parsed.error.format())}`,
      );
    }
    return parsed.data;
  }

  async critique(req: ContentCriticRequest): Promise<CriticEvaluation> {
    const response = await firstValueFrom(
      this.http.post(`${this.brainUrl}/brain/content/critique`, req, {
        timeout: this.timeoutMs,
      }),
    );
    const parsed = CriticEvaluationSchema.safeParse(response.data);
    if (!parsed.success) {
      this.logger.error(
        "Brain critique returned invalid schema",
        parsed.error.format(),
      );
      throw new Error(
        `Brain critique response failed schema validation: ${JSON.stringify(parsed.error.format())}`,
      );
    }
    return parsed.data;
  }
}
