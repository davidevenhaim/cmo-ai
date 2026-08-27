export interface HealthResult {
  healthy: boolean;
  message?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export type PublicationStatus = "DRAFT" | "LIVE" | "UNKNOWN" | "FAILED";

export interface PublishResult {
  remoteId?: string;
  remoteUrl?: string;
  status: PublicationStatus;
  metadata?: Record<string, unknown>;
  error?: string;
}

// UNKNOWN: provider may have accepted the request but the outcome is
// unverified (lost response/timeout). Requires reconciliation or operator
// review — never blind retry.
export type PublishRequestStatus =
  "PENDING" | "APPROVED" | "EXECUTING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";

// Classify a transport error from a provider call:
// - remote responded with an error (HTTP status received) → confirmed "FAILED"
// - request was sent but no response arrived (timeout/reset) → "UNKNOWN"
//   (the remote may have accepted the request)
// - request never left (setup/config error) → "FAILED"
export function classifyRemoteError(err: unknown): "FAILED" | "UNKNOWN" {
  const e = err as {
    response?: unknown;
    request?: unknown;
    code?: string;
  } | null;
  if (e?.response) return "FAILED";
  if (
    e?.request ||
    ["ETIMEDOUT", "ECONNABORTED", "ECONNRESET", "EPIPE"].includes(e?.code ?? "")
  ) {
    return "UNKNOWN";
  }
  return "FAILED";
}

// Provider-neutral publishing interface.
// Implementors: WordPressPublisher, SocialPublisher, etc.
// Providers need not implement every method — throw NotImplementedError for unsupported ops.
export interface ContentPublisher {
  readonly provider: string;

  health(): Promise<HealthResult>;

  validateDraft(
    draftContent: Record<string, unknown>,
    providerMetadata?: Record<string, unknown>,
  ): Promise<ValidationResult>;

  createRemoteDraft(
    draftContent: Record<string, unknown>,
    providerMetadata?: Record<string, unknown>,
  ): Promise<PublishResult>;

  updateRemoteDraft(
    remoteId: string,
    draftContent: Record<string, unknown>,
    providerMetadata?: Record<string, unknown>,
  ): Promise<PublishResult>;

  publish(
    remoteId: string,
    providerMetadata?: Record<string, unknown>,
  ): Promise<PublishResult>;

  getPublication(remoteId: string): Promise<PublishResult | null>;
}
