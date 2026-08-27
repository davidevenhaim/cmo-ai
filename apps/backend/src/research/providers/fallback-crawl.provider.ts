import { Injectable, Logger } from "@nestjs/common";
import type { CrawlProvider, ExtractResult } from "./crawl.provider";

/**
 * Tries primary crawl providers in order; first success wins.
 * Failures do not fabricate evidence — empty/throw propagates if all fail.
 */
@Injectable()
export class FallbackCrawlProvider implements CrawlProvider {
  readonly name = "fallback";
  private readonly logger = new Logger(FallbackCrawlProvider.name);

  constructor(private readonly chain: CrawlProvider[]) {}

  get configured(): boolean {
    return this.chain.some((p) => p.configured);
  }

  get providers(): string[] {
    return this.chain.filter((p) => p.configured).map((p) => p.name);
  }

  async extract(url: string): Promise<ExtractResult> {
    const configured = this.chain.filter((p) => p.configured);
    if (configured.length === 0) {
      throw new Error("No crawl provider configured");
    }

    const errors: string[] = [];
    for (const provider of configured) {
      try {
        const result = await provider.extract(url);
        if (result.content?.trim()) {
          return {
            ...result,
            metadata: {
              ...result.metadata,
              // provenance for research persistence
              ...({ crawlProvider: provider.name } as any),
            },
          };
        }
        errors.push(`${provider.name}: empty content`);
      } catch (err: any) {
        this.logger.warn(
          `Crawl provider ${provider.name} failed for ${url}: ${err.message}`,
        );
        errors.push(`${provider.name}: ${err.message}`);
      }
    }

    throw new Error(
      `All crawl providers failed for ${url}: ${errors.join("; ")}`,
    );
  }
}
