import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import {
  ContentPublisher,
  PublishResult,
  ValidationResult,
} from "./content-publisher.interface";

const BRAND_ID = "luminesce-brand-001";

export interface DryRunResult {
  requestId: string;
  provider: string;
  destination: string;
  draftStatus: string;
  validation: ValidationResult;
  wouldExecute: boolean;
  reason?: string;
}

@Injectable()
export class PublishingService {
  private readonly publishers = new Map<string, ContentPublisher>();

  constructor(private readonly prisma: PrismaService) {}

  registerPublisher(publisher: ContentPublisher): void {
    this.publishers.set(publisher.provider, publisher);
  }

  getPublisher(provider: string): ContentPublisher {
    const p = this.publishers.get(provider);
    if (!p)
      throw new BadRequestException(
        `No publisher registered for provider: ${provider}`,
      );
    return p;
  }

  async createRequest(data: {
    contentDraftId: string;
    provider: string;
    destination: string;
    scheduledAt?: Date;
    providerMetadata?: Record<string, unknown>;
  }) {
    const draft = await this.prisma.contentDraft.findUnique({
      where: { id: data.contentDraftId },
    });
    if (!draft)
      throw new NotFoundException(
        `ContentDraft ${data.contentDraftId} not found`,
      );
    if (draft.status !== "APPROVED") {
      throw new BadRequestException(
        `ContentDraft must be APPROVED to create a PublishRequest (current: ${draft.status})`,
      );
    }

    return this.prisma.publishRequest.create({
      data: {
        brandId: BRAND_ID,
        contentDraftId: data.contentDraftId,
        provider: data.provider,
        destination: data.destination,
        status: "PENDING",
        scheduledAt: data.scheduledAt ?? null,
        providerMetadata: (data.providerMetadata ?? null) as any,
      },
    });
  }

  async schedule(requestId: string, scheduledAt: Date) {
    const req = await this.prisma.publishRequest.findUnique({
      where: { id: requestId },
    });
    if (!req)
      throw new NotFoundException(`PublishRequest ${requestId} not found`);
    if (!["PENDING", "APPROVED"].includes(req.status)) {
      throw new BadRequestException(
        `Cannot schedule PublishRequest in status ${req.status}`,
      );
    }
    return this.prisma.publishRequest.update({
      where: { id: requestId },
      data: { scheduledAt },
    });
  }

  async approve(requestId: string) {
    const req = await this.prisma.publishRequest.findUnique({
      where: { id: requestId },
    });
    if (!req)
      throw new NotFoundException(`PublishRequest ${requestId} not found`);
    if (req.status !== "PENDING") {
      throw new BadRequestException(
        `Cannot approve PublishRequest in status ${req.status}`,
      );
    }

    return this.prisma.publishRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
  }

  async execute(requestId: string): Promise<PublishResult> {
    const req = await this.prisma.publishRequest.findUnique({
      where: { id: requestId },
      include: { publication: true, contentDraft: true },
    });
    if (!req)
      throw new NotFoundException(`PublishRequest ${requestId} not found`);

    // Idempotency: already succeeded — return existing publication
    if (req.status === "SUCCEEDED" && req.publication) {
      return {
        remoteId: req.publication.remoteId ?? undefined,
        remoteUrl: req.publication.remoteUrl ?? undefined,
        status: req.publication.status as any,
        metadata:
          (req.publication.metadata as Record<string, unknown>) ?? undefined,
      };
    }

    if (req.status !== "APPROVED") {
      throw new BadRequestException(
        `Cannot execute PublishRequest in status ${req.status}`,
      );
    }

    // Re-verify draft is still APPROVED at execution time
    if (req.contentDraft.status !== "APPROVED") {
      throw new BadRequestException(
        `ContentDraft is no longer APPROVED (current: ${req.contentDraft.status})`,
      );
    }

    const publisher = this.getPublisher(req.provider);

    // Atomic claim: only one executor wins APPROVED → EXECUTING.
    // Losers see count=0 and never reach the provider.
    const claim = await this.prisma.publishRequest.updateMany({
      where: { id: requestId, status: "APPROVED" },
      data: { status: "EXECUTING" },
    });
    if (claim.count === 0) {
      const current = await this.prisma.publishRequest.findUnique({
        where: { id: requestId },
        include: { publication: true },
      });
      if (current?.status === "SUCCEEDED" && current.publication) {
        return {
          remoteId: current.publication.remoteId ?? undefined,
          remoteUrl: current.publication.remoteUrl ?? undefined,
          status: current.publication.status as any,
          metadata:
            (current.publication.metadata as Record<string, unknown>) ??
            undefined,
        };
      }
      throw new BadRequestException(
        `PublishRequest ${requestId} is already being executed or resolved (current: ${current?.status ?? "unknown"})`,
      );
    }

    let result: PublishResult;
    try {
      const draftContent = req.contentDraft.content as Record<string, unknown>;
      const existingRemoteId = (req.providerMetadata as any)?.remoteId as
        string | undefined;

      // Merge scheduledAt into providerMetadata so publishers can use it for scheduling
      const effectiveMeta: Record<string, unknown> = {
        ...((req.providerMetadata as Record<string, unknown>) ?? {}),
        ...(req.scheduledAt
          ? { scheduledAt: req.scheduledAt.toISOString() }
          : {}),
      };

      if (existingRemoteId) {
        result = await publisher.publish(existingRemoteId, effectiveMeta);
      } else {
        result = await publisher.createRemoteDraft(draftContent, effectiveMeta);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.publishRequest.update({
        where: { id: requestId },
        data: {
          status: "FAILED",
          failureReason: msg,
          retryCount: { increment: 1 },
        },
      });
      await this.upsertPublication(requestId, req.provider, {
        status: "FAILED",
        error: msg,
      });
      throw err;
    }

    // UNKNOWN + known remoteId: attempt one reconciliation lookup before persisting.
    // Never blind-retry the publish call itself.
    if (result.status === "UNKNOWN") {
      const lookupId =
        result.remoteId ??
        ((req.providerMetadata as any)?.remoteId as string | undefined);
      if (lookupId) {
        const reconciled = await publisher
          .getPublication(lookupId)
          .catch(() => null);
        if (reconciled && reconciled.status !== "UNKNOWN") {
          result = { ...reconciled, remoteId: reconciled.remoteId ?? lookupId };
        }
      }
    }

    // Honest provider-result mapping. Never SUCCEEDED from FAILED/UNKNOWN.
    const finalStatus =
      result.status === "FAILED"
        ? "FAILED"
        : result.status === "UNKNOWN"
          ? "UNKNOWN"
          : "SUCCEEDED";

    await this.prisma.publishRequest.update({
      where: { id: requestId },
      data: {
        status: finalStatus,
        executedAt: new Date(),
        providerMetadata: {
          ...((req.providerMetadata as object) ?? {}),
          remoteId: result.remoteId,
        } as any,
        ...(result.status === "FAILED"
          ? {
              failureReason: result.error ?? "Provider reported failure",
              retryCount: { increment: 1 },
            }
          : {}),
        ...(result.status === "UNKNOWN"
          ? {
              failureReason:
                "Remote outcome uncertain — requires reconciliation or operator review",
            }
          : {}),
      },
    });

    await this.upsertPublication(requestId, req.provider, result);

    return result;
  }

  // Operator-triggered reconciliation for UNKNOWN outcomes. Looks up remote
  // state via the provider; never re-sends the publish call.
  async reconcile(requestId: string): Promise<PublishResult> {
    const req = await this.prisma.publishRequest.findUnique({
      where: { id: requestId },
      include: { publication: true },
    });
    if (!req)
      throw new NotFoundException(`PublishRequest ${requestId} not found`);
    if (req.status !== "UNKNOWN") {
      throw new BadRequestException(
        `Only UNKNOWN PublishRequests can be reconciled (current: ${req.status})`,
      );
    }

    const remoteId =
      req.publication?.remoteId ??
      ((req.providerMetadata as any)?.remoteId as string | undefined);
    if (!remoteId) {
      return {
        status: "UNKNOWN",
        error: "No remote identifier available — operator review required",
      };
    }

    const publisher = this.getPublisher(req.provider);
    const remote = await publisher.getPublication(remoteId).catch(() => null);
    if (!remote || remote.status === "UNKNOWN") {
      return {
        status: "UNKNOWN",
        remoteId,
        error: "Remote state still unresolved — operator review required",
      };
    }

    const finalStatus = remote.status === "FAILED" ? "FAILED" : "SUCCEEDED";
    await this.prisma.publishRequest.update({
      where: { id: requestId },
      data: {
        status: finalStatus,
        ...(finalStatus === "FAILED"
          ? { failureReason: remote.error ?? "Reconciled as failed" }
          : { failureReason: null }),
      },
    });
    await this.upsertPublication(requestId, req.provider, remote);
    return remote;
  }

  async cancel(requestId: string) {
    const req = await this.prisma.publishRequest.findUnique({
      where: { id: requestId },
    });
    if (!req)
      throw new NotFoundException(`PublishRequest ${requestId} not found`);
    if (!["PENDING", "APPROVED"].includes(req.status)) {
      throw new BadRequestException(
        `Cannot cancel PublishRequest in status ${req.status}`,
      );
    }

    return this.prisma.publishRequest.update({
      where: { id: requestId },
      data: { status: "FAILED", failureReason: "Cancelled by owner" },
    });
  }

  async dryRun(requestId: string): Promise<DryRunResult> {
    const req = await this.prisma.publishRequest.findUnique({
      where: { id: requestId },
      include: { contentDraft: true },
    });
    if (!req)
      throw new NotFoundException(`PublishRequest ${requestId} not found`);

    const draft = req.contentDraft;
    let validation: ValidationResult = { valid: true, errors: [] };
    let wouldExecute = false;
    let reason: string | undefined;

    if (draft.status !== "APPROVED") {
      reason = `ContentDraft not APPROVED (current: ${draft.status})`;
    } else if (req.status !== "APPROVED") {
      reason = `PublishRequest not APPROVED (current: ${req.status})`;
    } else {
      const publisher = this.publishers.get(req.provider);
      if (!publisher) {
        reason = `No publisher registered for provider: ${req.provider}`;
      } else {
        validation = await publisher.validateDraft(
          draft.content as Record<string, unknown>,
          req.providerMetadata as any,
        );
        wouldExecute = validation.valid;
        if (!validation.valid) reason = validation.errors.join("; ");
      }
    }

    return {
      requestId,
      provider: req.provider,
      destination: req.destination,
      draftStatus: draft.status,
      validation,
      wouldExecute,
      reason,
    };
  }

  // M7.3 — Explicit pre-publish safety check.
  // Returns all blocking reasons as a list; empty = safe to proceed.
  // Called internally before execute; also callable externally for UI pre-flight.
  async safetyCheck(
    requestId: string,
  ): Promise<{ safe: boolean; violations: string[] }> {
    const req = await this.prisma.publishRequest.findUnique({
      where: { id: requestId },
      include: { contentDraft: true, publication: true },
    });
    if (!req)
      return {
        safe: false,
        violations: [`PublishRequest ${requestId} not found`],
      };

    const violations: string[] = [];

    if (!req.contentDraft) violations.push("ContentDraft does not exist");
    else if (req.contentDraft.status !== "APPROVED")
      violations.push(
        `ContentDraft not APPROVED (current: ${req.contentDraft.status})`,
      );

    if (req.status !== "APPROVED")
      violations.push(`PublishRequest not APPROVED (current: ${req.status})`);

    if (req.status === "SUCCEEDED")
      violations.push(
        "PublishRequest already SUCCEEDED — would create duplicate",
      );

    if (!this.publishers.has(req.provider))
      violations.push(`No publisher configured for provider: ${req.provider}`);

    if (req.contentDraft && !req.contentDraft.content)
      violations.push("ContentDraft has no content");

    return { safe: violations.length === 0, violations };
  }

  async getRequest(requestId: string) {
    const req = await this.prisma.publishRequest.findUnique({
      where: { id: requestId },
      include: { publication: true, contentDraft: true },
    });
    if (!req)
      throw new NotFoundException(`PublishRequest ${requestId} not found`);
    return req;
  }

  async listRequests(filters?: {
    status?: string;
    provider?: string;
    contentDraftId?: string;
  }) {
    return this.prisma.publishRequest.findMany({
      where: {
        brandId: BRAND_ID,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.provider ? { provider: filters.provider } : {}),
        ...(filters?.contentDraftId
          ? { contentDraftId: filters.contentDraftId }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { publication: true },
    });
  }

  private async upsertPublication(
    publishRequestId: string,
    provider: string,
    result: PublishResult,
  ) {
    return this.prisma.publication.upsert({
      where: { publishRequestId },
      create: {
        publishRequestId,
        provider,
        remoteId: result.remoteId ?? null,
        remoteUrl: result.remoteUrl ?? null,
        status: result.status,
        metadata: (result.metadata ?? null) as any,
        publishedAt: result.status === "LIVE" ? new Date() : null,
      },
      update: {
        remoteId: result.remoteId ?? null,
        remoteUrl: result.remoteUrl ?? null,
        status: result.status,
        metadata: (result.metadata ?? null) as any,
        publishedAt: result.status === "LIVE" ? new Date() : null,
      },
    });
  }
}
