// Shared harness: loads a single-file HTML app into jsdom with stubs for
// browser APIs jsdom lacks (Web Audio, canvas, speech, wake lock, matchMedia...).
// Tests should drive the app ONLY through the DOM (ids, clicks, input events)
// and localStorage, so they survive internal refactoring.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import FakeTimers from "@sinonjs/fake-timers";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const appPath = (...p) => path.join(ROOT, ...p);

// Generic recording stub: any property access returns a callable stub, so
// arbitrary Web Audio / canvas call chains work without implementing them.
function deepStub(name, log) {
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "then") return undefined; // not a thenable
      if (prop === "value" || prop === "currentTime" || prop === "width" || prop === "height") return 0;
      if (prop === "state") return "running";
      if (prop === "data") return new Uint8ClampedArray(4);
      return deepStub(`${name}.${String(prop)}`, log);
    },
    set() { return true; },
    apply(_t, _this, args) { log.push(name); return deepStub(`${name}()`, log); },
    construct() { log.push(`new ${name}`); return deepStub(`new ${name}`, log); },
  });
}

/**
 * Load an HTML app.
 * @param {string} file absolute path
 * @param {object} opts
 *   storage: {key: value(object|string)} pre-seeded localStorage
 *   now: Date|number for the fake clock (default 2026-11-05T08:00:00 local)
 *   fakeTimers: true (default) installs @sinonjs/fake-timers into the window
 *   visible: true (default) document.hidden=false
 *   url: page URL (default http://localhost/)
 *   speechRecognition: true installs a fake SpeechRecognition (instances in app.recognizers)
 * @returns {{window, document, $, clock, errors, calls, recognizers, storage, click, setValue, fire, tick, close}}
 */
export function loadApp(file, opts = {}) {
  const html = readFileSync(file, "utf8");
  const errors = [];
  const calls = []; // names of stubbed API calls (audio, speech, vibrate...)
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    // canvas "not implemented" noise is expected and ignored
    if (/Not implemented: HTMLCanvasElement/.test(e.message)) return;
    errors.push(e);
  });
  vc.on("error", (...a) => errors.push(new Error(a.map(String).join(" "))));
  let clock = null;
  const recognizers = []; // FakeSpeechRecognition instances (opts.speechRecognition)
  const now = opts.now ?? new Date(2026, 10, 5, 8, 0, 0);
  const dom = new JSDOM(html, {
    url: opts.url ?? "http://localhost/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (opts.fakeTimers !== false) {
        clock = FakeTimers.withGlobal(window).install({
          now,
          toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date",
            "requestAnimationFrame", "cancelAnimationFrame", "performance"],
        });
      }
      for (const [k, v] of Object.entries(opts.storage ?? {})) {
        window.localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      }
      const audioCtor = function () { calls.push("AudioContext"); return deepStub("audio", calls); };
      window.AudioContext = audioCtor;
      window.webkitAudioContext = audioCtor;
      window.HTMLCanvasElement.prototype.getContext = function () { return deepStub("canvas", calls); };
      window.HTMLCanvasElement.prototype.toDataURL = () => "data:,";
      window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      window.SpeechSynthesisUtterance = function (text) { this.text = text; };
      window.speechSynthesis = {
        speak(u) { calls.push(`speak:${u.text}`); },
        cancel() { calls.push("speech.cancel"); },
        getVoices() { return []; },
        addEventListener() {}, onvoiceschanged: null,
      };
      Object.defineProperty(window.navigator, "vibrate", { value: (p) => { calls.push("vibrate"); return true; }, configurable: true });
      Object.defineProperty(window.navigator, "wakeLock", {
        value: { request: async () => { calls.push("wakeLock"); return { release: async () => {}, addEventListener() {} }; } },
        configurable: true,
      });
      if (opts.visible !== false) {
        Object.defineProperty(window.document, "hidden", { get: () => false, configurable: true });
        Object.defineProperty(window.document, "visibilityState", { get: () => "visible", configurable: true });
      }
      if (opts.speechRecognition) installFakeSpeechRecognition(window, calls, recognizers);
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.confirm = () => true;
      window.alert = () => {};
      if (opts.beforeParse) opts.beforeParse(window);
    },
  });
  const { window } = dom;
  const document = window.document;
  const $ = (id) => document.getElementById(id);
  const ev = (type, init = {}) => new window.Event(type, { bubbles: true, cancelable: true, ...init });
  return {
    dom, window, document, $, clock, errors, calls, recognizers,
    storage: {
      get: (k) => { const v = window.localStorage.getItem(k); try { return JSON.parse(v); } catch { return v; } },
      raw: (k) => window.localStorage.getItem(k),
    },
    /** click an element (or id) dispatching pointerdown + click */
    click(elOrId) {
      const el = typeof elOrId === "string" ? $(elOrId) : elOrId;
      if (!el) throw new Error(`click: element not found: ${elOrId}`);
      el.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      el.click();
    },
    /** set a form control value and fire input + change */
    setValue(elOrId, value) {
      const el = typeof elOrId === "string" ? $(elOrId) : elOrId;
      if (!el) throw new Error(`setValue: element not found: ${elOrId}`);
      el.value = String(value);
      el.dispatchEvent(ev("input"));
      el.dispatchEvent(ev("change"));
    },
    fire(elOrId, type, init) {
      const el = typeof elOrId === "string" ? $(elOrId) : elOrId;
      el.dispatchEvent(type.startsWith("key") ? new window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }) : ev(type, init));
    },
    /** advance fake time by ms (runs timers) */
    tick(ms) { if (!clock) throw new Error("fakeTimers disabled"); clock.tick(ms); },
    close() { try { clock?.uninstall(); } catch {} window.close(); },
  };
}

/**
 * Optional fake Web Speech recognition (loadApp opts.speechRecognition: true).
 * Installs window.SpeechRecognition + webkitSpeechRecognition. Every instance is
 * pushed to app.recognizers and offers test drivers:
 *   emitResult([{ text, final }], resultIndex = 0)  -> calls onresult
 *   emitError(code)                                -> calls onerror({error: code})
 *   end()                                          -> running=false, calls onend
 * start() throws if already running (like Chrome); stop() schedules onend via setTimeout(0).
 * Records "sr.new", "sr.start", "sr.stop" in app.calls.
 */
function installFakeSpeechRecognition(window, calls, recognizers) {
  class FakeSpeechRecognition {
    constructor() {
      this.running = false; this.started = 0; this.stopped = 0;
      this.onresult = null; this.onerror = null; this.onend = null;
      recognizers.push(this); calls.push("sr.new");
    }
    start() {
      if (this.running) throw new Error("InvalidStateError: already started");
      this.running = true; this.started++; calls.push("sr.start");
    }
    stop() {
      calls.push("sr.stop"); this.stopped++;
      if (!this.running) return;
      this.running = false;
      window.setTimeout(() => { this.onend && this.onend({}); }, 0);
    }
    abort() { this.stop(); }
    emitResult(items, resultIndex = 0) {
      const results = items.map(({ text, final }) => { const r = [{ transcript: text, confidence: 1 }]; r.isFinal = !!final; return r; });
      this.onresult && this.onresult({ resultIndex, results });
    }
    emitError(code) { this.onerror && this.onerror({ error: code }); }
    end() { this.running = false; this.onend && this.onend({}); }
  }
  window.SpeechRecognition = FakeSpeechRecognition;
  window.webkitSpeechRecognition = FakeSpeechRecognition;
}

/** submit a form element the way a user would (requestSubmit if available) */
export function submit(app, formOrId) {
  const f = typeof formOrId === "string" ? app.$(formOrId) : formOrId;
  if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
}
