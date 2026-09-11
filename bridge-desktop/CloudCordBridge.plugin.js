/**
 * @name CloudCordBridge
 * @author xohus
 * @description CloudCord Fake Profile, BotCord and basic badge compatibility.
 * @version 0.1.0
 * @website https://getcloudcord.com/bridge/
 * @source https://getcloudcord.com/bridge/CloudCordBridge.plugin.js
 */
module.exports = class CloudCordBridge {
  constructor() { this.api = new BdApi("CloudCordBridge"); this.base = "https://getcloudcord.com"; this.timer = null; this.profile = {}; }
  async request(path, options) { const response = await fetch(this.base + path, options); if (!response.ok) throw new Error(`CloudCord sync failed (${response.status})`); return response.json(); }
  currentId() { try { return BdApi.Webpack.getStore("UserStore")?.getCurrentUser?.()?.id; } catch { return null; } }
  async pull() { const id = this.currentId(); if (!id) return; try { const data = await this.request(`/v1/profiles/user/${id}?v=${Date.now()}`); this.profile = data.profile || data; this.api.Data.save("profile", this.profile); } catch {} }
  async publish(profile) { const ownerId = this.currentId(); if (!ownerId) throw new Error("Open Discord before saving."); const saved = this.api.Data.load("share") || {}; const path = saved.id ? `/v1/profiles/${encodeURIComponent(saved.id)}` : "/v1/profiles"; let response = await fetch(this.base + path, { method: saved.id ? "PUT" : "POST", headers: { "Content-Type": "application/json", ...(saved.editToken ? { Authorization: `Bearer ${saved.editToken}` } : {}) }, body: JSON.stringify({ ownerId, profile }) }); if (saved.id && (response.status === 401 || response.status === 404)) { this.api.Data.delete("share"); return this.publish(profile); } if (!response.ok) throw new Error(`CloudCord sync failed (${response.status})`); const result = await response.json(); if (!saved.id) this.api.Data.save("share", { id: result.id, editToken: result.editToken }); this.profile = profile; this.api.Data.save("profile", profile); }
  start() { this.profile = this.api.Data.load("profile") || {}; this.pull(); this.timer = setInterval(() => this.pull(), 15000); this.api.UI.showToast("CloudCord Bridge connected", { type: "success" }); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.api.Patcher.unpatchAll(); }
  getSettingsPanel() { const React = BdApi.React; const bridge = this; return React.createElement(function Settings(){ const [p,setP]=React.useState({...bridge.profile}); const field=(label,key,type="text")=>React.createElement("label",{style:{display:"grid",gap:6,marginBottom:14}},label,React.createElement("input",{type,value:p[key]||"",onChange:e=>setP({...p,[key]:e.target.value}),style:{padding:10,borderRadius:6}})); return React.createElement("div",{style:{padding:20,maxWidth:620}},React.createElement("h2",null,"CloudCord Bridge"),React.createElement("p",null,"Fake Profile and basic named badge synchronization."),field("Display name","globalName"),field("Pronouns","pronouns"),field("Bio","bio"),field("Nitro subscriber date","nitroSince","date"),React.createElement("button",{onClick:async()=>{try{await bridge.publish(p);bridge.api.UI.showToast("Profile synchronized",{type:"success"});}catch(e){bridge.api.UI.showToast(e.message,{type:"error"});}},style:{padding:"10px 16px",marginRight:8}},"Save & Sync"),React.createElement("button",{onClick:()=>window.open("https://getcloudcord.com/botcord","_blank"),style:{padding:"10px 16px"}},"Open BotCord")); }); }
};
