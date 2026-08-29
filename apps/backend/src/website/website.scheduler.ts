import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { WebsiteAuditService } from "./website-audit.service";
import { WebsiteSettingsService } from "./website-settings.service";

/**
 * Cadence is owner configuration (Website → Settings), so the scheduler ticks
 * hourly and decides whether an audit is actually due. MANUAL never fires.
 */
@Injectable()
export class WebsiteScheduler {
  private readonly logger = new Logger(WebsiteScheduler.name);
  private running = false;

  constructor(
    private readonly settings: WebsiteSettingsService,
    private readonly audits: WebsiteAuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async maybeRunScheduledAudit(): Promise<void> {
    // A Lighthouse pass over N pages can outlast the tick interval.
    if (this.running) return;

    let settings;
    try {
      settings = await this.settings.get();
    } catch (err: any) {
      this.logger.warn(`Website settings unavailable: ${err.message}`);
      return;
    }

    if (settings.cadence === "MANUAL") return;
    if (!settings.websiteUrl && settings.auditUrls.length === 0) return;

    const intervalHours = settings.cadence === "DAILY" ? 24 : 24 * 7;
    const [latest] = await this.audits.listAudits(1);
    if (latest) {
      const ageHours =
        (Date.now() - new Date(latest.startedAt).getTime()) / 3_600_000;
      if (ageHours < intervalHours) return;
    }

    this.running = true;
    try {
      const result = await this.audits.runAudit(
        `scheduled:${settings.cadence.toLowerCase()}`,
      );
      this.logger.log(
        `Scheduled website audit ${result.auditId}: ${result.status} ` +
          `(${result.pagesAudited}/${result.pagesPlanned} pages)`,
      );
    } catch (err: any) {
      this.logger.warn(`Scheduled website audit failed: ${err.message}`);
    } finally {
      this.running = false;
    }
  }
}
