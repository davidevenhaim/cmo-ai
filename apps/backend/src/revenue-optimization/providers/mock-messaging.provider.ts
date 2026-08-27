import { Injectable } from "@nestjs/common";
import type {
  MessagingProvider,
  SendMessageOptions,
  SendMessageResult,
} from "./messaging.provider";

@Injectable()
export class MockMessagingProvider implements MessagingProvider {
  readonly providerName = "mock";
  readonly sentMessages: Array<{ to: string; body: string; timestamp: Date }> =
    [];

  isConfigured(): boolean {
    return false;
  }

  async send(options: SendMessageOptions): Promise<SendMessageResult> {
    this.sentMessages.push({
      to: options.to,
      body: options.body,
      timestamp: new Date(),
    });
    return { success: true, providerMessageId: `mock-${Date.now()}` };
  }
}
