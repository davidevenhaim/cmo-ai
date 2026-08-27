import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { IsEnum, IsIn } from "class-validator";
import { ApprovalService } from "./approval.service";

class ResolveApprovalDto {
  @IsIn(["APPROVED", "REJECTED"])
  status: "APPROVED" | "REJECTED";
}

@Controller("approvals")
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get()
  list(@Query("status") status?: string) {
    if (status === "PENDING") return this.approvalService.listPending();
    return this.approvalService.list();
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.approvalService.getById(id);
  }

  @Patch(":id/resolve")
  resolve(@Param("id") id: string, @Body() dto: ResolveApprovalDto) {
    return this.approvalService.resolve(id, dto.status, "api");
  }
}
