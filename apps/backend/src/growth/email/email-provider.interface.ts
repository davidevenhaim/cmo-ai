export type EmailEventType =
  | "SENT"
  | "DELIVERED"
  | "OPENED"
  | "CLICKED"
  | "BOUNCED"
  | "COMPLAINED"
  | "UNSUBSCRIBED";

export interface NormalizedEmailEvent {
  type: EmailEventType;
  messageId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface EmailSendDto {
  campaignId?: string;
  executionId?: string;
  contactId?: string;
  to: string;
  subject: string;
  previewText?: string;
  body: string;
  callToAction?: string;
}

export interface EmailSendResult {
  messageId: string;
  providerMessageId?: string;
  status: "QUEUED" | "SENT" | "FAILED";
  error?: string;
}

export interface ProviderStatus {
  healthy: boolean;
  name: string;
  message?: string;
}

// Provider-neutral email delivery interface.
// Not every provider supports every optional method.
export interface EmailProvider {
  readonly name: string;

  status(): Promise<ProviderStatus>;

  send(dto: EmailSendDto): Promise<EmailSendResult>;

  // Optional — providers that support bulk sends
  batchSend?(dtos: EmailSendDto[]): Promise<EmailSendResult[]>;

  // Optional — pull delivery status for a sent message
  getDeliveryStatus?(messageId: string): Promise<NormalizedEmailEvent | null>;

  // Optional — normalize inbound webhook payload to our event model
  normalizeWebhookEvent?(payload: unknown): NormalizedEmailEvent | null;
}
