import { definePluginSettings } from "@api/Settings";
import { Button, React, UserStore } from "@webpack/common";
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
async function publish(profile: Record<string, string>) {
    const ownerId = UserStore.getCurrentUser()?.id;
    if (!ownerId) throw new Error("Discord account unavailable");
    const saved = JSON.parse(localStorage.getItem("cloudcord-bridge-share") || "{}");
    const path = saved.id ? `/v1/profiles/${encodeURIComponent(saved.id)}` : "/v1/profiles";
    const response = await fetch(API + path, { method: saved.id ? "PUT" : "POST", headers: { "Content-Type": "application/json", ...(saved.editToken ? { Authorization: `Bearer ${saved.editToken}` } : {}) }, body: JSON.stringify({ ownerId, profile }) });
    if (!response.ok) throw new Error(`Sync failed (${response.status})`);
    const result = await response.json();
    if (!saved.id) localStorage.setItem("cloudcord-bridge-share", JSON.stringify({ id: result.id, editToken: result.editToken }));
    (globalThis as any).__CLOUDCORD_BRIDGE_PROFILE__ = profile;
}
function BridgePanel() {
    const [tab, setTab] = React.useState("profile");
    const [profile, setProfile] = React.useState<Record<string, string>>(() => (globalThis as any).__CLOUDCORD_BRIDGE_PROFILE__ || {});
    const [status, setStatus] = React.useState("");
    const field = (label: string, key: string, type = "text") => <label style={{ display: "grid", gap: 6, marginBottom: 12, fontWeight: 600 }}>{label}<input type={type} value={profile[key] || ""} onChange={e => setProfile({ ...profile, [key]: e.currentTarget.value })} style={{ padding: 10, borderRadius: 6 }} /></label>;
    return <div style={{ maxWidth: 620 }}><div style={{ display: "flex", gap: 8, marginBottom: 18 }}><Button onClick={() => setTab("profile")}>Fake Profile</Button><Button onClick={() => setTab("botcord")}>BotCord</Button></div>{tab === "profile" ? <div>{field("Display name", "globalName")}{field("Pronouns", "pronouns")}{field("Bio", "bio")}{field("Nitro subscriber date", "nitroSince", "date")}<Button onClick={async () => { setStatus("Saving…"); try { await publish(profile); setStatus("Profile synchronized"); } catch (e) { setStatus(String(e)); } }}>Save & Sync</Button><div style={{ marginTop: 8 }}>{status}</div></div> : <div><h3>BotCord</h3><p>Open the limited BotCord compatibility interface. Bridge does not store bot credentials.</p><Button onClick={() => window.open(`${API}/botcord`, "_blank")}>Open BotCord</Button></div>}</div>;
}
export default definePlugin({
    name: "CloudCordBridge",
    description: "CloudCord Fake Profile, BotCord and basic named badge compatibility.",
    authors: [{ name: "xohus", id: 335041885485662209n }], settings,
    start() { void pull(); timer = setInterval(pull, 15000); },
    stop() { if (timer) clearInterval(timer); timer = undefined; delete (globalThis as any).__CLOUDCORD_BRIDGE_PROFILE__; },
    settingsAboutComponent: BridgePanel,
});
