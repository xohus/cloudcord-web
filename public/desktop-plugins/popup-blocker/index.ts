import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    nitro: { type: OptionType.BOOLEAN, description: "block nitro promos", default: false, onChange: scheduleScan },
    quests: { type: OptionType.BOOLEAN, description: "block quest promos", default: false, onChange: scheduleScan },
    changelog: { type: OptionType.BOOLEAN, description: "block discord's whats new popups", default: false, onChange: scheduleScan },
    shop: { type: OptionType.BOOLEAN, description: "block shop and decoration promos", default: false, onChange: scheduleScan },
    tips: { type: OptionType.BOOLEAN, description: "block getting started tips", default: false, onChange: scheduleScan },
    customTitles: { type: OptionType.STRING, description: "other popup titles to block, one exact title per line", default: "", onChange: scheduleScan }
});

const protectedTitle = /security|password|log.?in|sign.?in|authentication|verification|verify|two.factor|2fa|error|warning|payment|purchase|checkout|delete|report|ban|permission|authorize/i;
const rules = {
    nitro: /\bnitro\b/i,
    quests: /\bquests?\b/i,
    changelog: /^(what[’']?s new|discord updates?|changelog)$/i,
    shop: /^(check out the shop|new in the shop|discover.*decorations|customize your avatar)$/i,
    tips: /^(getting started|welcome to discord|try.*new feature|discord tips)$/i
};
let observer: MutationObserver | undefined;
let scanTimer: ReturnType<typeof setTimeout> | undefined;
let handled = new WeakMap<Element, string>();

function scheduleScan() {
    if (!observer || scanTimer !== undefined) return;
    // Batch DOM changes and wait for late-mounted headings/close buttons.
    scanTimer = setTimeout(() => {
        scanTimer = undefined;
        if (observer) inspectPopups();
    }, 100);
}

function inspectPopups() {
    for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
        if (!dialog.getClientRects().length) { handled.delete(dialog); continue; }
        const labelledBy = dialog.getAttribute("aria-labelledby");
        const title = (labelledBy ? labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ") : dialog.querySelector("h1,h2,[role=heading]")?.textContent || dialog.getAttribute("aria-label") || "").trim();
        if (!title || protectedTitle.test(title)) continue;
        if (handled.get(dialog) === title) continue;
        // Never dismiss account/security/error forms, even under a promo title.
        if (dialog.querySelector('input[type="password"], input[type="email"], input[autocomplete="one-time-code"], [role="alert"]')) continue;
        const custom = settings.store.customTitles.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean);
        const block = custom.includes(title.toLowerCase()) || Object.entries(rules).some(([key, pattern]) => settings.store[key as keyof typeof rules] && pattern.test(title));
        if (!block) continue;
        const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"], button[aria-label="Dismiss"], button[title="Close"]');
        if (close && !close.disabled && close.getClientRects().length) { handled.set(dialog, title); close.click(); }
    }
}

export default definePlugin({
    name: "CloudCordPopupBlocker",
    description: "choose which promos to block. security, account and error popups stay. use exact titles for other languages.",
    authors: [Devs.Xohus],
    settings,
    start() {
        observer?.disconnect();
        handled = new WeakMap();
        observer = new MutationObserver(scheduleScan);
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "aria-labelledby", "hidden", "style", "class", "disabled"] });
        inspectPopups();
    },
    stop() { observer?.disconnect(); observer = undefined; clearTimeout(scanTimer); scanTimer = undefined; handled = new WeakMap(); }
});

