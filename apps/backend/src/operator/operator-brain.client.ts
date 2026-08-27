import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { z } from "zod";
import {
  OperatorIntentSchema,
  OperatorIntentProposal,
  OperatorPrioritization,
  OperatorPrioritizationSchema,
  SuggestedAction,
} from "@ai-cmo/contracts";

// Brain may legitimately return intent null (no supported intent fits) — this
// is looser than the contracts proposal schema, which requires a valid intent.
const RawIntentResponseSchema = z.object({
  intent: z.string().nullable(),
  params: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1),
  clarification: z.string().nullable().optional(),
});

export type BrainIntentResponse = z.infer<typeof RawIntentResponseSchema>;

@Injectable()
export class OperatorBrainClient {
  private readonly logger = new Logger(OperatorBrainClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.config.get<string>("BRAIN_URL", "http://localhost:8000");
  }

  private get timeoutMs(): number {
    return parseInt(this.config.get<string>("BRAIN_TIMEOUT_MS") ?? "30000");
  }

  async prioritize(input: {
    brandName: string | null;
    facts: string[];
    candidateActions: SuggestedAction[];
  }): Promise<OperatorPrioritization> {
    const response = await firstValueFrom(
      this.http.post(`${this.baseUrl}/brain/operator/prioritize`, input, {
        timeout: this.timeoutMs,
      }),
    );
    const parsed = OperatorPrioritizationSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new Error(
        `Brain prioritization failed schema validation: ${JSON.stringify(parsed.error.format())}`,
      );
    }
    // Defense in depth: drop ids not in the candidate set (brain also filters)
    const candidateIds = new Set(input.candidateActions.map((a) => a.id));
    return {
      ...parsed.data,
      prioritized: parsed.data.prioritized.filter((p) =>
        candidateIds.has(p.id),
      ),
    };
  }

  async classifyIntent(text: string): Promise<BrainIntentResponse> {
    const response = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/brain/operator/intent`,
        { text, supportedIntents: OperatorIntentSchema.options },
        { timeout: this.timeoutMs },
      ),
    );
    const parsed = RawIntentResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new Error(
        `Brain intent proposal failed schema validation: ${JSON.stringify(parsed.error.format())}`,
      );
    }
    return parsed.data;
  }

  toValidatedProposal(raw: BrainIntentResponse): OperatorIntentProposal | null {
    if (raw.intent === null) return null;
    const intentParsed = OperatorIntentSchema.safeParse(raw.intent);
    if (!intentParsed.success) {
      this.logger.warn(`Brain proposed unsupported intent: ${raw.intent}`);
      return null;
    }
    return {
      intent: intentParsed.data,
      params: raw.params,
      confidence: raw.confidence,
      clarification: raw.clarification ?? null,
    };
  }
}
