"use strict";
(() => {
    const editor = document.querySelector("#editor");
    const draft = {};
    const headers = () => {
        if (new URLSearchParams(location.search).get("complete") === "1") return {};
        let token;
        try { token = localStorage.getItem("cloudcordMembershipToken"); } catch { /* Cookie verification still works when browser storage is blocked. */ }
        return token ? { Authorization: `Bearer ${token}` } : {};
    };
    const request = async (url, body) => {
        const response = await fetch(url, {
            credentials: "same-origin", cache: "no-store",
            method: body ? "POST" : "GET",
            headers: { ...headers(), ...(body ? { "Content-Type": "application/json" } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || result.error || "Couldn't save. Try verifying your Discord again.");
        return result;
    };
    const read = file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Couldn't read this file."));
        reader.readAsDataURL(file);
    });
    const preview = (id, uri) => {
        const image = document.querySelector(id);
        image.hidden = !uri;
        if (uri) image.src = uri;
    };
    let cropping = false;
    function cropImage(image, field) {
        return new Promise(resolve => {
            const dialog = document.querySelector("#cropDialog"), canvas = document.querySelector("#cropCanvas");
            const mode = document.querySelector("#cropMode"), zoom = document.querySelector("#cropZoom"), x = document.querySelector("#cropX"), y = document.querySelector("#cropY");
            mode.value = "full"; zoom.value = "1"; x.value = y.value = "50";
            let region;
            function draw() {
                const w = image.naturalWidth, h = image.naturalHeight, ratio = field === "banner" ? 3 : 1;
                region = { x: 0, y: 0, w, h };
                document.querySelector("#cropControls").hidden = mode.value !== "crop";
                if (mode.value === "crop") {
                    const cw = Math.min(w, h * ratio) / Number(zoom.value), ch = cw / ratio;
                    region = { x: (w - cw) * Number(x.value) / 100, y: (h - ch) * Number(y.value) / 100, w: cw, h: ch };
                }
                const scale = Math.min(1, 440 / region.w, 260 / region.h);
                canvas.width = Math.max(1, Math.round(region.w * scale)); canvas.height = Math.max(1, Math.round(region.h * scale));
                canvas.getContext("2d").drawImage(image, region.x, region.y, region.w, region.h, 0, 0, canvas.width, canvas.height);
            }
            const finish = value => { dialog.close(); cropping = false; resolve(value); };
            for (const control of [mode, zoom, x, y]) control.oninput = draw;
            document.querySelector("#cropCancel").onclick = () => finish(null);
            dialog.oncancel = event => { event.preventDefault(); finish(null); };
            document.querySelector("#cropApply").onclick = () => {
                const output = document.createElement("canvas"), limit = field === "png" ? 512 * 1024 : 750 * 1024;
                let scale = Math.min(1, (field === "banner" ? 2048 : 1024) / Math.max(region.w, region.h)), uri;
                for (let attempt = 0; attempt < 14; attempt++) {
                    output.width = Math.max(1, Math.round(region.w * scale)); output.height = Math.max(1, Math.round(region.h * scale));
                    output.getContext("2d").drawImage(image, region.x, region.y, region.w, region.h, 0, 0, output.width, output.height);
                    uri = output.toDataURL("image/png");
                    if (uri.split(",")[1].length * 3 / 4 <= limit) return finish(uri);
                    scale *= 0.8;
                }
                finish(null);
            };
            cropping = true; draw(); dialog.showModal();
        });
    }
    for (const [field, prefix] of [["png", "badge"], ["avatar", "avatar"], ["banner", "banner"]]) {
        const input = document.querySelector(`#${prefix}File`);
        input.addEventListener("change", async () => {
            const message = document.querySelector(field === "png" ? "#badgeMessage" : "#pictureMessage");
            if (cropping) { message.textContent = "Finish adjusting your current image first."; return; }
            const file = input.files[0];
            if (!file) return;
            try {
                if (file.size > 25 * 1024 * 1024) throw new Error("Choose an image under 25 MB. Any image dimensions are supported.");
                let uri = await read(file);
                if (!file.type && /\.png$/i.test(file.name)) uri = uri.replace(/^data:[^;]*;/, "data:image/png;");
                const image = new Image();
                await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("This image couldn't be opened. Choose a PNG, JPEG or WebP.")); image.src = uri; });
                if (input.files[0] !== file) return;
                uri = await cropImage(image, field);
                if (!uri) { input.value = ""; message.textContent = "Image selection cancelled. Your saved picture is unchanged."; return; }
                draft[field] = field === "png" ? uri.split(",")[1] : uri;
                preview(`#${prefix}Preview`, uri);
                message.textContent = "Ready to save.";
            } catch (error) { input.value = ""; message.textContent = error.message; }
        });
    }
    function action(id, messageId, work) {
        const button = document.querySelector(id), message = document.querySelector(messageId);
        button.addEventListener("click", async () => {
            button.disabled = true; message.textContent = "Saving…";
            try { message.textContent = await work(); }
            catch (error) { message.textContent = error.message; }
            finally { button.disabled = false; }
        });
    }
    action("#submitBadge", "#badgeMessage", async () => {
        const name = document.querySelector("#badgeName").value.trim();
        if (!name || !draft.png) throw new Error("Choose a badge name and PNG first.");
        const result = await request("/v1/badge-submissions", { name, png: draft.png });
        delete draft.png;
        document.querySelector("#badgeFile").value = "";
        preview("#badgePreview", null);
        await loadBadges();
        return result.message || "Badge added.";
    });
    action("#savePictures", "#pictureMessage", async () => {
        const media = Object.fromEntries(["avatar", "banner"].filter(key => draft[key]).map(key => [key, draft[key]]));
        if (!Object.keys(media).length) throw new Error("Choose a profile picture or banner first.");
        await request("/api/cloudcord/profile", media);
        delete draft.avatar; delete draft.banner;
        return "Saved. Refresh your profile in CloudCord to see your pictures.";
    });
    async function loadBadges() {
        const result = await request("/v1/badge-submissions"), list = document.querySelector("#badgeList");
        list.replaceChildren();
        if (!result.badges?.length) { list.textContent = "No custom badges yet."; return; }
        for (const badge of result.badges) {
            const row = document.createElement("div"), name = document.createElement("span"), remove = document.createElement("button");
            name.textContent = badge.name; remove.textContent = "Remove"; remove.className = "button"; remove.type = "button";
            remove.addEventListener("click", async () => {
                if (!confirm("Remove this badge from your profile?")) return;
                remove.disabled = true;
                try { await request("/v1/badge-submissions/" + encodeURIComponent(badge.id) + "/remove", {}); await loadBadges(); }
                catch (error) { document.querySelector("#badgeMessage").textContent = error.message; remove.disabled = false; }
            });
            row.append(name, remove); list.append(row);
        }
    }
    // Restore a verified browser session, including a separate app-handoff cookie.
    loadBadges().then(async () => {
        editor.hidden = false;
        document.querySelector("#signIn").hidden = true;
        const result = await request("/api/cloudcord/profile").catch(() => ({ profile: {} }));
        for (const field of ["avatar", "banner"]) {
            const uri = result.profile?.[field];
            if (typeof uri === "string" && /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(uri)) preview(`#${field}Preview`, uri);
        }
        dispatchEvent(new Event("cloudcord-profile-verified"));
    }).catch(() => {
        editor.hidden = true;
        document.querySelector("#status").textContent = "Verify your Discord account to continue. If you're already verified, try signing in again.";
    });
})();
