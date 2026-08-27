import { UmamiPerformanceProvider } from "./umami-performance.provider";
import { of, throwError } from "rxjs";

describe("UmamiPerformanceProvider", () => {
  const make = (env: Record<string, string>, http?: any) => {
    const config = {
      get: (k: string, d = "") => env[k] ?? d,
    };
    return new UmamiPerformanceProvider(
      config as any,
      (http ?? { get: jest.fn() }) as any,
    );
  };

  it("reports NOT_CONFIGURED when missing credentials", async () => {
    const p = make({});
    const result = await p.collect({
      since: new Date("2024-01-01"),
      until: new Date("2024-01-08"),
    });
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.observations).toEqual([]);
  });

  it("marks MOCK observations as isMock", async () => {
    const p = make({ UMAMI_USE_MOCK: "true" });
    const result = await p.collect({
      since: new Date("2024-01-01"),
      until: new Date("2024-01-08"),
    });
    expect(result.status).toBe("MOCK");
    expect(result.observations.every((o) => o.isMock === true)).toBe(true);
  });

  it("collects real stats when configured", async () => {
    const http = {
      get: jest
        .fn()
        .mockReturnValue(
          of({ data: { visits: 10, visitors: 7, pageviews: 20, bounces: 2 } }),
        ),
    };
    const p = make(
      {
        UMAMI_BASE_URL: "http://umami:3000",
        UMAMI_WEBSITE_ID: "wid",
        UMAMI_API_TOKEN: "tok",
      },
      http,
    );
    const result = await p.collect({
      since: new Date("2024-01-01"),
      until: new Date("2024-01-08"),
    });
    expect(result.status).toBe("AVAILABLE");
    expect(result.observations.some((o) => o.metric === "sessions")).toBe(true);
    expect(result.observations.every((o) => o.isMock !== true)).toBe(true);
  });

  it("returns ERROR on malformed/unreachable provider", async () => {
    const http = {
      get: jest.fn().mockReturnValue(throwError(() => new Error("boom"))),
    };
    const p = make(
      {
        UMAMI_BASE_URL: "http://umami:3000",
        UMAMI_WEBSITE_ID: "wid",
        UMAMI_API_TOKEN: "tok",
      },
      http,
    );
    const result = await p.collect({
      since: new Date("2024-01-01"),
      until: new Date("2024-01-08"),
    });
    expect(result.status).toBe("ERROR");
    expect(result.observations).toEqual([]);
  });
});
