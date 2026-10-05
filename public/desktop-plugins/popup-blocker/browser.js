var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// public/desktop-plugins/popup-blocker/index.ts
var popup_blocker_exports = {};
__export(popup_blocker_exports, {
  default: () => popup_blocker_default
});
module.exports = __toCommonJS(popup_blocker_exports);
var import_Settings = require("@api/Settings");
var import_constants = require("@utils/constants");
var import_types = __toESM(require("@utils/types"));
var settings = (0, import_Settings.definePluginSettings)({
  nitro: { type: import_types.OptionType.BOOLEAN, description: "block nitro promos", default: false, onChange: scheduleScan },
  quests: { type: import_types.OptionType.BOOLEAN, description: "block quest promos", default: false, onChange: scheduleScan },
  changelog: { type: import_types.OptionType.BOOLEAN, description: "block discord's whats new popups", default: false, onChange: scheduleScan },
  shop: { type: import_types.OptionType.BOOLEAN, description: "block shop and decoration promos", default: false, onChange: scheduleScan },
  tips: { type: import_types.OptionType.BOOLEAN, description: "block getting started tips", default: false, onChange: scheduleScan },
  customTitles: { type: import_types.OptionType.STRING, description: "other popup titles to block, one exact title per line", default: "", onChange: scheduleScan }
});
var protectedTitle = /security|password|log.?in|sign.?in|authentication|verification|verify|two.factor|2fa|error|warning|payment|purchase|checkout|delete|report|ban|permission|authorize/i;
var rules = {
  nitro: /\bnitro\b/i,
  quests: /\bquests?\b/i,
  changelog: /^(what[’']?s new|discord updates?|changelog)$/i,
  shop: /^(check out the shop|new in the shop|discover.*decorations|customize your avatar)$/i,
  tips: /^(getting started|welcome to discord|try.*new feature|discord tips)$/i
};
var observer;
var scanTimer;
var handled = /* @__PURE__ */ new WeakMap();
function scheduleScan() {
  if (!observer || scanTimer !== void 0)
    return;
  scanTimer = setTimeout(() => {
    scanTimer = void 0;
    if (observer)
      inspectPopups();
  }, 100);
}
function inspectPopups() {
  for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    if (!dialog.getClientRects().length) {
      handled.delete(dialog);
      continue;
    }
    const labelledBy = dialog.getAttribute("aria-labelledby");
    const title = (labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ") : dialog.querySelector("h1,h2,[role=heading]")?.textContent || dialog.getAttribute("aria-label") || "").trim();
    if (!title || protectedTitle.test(title))
      continue;
    if (handled.get(dialog) === title)
      continue;
    if (dialog.querySelector('input[type="password"], input[type="email"], input[autocomplete="one-time-code"], [role="alert"]'))
      continue;
    const custom = settings.store.customTitles.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const block = custom.includes(title.toLowerCase()) || Object.entries(rules).some(([key, pattern]) => settings.store[key] && pattern.test(title));
    if (!block)
      continue;
    const close = dialog.querySelector('button[aria-label="Close"], button[aria-label="Dismiss"], button[title="Close"]');
    if (close && !close.disabled && close.getClientRects().length) {
      handled.set(dialog, title);
      close.click();
    }
  }
}
var popup_blocker_default = (0, import_types.default)({
  name: "CloudCordPopupBlocker",
  description: "choose which promos to block. security, account and error popups stay. use exact titles for other languages.",
  authors: [import_constants.Devs.Xohus],
  settings,
  start() {
    observer?.disconnect();
    handled = /* @__PURE__ */ new WeakMap();
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "aria-labelledby", "hidden", "style", "class", "disabled"] });
    inspectPopups();
  },
  stop() {
    observer?.disconnect();
    observer = void 0;
    clearTimeout(scanTimer);
    scanTimer = void 0;
    handled = /* @__PURE__ */ new WeakMap();
  }
});
