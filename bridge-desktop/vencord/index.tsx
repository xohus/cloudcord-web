import { definePluginSettings } from "@api/Settings";
import { Button } from "@webpack/common";
import definePlugin, { OptionType } from "@utils/types";

const API = "https://getcloudcord.com";
const settings = definePluginSettings({
    enabled: { type: OptionType.BOOLEAN, description: "Synchronize CloudCord Fake Profile metadata", default: true },
    botCord: { type: OptionType.BOOLEAN, description: "Show the limited BotCord compatibility entry", default: true },
});
let timer: ReturnType<typeof setInterval> | undefined;
async function pull() {
    const user = (Vencord as any).Webpack?.findByStoreName?.("UserStore")?.getCurrentUser?.();
    if (!user?.id || !settings.store.enabled) return;
    try { const response = await fetch(`${API}/v1/profiles/user/${user.id}?v=${Date.now()}`); if (response.ok) (globalThis as any).__CLOUDCORD_BRIDGE_PROFILE__ = (await response.json()).profile; } catch {}
}
export default definePlugin({
    name: "CloudCordBridge",
    description: "CloudCord Fake Profile, BotCord and basic named badge compatibility.",
    authors: [{ name: "xohus", id: 335041885485662209n }], settings,
    start() { void pull(); timer = setInterval(pull, 15000); },
    stop() { if (timer) clearInterval(timer); timer = undefined; delete (globalThis as any).__CLOUDCORD_BRIDGE_PROFILE__; },
    settingsAboutComponent() { return <Button onClick={() => window.open(`${API}/bridge/`, "_blank")}>Open CloudCord Bridge</Button>; },
});
