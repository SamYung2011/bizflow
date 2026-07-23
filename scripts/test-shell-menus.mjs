import assert from "node:assert/strict";

import {
  attachMenuBehaviors,
  renderLanguageMenu,
  renderUserPanel
} from "../root-site/components/menus.js";

const translate = (key) => `t:${key}`;
function renderUserPanelForContract(options) {
  const originalDocument = globalThis.document;
  try {
    globalThis.document = { getElementById: () => null };
    return renderUserPanel(options);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
}

const languageMenu = renderLanguageMenu({
  langs: [
    { code: "zh", label: "繁體中文" },
    { code: "en", label: "English" }
  ],
  current: "en",
  placement: "start",
  t: translate
});
assert.match(languageMenu, /menu-popover--start/);
assert.match(languageMenu, /data-lang="en" aria-selected="true" aria-current="true"/);
assert.match(languageMenu, /data-lang="zh" aria-selected="false"/);

const userPanel = renderUserPanelForContract({
  user: {
    name: "A <Admin>",
    email: "admin@example.test",
    company: "Honnmono",
    role: "Administrator",
    position: "Operations",
    phone: "12345678",
    note: "Profile",
    availableCompanies: [{ id: "company-2", name: "Second company" }]
  },
  t: translate,
  links: [{ href: "/team/index.html", label: "Tasks" }],
  profileReadOnly: true
});
assert.match(userPanel, /data-panel-view="menu"[\s\S]*user-panel__view--menu/);
assert.match(userPanel, /user-panel__view--password[\s\S]*data-password-form/);
assert.match(userPanel, /user-panel__view--profile[\s\S]*data-profile-form/);
assert.match(userPanel, /data-profile-join-form/);
assert.match(userPanel, /data-menu-action="logout"/);
assert.match(userPanel, /A &lt;Admin&gt;/, "user values must remain escaped by the real renderer");

function classList(...initial) {
  const values = new Set(initial);
  return {
    contains: (value) => values.has(value),
    toggle(value, force) {
      if (force) values.add(value);
      else values.delete(value);
    }
  };
}

function targetFor(closest = {}, attributes = {}) {
  return {
    closest: (selector) => closest[selector] ?? null,
    getAttribute: (name) => attributes[name] ?? null
  };
}

const panelAttributes = new Map([["data-panel-view", "menu"]]);
const panel = {
  setAttribute: (name, value) => panelAttributes.set(name, value)
};
const popoverStyles = new Map();
const popover = {
  classList: classList(),
  style: {
    removeProperty: (name) => popoverStyles.delete(name),
    setProperty: (name, value) => popoverStyles.set(name, value)
  },
  getBoundingClientRect: () => ({ left: 100, right: 500 })
};
const triggerAttributes = new Map();
let anchor;
const trigger = targetFor();
trigger.classList = classList("shell-avatar-trigger");
trigger.setAttribute = (name, value) => triggerAttributes.set(name, value);
trigger.closest = (selector) => selector === "[data-menu]" ? anchor : null;
anchor = {
  querySelector(selector) {
    if (selector === "[data-menu-popover]") return popover;
    if (selector === "[data-menu-trigger]") return trigger;
    if (selector === ".user-panel[data-panel-view]") return panel;
    return null;
  }
};
const root = {
  contains: () => true,
  querySelectorAll: (selector) => selector === "[data-menu]" ? [anchor] : []
};
const listeners = new Map();
const documentStub = {
  addEventListener(type, handler) {
    listeners.set(type, handler);
  },
  removeEventListener(type, handler) {
    if (listeners.get(type) === handler) listeners.delete(type);
  }
};

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
let beforeOpenCalls = 0;
let logoutCalls = 0;
try {
  globalThis.document = documentStub;
  globalThis.window = { innerWidth: 1200 };
  const detach = attachMenuBehaviors(root, {
    onBeforeUserPanelOpen: () => { beforeOpenCalls += 1; },
    onLogout: () => { logoutCalls += 1; }
  });

  listeners.get("click")({
    target: targetFor({ "[data-menu-trigger]": trigger })
  });
  assert.equal(popover.classList.contains("menu-popover--open"), true);
  assert.equal(triggerAttributes.get("aria-expanded"), "true");
  assert.equal(beforeOpenCalls, 1);

  const profileButton = targetFor({
    "[data-panel-view]": null,
    "[data-menu]": anchor
  }, { "data-panel-view": "profile" });
  profileButton.closest = (selector) => {
    if (selector === "[data-panel-view]") return profileButton;
    if (selector === "[data-menu]") return anchor;
    return null;
  };
  listeners.get("click")({ target: profileButton });
  assert.equal(panelAttributes.get("data-panel-view"), "profile");
  assert.equal(beforeOpenCalls, 2);

  listeners.get("click")({ target: targetFor() });
  assert.equal(popover.classList.contains("menu-popover--open"), false);
  assert.equal(panelAttributes.get("data-panel-view"), "menu");

  listeners.get("click")({
    target: targetFor({ "[data-menu-trigger]": trigger })
  });
  listeners.get("keydown")({ key: "Escape" });
  assert.equal(popover.classList.contains("menu-popover--open"), false);
  assert.equal(triggerAttributes.get("aria-expanded"), "false");

  const logoutButton = targetFor();
  logoutButton.closest = (selector) =>
    selector === '[data-menu-action="logout"]' ? logoutButton : null;
  listeners.get("click")({ target: logoutButton });
  assert.equal(logoutCalls, 1);

  detach();
  assert.deepEqual([...listeners.keys()], []);
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}

console.log("Shell menu contracts: PASS (real language/user render, panel open/view/outside/Esc/logout, detach)");
