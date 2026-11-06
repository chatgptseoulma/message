// Fake Vercel Node runtime (req/res) + app loader that swaps the app's own
// @supabase/supabase-js for the in-memory fake (helpers/fake-supabase.js).
//
// All knowledge of the apps' on-disk layout lives here (APPS / ROUTES) so a refactor that
// moves files only needs edits in this one place.
import { mock } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFakeSupabase } from "./fake-supabase.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..", "..");
export const APPS = {
  survey: path.join(ROOT, "survey-vercel"),
  comfort: path.join(ROOT, "comfort-letters"),
};
// Vercel route (/api/x) -> module path inside the app. Vercel maps api/x.js to /api/x.
export const ROUTES = {
  survey: { config: "api/config.js", responses: "api/responses.js", login: "api/login.js", logout: "api/logout.js", summary: "api/summary.js", export: "api/export.js" },
  comfort: { me: "api/me.js", comforters: "api/comforters.js", rooms: "api/rooms.js", room: "api/room.js", message: "api/message.js", blocks: "api/blocks.js", reports: "api/reports.js", reactions: "api/reactions.js", admin: "api/admin.js" },
};

export const TEST_ENV = {
  SUPABASE_URL: "https://fake-project.supabase.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_TEST_ONLY_dummy_service_key",
  ADMIN_PASSWORD: "test-admin-password-123",
};

/** File URL of the ESM entry of `pkg` exactly as `appDir`'s code would import it. */
export function resolveEsmFrom(appDir, pkg) {
  const req = createRequire(path.join(appDir, "package.json"));
  const pj = req.resolve(`${pkg}/package.json`);
  const meta = JSON.parse(fs.readFileSync(pj, "utf8"));
  const e = meta.exports?.["."];
  const rel = (typeof e === "string" ? e : e?.import?.default ?? e?.import ?? e?.default) ?? meta.module ?? meta.main;
  return pathToFileURL(path.join(path.dirname(pj), rel)).href;
}

/**
 * Install the fake supabase for `app`, set dummy env, block network, and import the
 * route handlers. Call once at top level of a test file (each test file is its own process,
 * so module caches such as db() singletons / user caches start fresh per file).
 */
export async function loadApp(app, { schema, env = TEST_ENV, maxRows } = {}) {
  const appDir = APPS[app];
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  globalThis.fetch = async (url) => { throw new Error(`network disabled in tests (attempted fetch ${String(url).slice(0, 60)})`); };

  const fake = createFakeSupabase(schema, { maxRows });
  const url = resolveEsmFrom(appDir, "@supabase/supabase-js");
  mock.module(url, {
    exports: { createClient: (...a) => fake.createClient(...a), default: { createClient: (...a) => fake.createClient(...a) } },
  });

  const handlers = {};
  for (const [name, rel] of Object.entries(ROUTES[app])) {
    const mod = await import(pathToFileURL(path.join(appDir, rel)).href);
    handlers[name] = mod.default;
  }
  return { fake, handlers, appDir, supabaseUrl: url };
}

export function readVercelJson(app) {
  return JSON.parse(fs.readFileSync(path.join(APPS[app], "vercel.json"), "utf8"));
}
export const appFileExists = (app, rel) => fs.existsSync(path.join(APPS[app], rel));

// ── fake Vercel request/response ────────────────────────────────────────────
export function makeReq({ method = "GET", query = {}, headers = {}, body, url } = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
  return { method, query: { ...query }, headers: h, body, url: url ?? `/${qs ? "?" + qs : ""}`, cookies: {} };
}

export function makeRes() {
  const res = {
    statusCode: 200, headers: {}, body: undefined, ended: false, redirectedTo: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    removeHeader(k) { delete this.headers[k.toLowerCase()]; },
    hasHeader(k) { return k.toLowerCase() in this.headers; },
    status(code) { this.statusCode = code; return this; },
    json(obj) {
      if (!this.hasHeader("content-type")) this.setHeader("Content-Type", "application/json; charset=utf-8");
      return this.end(JSON.stringify(obj));
    },
    send(b) {
      if (b !== null && typeof b === "object" && !Buffer.isBuffer(b)) return this.json(b);
      if (typeof b === "string" && !this.hasHeader("content-type")) this.setHeader("Content-Type", "text/html; charset=utf-8");
      return this.end(b);
    },
    redirect(a, b) {
      const [code, loc] = typeof a === "number" ? [a, b] : [307, a];
      this.statusCode = code; this.setHeader("Location", loc); this.redirectedTo = loc;
      return this.end();
    },
    writeHead(code, hdrs = {}) { this.statusCode = code; for (const [k, v] of Object.entries(hdrs)) this.setHeader(k, v); return this; },
    write(chunk) { this.body = (this.body ?? "") + String(chunk); return true; },
    end(chunk) {
      if (this.ended) throw new Error("response ended twice");
      if (chunk !== undefined) this.body = (this.body ?? "") + (Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      this.ended = true; this._done?.(); return this;
    },
  };
  res.finished = new Promise(r => { res._done = r; });
  return res;
}

/**
 * Invoke a handler like Vercel would. Returns {status, headers, text, json, location, threw}.
 * A thrown/rejected handler becomes a 500 (as the platform would do), with `threw` set.
 */
export async function call(handler, opts = {}) {
  const req = makeReq(opts), res = makeRes();
  let threw = null;
  try { await handler(req, res); } catch (e) { threw = e; }
  if (!res.ended && !threw) {
    let timer;
    await Promise.race([res.finished, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("handler never ended the response")), opts.timeoutMs ?? 5000); timer?.unref?.(); })]);
    clearTimeout(timer);
  }
  if (threw && !res.ended) { res.statusCode = 500; }
  let json;
  const ct = res.headers["content-type"] ?? "";
  if (typeof res.body === "string" && ct.includes("application/json")) json = JSON.parse(res.body);
  return { status: res.statusCode, headers: res.headers, text: res.body, json, location: res.headers.location, threw };
}

/** Apply vercel.json `headers` rules to a path (sources are path-to-regexp; these use plain regex groups). */
export function headersFor(vercel, p) {
  const out = {};
  for (const rule of vercel.headers ?? []) {
    if (new RegExp("^" + rule.source + "$").test(p)) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}
