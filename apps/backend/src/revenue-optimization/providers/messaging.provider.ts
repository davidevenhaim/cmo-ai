export interface SendMessageOptions {
  to: string;
  body: string;
  mediaUrl?: string;
}

export interface SendMessageResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  // Failure classification: FAILED = confirmed not delivered to provider;
  // UNKNOWN = request may have reached the provider but the outcome is
  // unverified (timeout/lost response) — never blind-retry UNKNOWN.
  outcome?: "FAILED" | "UNKNOWN";
}

export interface MessagingProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  send(options: SendMessageOptions): Promise<SendMessageResult>;
}
