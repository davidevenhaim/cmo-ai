/**
 * Controlled browser actions — Nest decides and validates; LLM only proposes.
 * No unrestricted browser control. No engagement bots / anti-abuse evasion.
 */

export type BrowserActionType =
  "READ_PAGE" | "VERIFY_DRAFT" | "CREATE_DRAFT" | "UPDATE_DRAFT";

export type BrowserActionStatus =
  "SUCCEEDED" | "FAILED" | "NOT_CONFIGURED" | "REJECTED" | "UNSUPPORTED";

export interface BrowserActionRequest {
  type: BrowserActionType;
  url: string;
  /** Draft body / title for create/update/verify — never secrets */
  payload?: {
    title?: string;
    body?: string;
    selectorHints?: string[];
    expectedUrlSubstring?: string;
    expectedTextSubstring?: string;
  };
  /** PublishRequest / ContentDraft ids for provenance */
  subjectType?: string;
  subjectId?: string;
}

export interface BrowserActionResult {
  status: BrowserActionStatus;
  action: BrowserActionType;
  url: string;
  verified: boolean;
  title?: string;
  excerpt?: string;
  finalUrl?: string;
  detail: string;
  startedAt: Date;
  completedAt: Date;
}
