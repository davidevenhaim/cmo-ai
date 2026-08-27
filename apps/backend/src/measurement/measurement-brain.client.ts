import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { z } from "zod";

// Interpretation only — every number in the facts is computed deterministically
// by NestJS before Claude sees it. Claude never invents or adjusts figures.
const WeeklyInterpretationSchema = z.object({
  headline: z.string(),
  narrative: z.string(),
});

export type WeeklyInterpretation = z.infer<typeof WeeklyInterpretationSchema>;

@Injectable()
export class MeasurementBrainClient {
  private readonly logger = new Logger(MeasurementBrainClient.name);

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

  async interpretWeekly(input: {
    brandName: string | null;
    facts: string[];
  }): Promise<WeeklyInterpretation> {
    const response = await firstValueFrom(
      this.http.post(`${this.baseUrl}/brain/measurement/weekly-review`, input, {
        timeout: this.timeoutMs,
      }),
    );
    const parsed = WeeklyInterpretationSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new Error(
        `Brain weekly interpretation failed schema validation: ${JSON.stringify(parsed.error.format())}`,
      );
    }
    return parsed.data;
  }
}
