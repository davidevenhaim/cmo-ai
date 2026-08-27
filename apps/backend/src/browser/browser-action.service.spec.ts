import { BrowserActionService } from "./browser-action.service";
import { of, throwError } from "rxjs";

describe("BrowserActionService", () => {
  const make = (env: Record<string, string>, http?: any) => {
    const config = { get: (k: string, d = "") => env[k] ?? d };
    return new BrowserActionService(
      (http ?? { post: jest.fn() }) as any,
      config as any,
    );
  };

  it("returns NOT_CONFIGURED without BROWSERLESS_URL", async () => {
    const svc = make({});
    const result = await svc.execute({
      type: "READ_PAGE",
      url: "https://example.com",
    });
    expect(result.status).toBe("NOT_CONFIGURED");
  });

  it("rejects private URLs", async () => {
    const svc = make({ BROWSERLESS_URL: "http://browserless:3000" });
    const result = await svc.execute({
      type: "READ_PAGE",
      url: "http://127.0.0.1/admin",
    });
    expect(result.status).toBe("REJECTED");
  });

  it("refuses unrestricted CREATE_DRAFT", async () => {
    const svc = make({ BROWSERLESS_URL: "http://browserless:3000" });
    const result = await svc.execute({
      type: "CREATE_DRAFT",
      url: "https://forum.example/new",
      payload: { title: "x", body: "y" },
    });
    expect(result.status).toBe("UNSUPPORTED");
  });

  it("VERIFY_DRAFT fails without expectations (click ≠ success)", async () => {
    const http = {
      post: jest
        .fn()
        .mockReturnValue(
          of({ data: "<html><title>T</title><body>Hello</body></html>" }),
        ),
    };
    const svc = make({ BROWSERLESS_URL: "http://browserless:3000" }, http);
    const result = await svc.execute({
      type: "VERIFY_DRAFT",
      url: "https://example.com/draft",
    });
    expect(result.status).toBe("FAILED");
    expect(result.verified).toBe(false);
  });

  it("VERIFY_DRAFT succeeds when expected text present", async () => {
    const http = {
      post: jest.fn().mockReturnValue(
        of({
          data: "<html><title>Draft</title><body>UniqueDraftTitleXYZ</body></html>",
        }),
      ),
    };
    const svc = make({ BROWSERLESS_URL: "http://browserless:3000" }, http);
    const result = await svc.execute({
      type: "VERIFY_DRAFT",
      url: "https://example.com/draft",
      payload: { expectedTextSubstring: "UniqueDraftTitleXYZ" },
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.verified).toBe(true);
  });

  it("handles browser timeout as FAILED", async () => {
    const http = {
      post: jest.fn().mockReturnValue(throwError(() => new Error("timeout"))),
    };
    const svc = make({ BROWSERLESS_URL: "http://browserless:3000" }, http);
    const result = await svc.execute({
      type: "READ_PAGE",
      url: "https://example.com",
    });
    expect(result.status).toBe("FAILED");
  });
});
