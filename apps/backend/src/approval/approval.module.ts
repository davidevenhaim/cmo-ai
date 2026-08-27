import { Module } from "@nestjs/common";
import { ApprovalController } from "./approval.controller";
import { ApprovalService } from "./approval.service";
import { PrismaService } from "../prisma.service";

@Module({
  controllers: [ApprovalController],
  providers: [ApprovalService, PrismaService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
