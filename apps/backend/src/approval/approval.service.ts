import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

export interface CreateApprovalDto {
  cmoRunId?: string;
  type: string;
  subject: string;
  description: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateApprovalDto) {
    return this.prisma.approval.create({
      data: {
        brandId: BRAND_ID,
        cmoRunId: dto.cmoRunId ?? null,
        type: dto.type,
        subject: dto.subject,
        description: dto.description,
        metadata: (dto.metadata ?? null) as any,
        status: "PENDING",
      },
    });
  }

  async listPending() {
    return this.prisma.approval.findMany({
      where: { brandId: BRAND_ID, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
  }

  async list() {
    return this.prisma.approval.findMany({
      where: { brandId: BRAND_ID },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async getById(id: string) {
    const approval = await this.prisma.approval.findUnique({ where: { id } });
    if (!approval) throw new NotFoundException(`Approval ${id} not found`);
    return approval;
  }

  async resolve(
    id: string,
    status: "APPROVED" | "REJECTED",
    resolvedBy: string,
  ) {
    // Atomic: only update if currently PENDING — safe under concurrent callers.
    // Linked ContentDraft transitions in the same transaction so approval and
    // draft state can never disagree after a successful resolution.
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.approval.updateMany({
        where: { id, status: "PENDING" },
        data: { status, resolvedAt: new Date(), resolvedBy },
      });

      if (updated.count > 0) {
        await tx.contentDraft.updateMany({
          where: {
            approvalId: id,
            status: { in: ["GENERATED", "PENDING_REVIEW"] },
          },
          data: { status },
        });
      }

      return updated;
    });

    if (result.count === 0) {
      // Already resolved — return existing record (idempotent)
      const existing = await this.prisma.approval.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Approval ${id} not found`);
      return existing;
    }

    return this.prisma.approval.findUniqueOrThrow({ where: { id } });
  }
}
