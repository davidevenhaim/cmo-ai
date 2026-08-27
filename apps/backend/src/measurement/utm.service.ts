import { Injectable } from "@nestjs/common";
import { UtmParams } from "@ai-cmo/contracts";

// Deterministic campaign tracking. Naming is derived from stable ids —
// Claude never invents attribution parameters, so the same action always
// produces the same UTM set. Original destination URLs are preserved.
@Injectable()
export class UtmService {
  buildParams(input: {
    channel: string;
    recommendationId?: string | null;
    briefId?: string | null;
    draftId?: string | null;
  }): UtmParams {
    const source = slug(input.channel) || "unknown";
    const campaignRef = input.recommendationId ?? input.briefId ?? "general";
    const params: UtmParams = {
      utm_source: source,
      utm_medium: mediumFor(input.channel),
      utm_campaign: `cmo-${slug(campaignRef)}`,
    };
    if (input.draftId) params.utm_content = slug(input.draftId);
    return params;
  }

  // Appends UTM params without destroying the original URL, existing query
  // parameters or fragment. Existing utm_* values are left untouched.
  applyToUrl(url: string, params: UtmParams): string {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return url;
    }
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (!parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, value);
      }
    }
    return parsed.toString();
  }

  campaignForRecommendation(recommendationId: string): string {
    return `cmo-${slug(recommendationId)}`;
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function mediumFor(channel: string): string {
  switch (channel.toUpperCase()) {
    case "BLOG":
      return "organic-content";
    case "EMAIL":
      return "email";
    case "WHATSAPP":
      return "messaging";
    case "INSTAGRAM":
    case "FACEBOOK":
    case "LINKEDIN":
    case "X":
    case "REDDIT":
      return "organic-social";
    default:
      return "referral";
  }
}
