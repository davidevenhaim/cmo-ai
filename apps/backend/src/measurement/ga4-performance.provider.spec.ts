import { Ga4PerformanceProvider } from "./providers/ga4-performance.provider";

function makeConfig(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string, fallback = "") => values[key] ?? fallback),
  };
}

describe("Ga4PerformanceProvider", () => {
  it("reports NOT_CONFIGURED when credentials are absent", async () => {
    const provider = new Ga4PerformanceProvider(makeConfig() as any, {} as any);
    expect(provider.status).toBe("NOT_CONFIGURED");
    const result = await provider.collect({
      since: new Date("2026-08-01"),
      until: new Date("2026-08-07"),
    });
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.observations).toEqual([]);
    expect(result.detail).toMatch(/GA4_PROPERTY_ID/);
  });

  it("marks MOCK observations when GA4_USE_MOCK=true", async () => {
    const provider = new Ga4PerformanceProvider(
      makeConfig({ GA4_USE_MOCK: "true" }) as any,
      {} as any,
    );
    expect(provider.status).toBe("MOCK");
    const result = await provider.collect({
      since: new Date("2026-08-01"),
      until: new Date("2026-08-07"),
    });
    expect(result.status).toBe("MOCK");
    expect(result.observations.every((o) => o.isMock === true)).toBe(true);
  });

  it("does not invent live data without config", async () => {
    const provider = new Ga4PerformanceProvider(
      makeConfig({ GA4_PROPERTY_ID: "" }) as any,
      {} as any,
    );
    const result = await provider.collect({
      since: new Date(),
      until: new Date(),
    });
    expect(result.observations).toHaveLength(0);
  });
});
