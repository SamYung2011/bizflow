import { createHash } from "node:crypto";

// Small DOM fixture for the production panel: preserve generated HTML exactly
// while exercising its real delegated click/change handlers and focus targets.
export function withCalendar(factory, run) {
  const saved = Object.fromEntries(["document", "window", "HTMLElement", "requestAnimationFrame", "Date"].map((key) => [key, globalThis[key]]));
  const NativeDate = Date;
  let panel;
  const document = { activeElement: null, addEventListener() {}, removeEventListener() {} };
  class Element {
    constructor(attributes = {}, parent = null) {
      this.attributes = attributes;
      this.parent = parent;
      this.isConnected = true;
      this.style = {};
      this.listeners = {};
      this.offsetWidth = 254;
      this.offsetHeight = 320;
      this.value = attributes.value || "";
      this.nodes = [];
    }
    get disabled() { return Object.hasOwn(this.attributes, "disabled"); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    getAttributeNames() { return Object.keys(this.attributes); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    removeAttribute(key) { delete this.attributes[key]; }
    getBoundingClientRect() { return { left: 40, top: 30, bottom: 70 }; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    remove() { this.isConnected = false; }
    contains(node) { return node === this || node?.parent === this; }
    matches(selector) {
      const attr = selector.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);
      return Boolean(attr && Object.hasOwn(this.attributes, attr[1]) && (attr[2] === undefined || attr[2] === this.attributes[attr[1]]) && (!selector.includes(":not(:disabled)") || !this.disabled));
    }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
    focus() { if (!this.disabled) document.activeElement = this; }
    select() {}
    get innerHTML() { return this.html || ""; }
    set innerHTML(html) {
      this.html = html;
      this.nodes = [...html.matchAll(/<(button|input)\b([^>]*)>/g)].map((match) => {
        const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((item) => [item[1], item[2] ?? ""]));
        return new Element(attrs, this);
      });
    }
    querySelector(selector) { return this.nodes.find((node) => node.matches(selector)) || null; }
  }
  document.body = { append(node) { panel = node; } };
  document.createElement = () => new Element();
  globalThis.document = document;
  globalThis.window = { innerWidth: 1200, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
  globalThis.HTMLElement = Element;
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [2026, 8, 10, 12])); }
    static now() { return new NativeDate(2026, 8, 10, 12).getTime(); }
  };
  const api = factory(), anchor = new Element();
  const fixture = {
    api, anchor, document,
    get panel() { return panel; },
    open(options = {}) { return api.open({ anchor, viewDate: "2026-09-01", ...options }); },
    click(selector) {
      const target = panel.querySelector(selector);
      if (!target) throw new Error(`Missing calendar target ${selector}`);
      panel.listeners.click({ target });
    },
    year(value) {
      const target = panel.querySelector("[data-date-range-year]");
      target.value = value;
      panel.listeners.change?.({ target });
    },
  };
  try { return run(fixture); }
  finally {
    api.close({ restoreFocus: false });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

export function legacyCalendarTrace(factory) {
  return withCalendar(factory, (f) => {
    const output = {}, commits = [];
    const snap = (key) => { output[key] = createHash("sha256").update(f.panel.innerHTML).digest("hex"); };
    const action = (name) => f.click(`[data-date-range-action="${name}"]`);
    for (const language of ["zh", "en", "fr"]) {
      for (const mode of ["single", "range"]) {
        f.open({ mode, language, minDate: "2026-08-20", date: "2026-09-09", start: "2026-09-03", end: "2026-09-07", onCommit: (value) => commits.push(value) });
        snap(`${language}-${mode}`);
        action("previous"); snap(`${language}-${mode}-previous`);
        action("next"); snap(`${language}-${mode}-next`);
        action("jump"); snap(`${language}-${mode}-jump`);
        f.year("2025"); f.click('[data-date-range-month="11"]'); snap(`${language}-${mode}-year-month`);
        action("clear"); snap(`${language}-${mode}-clear`);
      }
    }
    f.open({ start: "2026-09-04", end: "", onCommit: (value) => commits.push(value) });
    f.click('[data-date-range-day="2026-09-02"]'); snap("range-reverse-end");
    f.click('[data-date-range-day="2026-09-08"]'); snap("range-restart");
    action("today"); snap("range-today");
    action("complete");
    f.open({ mode: "single", minDate: "2026-09-02", presets: [{ label: "All", date: "" }, { label: "Preset", date: "2026-09-09" }], onCommit: (value) => commits.push(value) });
    snap("presets");
    f.click('[data-date-range-day="2026-09-01"]'); snap("blocked-no-change");
    f.click('[data-date-range-preset="1"]');
    output.commits = commits;
    return output;
  });
}
