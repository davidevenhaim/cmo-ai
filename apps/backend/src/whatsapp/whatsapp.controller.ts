import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SendManualReplySchema } from "@ai-cmo/contracts";
import {
  AutomationError,
  WhatsAppAutomationService,
} from "./whatsapp-automation.service";
import {
  BroadcastError,
  WhatsAppBroadcastService,
} from "./whatsapp-broadcast.service";
import { WhatsAppContextService } from "./whatsapp-context.service";
import {
  WhatsAppInboxService,
  WhatsAppSendError,
} from "./whatsapp-inbox.service";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import {
  TemplateValidationError,
  WhatsAppTemplateService,
} from "./whatsapp-template.service";

@Controller("whatsapp")
export class WhatsAppController {
  constructor(
    private readonly session: WhatsAppSessionService,
    private readonly inbox: WhatsAppInboxService,
    private readonly templates: WhatsAppTemplateService,
    private readonly broadcasts: WhatsAppBroadcastService,
    private readonly automations: WhatsAppAutomationService,
    private readonly context: WhatsAppContextService,
  ) {}

  // --- Connection (B1) -----------------------------------------------------

  @Get("connection")
  async connection() {
    return this.session.getConnection();
  }

  @Post("connection/connect")
  async connect() {
    return this.session.connect();
  }

  @Post("connection/reconnect")
  async reconnect() {
    return this.session.reconnect();
  }

  @Post("connection/disconnect")
  async disconnect() {
    return this.session.disconnect();
  }

  @Get("connection/qr")
  async qr() {
    return this.session.getQr();
  }

  // --- Inbox (B2) ----------------------------------------------------------

  @Get("conversations")
  async conversations(@Query("take") take?: string) {
    const n = take ? parseInt(take, 10) : 100;
    return this.inbox.listConversations(undefined, Number.isFinite(n) ? n : 100);
  }

  @Post("conversations/sync")
  async syncConversations() {
    const synced = await this.inbox.syncConversations();
    return { synced };
  }

  @Get("conversations/:id")
  async conversation(@Param("id") id: string) {
    const result = await this.inbox.getConversation(id);
    if (!result) throw new NotFoundException("Conversation not found");
    return result;
  }

  @Post("conversations/:id/reply")
  async reply(@Param("id") id: string, @Body() body: unknown) {
    const parsed = SendManualReplySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invalid reply",
        details: parsed.error.flatten(),
      });
    }
    try {
      return await this.inbox.sendManualReply(id, parsed.data.body);
    } catch (err) {
      if (err instanceof WhatsAppSendError) {
        if (err.code === "NOT_CONNECTED") {
          throw new ServiceUnavailableException(err.message);
        }
        // An ambiguous outcome is surfaced as a conflict so the UI tells the
        // owner to check WhatsApp rather than offering a retry button.
        if (err.code === "SEND_UNKNOWN") throw new ConflictException(err.message);
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  // --- Templates (B4) ------------------------------------------------------

  @Get("templates")
  async listTemplates() {
    await this.templates.ensureDefaults();
    return this.templates.list();
  }

  @Post("templates")
  async createTemplate(@Body() body: unknown) {
    try {
      return await this.templates.create(body);
    } catch (err) {
      if (err instanceof TemplateValidationError) {
        throw new BadRequestException({
          message: err.message,
          details: err.details,
        });
      }
      throw err;
    }
  }

  @Patch("templates/:id")
  async updateTemplate(@Param("id") id: string, @Body() body: unknown) {
    try {
      return await this.templates.update(id, body);
    } catch (err) {
      if (err instanceof TemplateValidationError) {
        throw new BadRequestException({
          message: err.message,
          details: err.details,
        });
      }
      throw err;
    }
  }

  @Delete("templates/:id")
  async deleteTemplate(@Param("id") id: string) {
    try {
      return await this.templates.remove(id);
    } catch (err) {
      if (err instanceof TemplateValidationError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }

  @Post("templates/preview")
  async previewTemplate(
    @Body() body: { body?: string; variables?: Record<string, unknown> },
  ) {
    if (!body?.body) throw new BadRequestException("body is required");
    return this.templates.render(body.body, (body.variables ?? {}) as any);
  }

  // --- Broadcasts (B3) -----------------------------------------------------

  @Get("broadcasts")
  async listBroadcasts() {
    return this.broadcasts.list();
  }

  @Post("broadcasts")
  async createBroadcast(@Body() body: unknown) {
    return this.wrapBroadcast(() => this.broadcasts.create(body));
  }

  @Get("broadcasts/:id")
  async getBroadcast(@Param("id") id: string) {
    const b = await this.broadcasts.get(id);
    if (!b) throw new NotFoundException("Broadcast not found");
    return b;
  }

  @Post("broadcasts/:id/dry-run")
  async dryRun(@Param("id") id: string) {
    return this.wrapBroadcast(() => this.broadcasts.dryRun(id));
  }

  @Post("broadcasts/:id/confirm")
  async confirmBroadcast(
    @Param("id") id: string,
    @Body() body?: { actor?: string },
  ) {
    return this.wrapBroadcast(() =>
      this.broadcasts.confirm(id, body?.actor ?? "admin"),
    );
  }

  @Post("broadcasts/:id/send")
  async sendBroadcast(@Param("id") id: string) {
    return this.wrapBroadcast(() => this.broadcasts.send(id));
  }

  @Post("broadcasts/:id/cancel")
  async cancelBroadcast(@Param("id") id: string) {
    return this.wrapBroadcast(() => this.broadcasts.cancel(id));
  }

  // --- Automations (Part D) ------------------------------------------------

  @Get("automations")
  async listAutomations() {
    return this.automations.list();
  }

  @Patch("automations/:type")
  async patchAutomation(@Param("type") type: string, @Body() body: unknown) {
    try {
      return await this.automations.patch(type as any, body);
    } catch (err) {
      if (err instanceof AutomationError) {
        throw new BadRequestException({
          message: err.message,
          details: err.details,
        });
      }
      throw err;
    }
  }

  // --- Abandoned carts (C6) + CMO context (Part E) -------------------------

  @Get("abandoned-carts")
  async abandonedCarts() {
    return this.context.getAbandonedCartView();
  }

  @Get("context")
  async whatsappContext() {
    return this.context.build();
  }

  private async wrapBroadcast<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BroadcastError) {
        if (err.code === "NOT_FOUND") throw new NotFoundException(err.message);
        if (err.code === "NOT_CONNECTED") {
          throw new ServiceUnavailableException(err.message);
        }
        if (err.code === "ALREADY_RUNNING") {
          throw new ConflictException(err.message);
        }
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
