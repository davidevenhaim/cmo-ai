import { MeasurementSchedulerService } from "./measurement-scheduler.service";

describe("MeasurementSchedulerService", () => {
  it("runs an idempotent cycle and isolates step failures", async () => {
    const recommendations = {
      expireStale: jest.fn().mockResolvedValue(1),
      syncExecutionTransitions: jest.fn().mockResolvedValue(2),
    };
    const ingestion = {
      ingest: jest.fn().mockResolvedValue({
        providers: [{ provider: "shopify", status: "AVAILABLE", ingested: 4 }],
      }),
    };
    const measurement = {
      startMeasuring: jest.fn().mockResolvedValue(3),
      finalizeDue: jest.fn().mockRejectedValue(new Error("finalize blew up")),
    };
    const svc = new MeasurementSchedulerService(
      recommendations as any,
      ingestion as any,
      measurement as any,
    );

    const summary = await svc.runCycle(new Date("2026-08-27T12:00:00Z"));

    expect(summary.expired).toBe(1);
    expect(summary.executionTransitions).toBe(2);
    expect(summary.startedMeasuring).toBe(3);
    expect(summary.finalized).toBe(0);
    expect(summary.errors.some((e) => e.includes("finalize"))).toBe(true);
    // Earlier steps still completed despite finalize failure.
    expect(recommendations.expireStale).toHaveBeenCalled();
    expect(ingestion.ingest).toHaveBeenCalled();
  });
});
