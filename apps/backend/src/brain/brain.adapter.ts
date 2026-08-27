import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import {
  CmoRunResultSchema,
  CmoRunResult,
  BrandContext,
} from "@ai-cmo/contracts";

export interface IBrainAdapter {
  callBrain(context: BrandContext): Promise<CmoRunResult>;
}

@Injectable()
export class BrainAdapter implements IBrainAdapter {
  private readonly logger = new Logger(BrainAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async callBrain(context: BrandContext): Promise<CmoRunResult> {
    const brainUrl = this.config.get<string>(
      "BRAIN_URL",
      "http://localhost:8000",
    );
    const timeoutMs = parseInt(
      this.config.get<string>("BRAIN_TIMEOUT_MS") ?? "30000",
    );
    const response = await firstValueFrom(
      this.http.post(
        `${brainUrl}/brain/run`,
        { context },
        { timeout: timeoutMs },
      ),
    );
    const parsed = CmoRunResultSchema.safeParse(response.data);
    if (!parsed.success) {
      this.logger.error("Brain returned invalid schema", parsed.error.format());
      throw new Error(
        `Brain response failed schema validation: ${JSON.stringify(parsed.error.format())}`,
      );
    }
    return parsed.data;
  }
}
