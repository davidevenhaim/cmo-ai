// Self-hosted Lighthouse runner.
//
// Exposes exactly one useful endpoint, POST /audit, so the NestJS backend can
// get a Lighthouse report without shipping Chrome inside the backend image.
// Deliberately dependency-light: node:http, no express.
//
// The backend is the only client. This service performs no auth of its own and
// must stay on the internal compose network.

import { createServer } from "node:http";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const PORT = Number(process.env.PORT || 3010);
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 120_000);

const CATEGORIES = ["performance", "accessibility", "seo", "best-practices"];

// Only http/https to public hosts. The backend applies the same guard, but the
// runner refuses on its own so it can never be turned into an SSRF proxy.
function assertAuditableUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid url: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${u.protocol}`);
  }
  const host = u.hostname;
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === "::1" ||
    host === "0.0.0.0"
  ) {
    throw new Error(`blocked private host: ${host}`);
  }
  return u.toString();
}

async function runAudit({ url, formFactor, timeoutMs }) {
  const target = assertAuditableUrl(url);
  const mobile = (formFactor || "MOBILE").toUpperCase() !== "DESKTOP";

  const chrome = await launch({
    chromeFlags: [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const result = await lighthouse(
      target,
      {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: CATEGORIES,
        maxWaitForLoad: timeoutMs || DEFAULT_TIMEOUT_MS,
      },
      {
        extends: "lighthouse:default",
        settings: {
          formFactor: mobile ? "mobile" : "desktop",
          screenEmulation: mobile
            ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }
            : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
          emulatedUserAgentString: false,
        },
      },
    );
    if (!result || !result.lhr) throw new Error("lighthouse returned no report");
    return result.lhr;
  } finally {
    // chrome-launcher's kill() returns void in v1 and a promise in older
    // versions. Await defensively so a cleanup failure can never mask the
    // audit's own result.
    try {
      await chrome.kill();
    } catch {
      /* the browser is going away regardless */
    }
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { status: "ok", service: "lighthouse-runner" });
  }

  if (req.method !== "POST" || !req.url.startsWith("/audit")) {
    return json(res, 404, { error: "not found" });
  }

  let payload;
  try {
    payload = JSON.parse((await readBody(req)) || "{}");
  } catch (err) {
    return json(res, 400, { error: `invalid json: ${err.message}` });
  }

  if (!payload.url) return json(res, 400, { error: "url is required" });

  const started = Date.now();
  try {
    const lhr = await runAudit({
      url: payload.url,
      formFactor: payload.formFactor,
      timeoutMs: payload.timeoutMs,
    });
    return json(res, 200, { ok: true, durationMs: Date.now() - started, lhr });
  } catch (err) {
    // 422 = we reached the runner but the audit itself failed. The backend
    // treats this as a per-page failure, not a provider outage.
    return json(res, 422, {
      ok: false,
      durationMs: Date.now() - started,
      error: String(err && err.message ? err.message : err),
    });
  }
});

server.headersTimeout = DEFAULT_TIMEOUT_MS + 30_000;
server.requestTimeout = DEFAULT_TIMEOUT_MS + 30_000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`lighthouse-runner listening on 0.0.0.0:${PORT}`);
});
