import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CronJob } from "cron";
import { CmoService } from "../cmo/cmo.service";
import { TelegramService } from "./telegram.service";
import { ResearchService } from "../research/research.service";
import { OpportunityService } from "../research/opportunity.service";

@Injectable()
export class TelegramBriefService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBriefService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly cmoService: CmoService,
    private readonly telegramService: TelegramService,
    private readonly researchService: ResearchService,
    private readonly opportunityService: OpportunityService,
  ) {}

  onModuleInit() {
    if (!this.telegramService.configured) {
      this.logger.warn(
        "TELEGRAM_BOT_TOKEN not set — daily brief scheduler disabled",
      );
      return;
    }

    const cronExpr = this.config.get<string>(
      "TELEGRAM_BRIEF_CRON",
      "0 9 * * *",
    );

    try {
      const job = new CronJob(cronExpr, () => {
        this.sendDailyBrief().catch((err) =>
          this.logger.error("Daily brief failed", err),
        );
      });
      job.start();
      this.logger.log(`Daily brief scheduled: ${cronExpr}`);
    } catch (err: any) {
      this.logger.error(`Invalid TELEGRAM_BRIEF_CRON expression: ${cronExpr}`);
    }
  }

  async sendDailyBrief(): Promise<void> {
    const chatIds = this.telegramService.getAllowedChatIds();
    if (chatIds.length === 0) {
      this.logger.warn("No allowed chat IDs configured — skipping daily brief");
      return;
    }

    this.logger.log("Generating daily CMO brief...");
    const [{ run, approval }, opportunities] = await Promise.all([
      this.cmoService.triggerRun("schedule"),
      this.opportunityService
        .getTopForContext("luminesce-brand-001", 3)
        .catch(() => []),
    ]);

    const text = buildBriefText(run, opportunities);

    for (const chatId of chatIds) {
      try {
        await this.telegramService.sendMessage(chatId, text);
        if (approval) {
          await this.sendApprovalButtons(chatId, approval);
        }
      } catch (err: any) {
        this.logger.error(
          `Failed to send brief to chatId ${chatId}: ${err.message}`,
        );
      }
    }
  }

  private async sendApprovalButtons(
    chatId: string,
    approval: any,
  ): Promise<void> {
    await this.telegramService.sendMessage(
      chatId,
      `🔔 <b>Action required:</b> ${approval.subject}`,
      {
        approvalId: approval.id,
        replyMarkup: {
          inline_keyboard: [
            [
              {
                text: "✅ Approve",
                callback_data: `approval:${approval.id}:APPROVED`,
              },
              {
                text: "❌ Reject",
                callback_data: `approval:${approval.id}:REJECTED`,
              },
            ],
          ],
        },
      },
    );
  }
}

function buildBriefText(run: any, opportunities: any[] = []): string {
  const date = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const payload = run.decisionPayload as any;
  const confidence = Math.round(run.confidence * 100);

  const lines = [
    `📋 <b>Daily CMO Brief — ${date}</b>`,
    "",
    `Decision: <b>${run.decisionType}</b>`,
  ];

  if (payload?.topic) lines.push(`Topic: ${payload.topic}`);
  if (payload?.campaignName) lines.push(`Campaign: ${payload.campaignName}`);
  if (payload?.reason) lines.push(`Reason: ${payload.reason}`);

  lines.push("", run.rationale, "", `<i>Confidence: ${confidence}%</i>`);

  if (opportunities.length > 0) {
    lines.push("", "💡 <b>Top opportunity:</b>");
    const top = opportunities[0];
    lines.push(
      `${top.type}: ${top.title.slice(0, 80)}`,
      `<i>${top.reason.slice(0, 120)}</i>`,
    );
  }

  if (run.failed) {
    return `⚠️ <b>Daily brief — brain error</b>\n\n${run.rationale}`;
  }

  return lines.join("\n");
}
