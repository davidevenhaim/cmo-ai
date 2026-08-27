import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { firstValueFrom } from "rxjs";
import { classifyRemoteError } from "../../publishing/content-publisher.interface";
import type {
  MessagingProvider,
  SendMessageOptions,
  SendMessageResult,
} from "./messaging.provider";

@Injectable()
export class WahaMessagingProvider implements MessagingProvider {
  readonly providerName = "waha";
  private readonly logger = new Logger(WahaMessagingProvider.name);
  private readonly baseUrl: string;
  private readonly session: string;

  constructor(private readonly http: HttpService) {
    this.baseUrl = process.env.WAHA_BASE_URL ?? "";
    this.session = process.env.WAHA_SESSION ?? "default";
  }

  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  async send(options: SendMessageOptions): Promise<SendMessageResult> {
    try {
      const response = await firstValueFrom(
        this.http.post(`${this.baseUrl}/api/sendText`, {
          session: this.session,
          chatId: `${options.to}@c.us`,
          text: options.body,
        }),
      );
      const data = response.data as any;
      return {
        success: true,
        providerMessageId: data?.id ?? data?.key?.id ?? String(Date.now()),
      };
    } catch (err: any) {
      this.logger.warn(`WAHA send failed: ${err.message}`);
      return {
        success: false,
        error: err.message,
        outcome: classifyRemoteError(err),
      };
    }
  }
}
