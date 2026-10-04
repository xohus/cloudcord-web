"use strict";
(() => {
    const editor = document.querySelector("#editor");
    const draft = {};
    const headers = () => {
        if (new URLSearchParams(location.search).get("complete") === "1") return {};
        const token = localStorage.getItem("cloudcordMembershipToken");
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
    for (const [field, prefix, limit] of [["png", "badge", 512], ["avatar", "avatar", 750], ["banner", "banner", 750]]) {
        const input = document.querySelector(`#${prefix}File`);
        input.addEventListener("change", async () => {
            const message = document.querySelector(field === "png" ? "#badgeMessage" : "#pictureMessage");
            delete draft[field]; preview(`#${prefix}Preview`, null);
            const file = input.files[0];
            if (!file) return;
            try {
                if (file.size > (field === "png" ? 10 * 1024 * 1024 : limit * 1024)) throw new Error(field === "png" ? "Choose an image under 10 MB." : `Choose a picture under ${limit} KB.`);
                let uri = await read(file);
                const image = new Image();
                await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("This image couldn't be opened. Choose a PNG, JPEG or WebP.")); image.src = uri; });
                if (input.files[0] !== file) return;
                if (field === "png") {
                    const canvas = document.createElement("canvas"), scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
                    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
                    uri = canvas.toDataURL("image/png");
                    if (uri.split(",")[1].length > 699052) throw new Error("The converted PNG is too large. Choose a simpler image.");
                } else if (!/^data:image\/(png|jpeg|webp);base64,/.test(uri)) throw new Error("Choose a PNG, JPEG or WebP.");
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
