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
                if (file.size > limit * 1024 || !(field === "png" ? ["image/png"] : ["image/png", "image/jpeg", "image/webp"]).includes(file.type)) throw new Error(`Choose ${field === "png" ? "a PNG" : "a PNG, JPEG or WebP"} under ${limit} KB.`);
                const uri = await read(file);
                const image = new Image(); image.src = uri;
                await image.decode();
                if (input.files[0] !== file) return;
                if (field === "png" && (image.naturalWidth > 512 || image.naturalHeight > 512)) throw new Error("Badge dimensions must be 512 × 512 or smaller.");
                draft[field] = field === "png" ? uri.split(",")[1] : uri;
                preview(`#${prefix}Preview`, uri);
                message.textContent = "ready to save";
            } catch (error) { input.value = ""; message.textContent = error.message; }
        });
    }
    function action(id, messageId, work) {
        const button = document.querySelector(id), message = document.querySelector(messageId);
        button.addEventListener("click", async () => {
            button.disabled = true; message.textContent = "saving…";
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
        return result.message || "badge submitted";
    });
    action("#savePictures", "#pictureMessage", async () => {
        const media = Object.fromEntries(["avatar", "banner"].filter(key => draft[key]).map(key => [key, draft[key]]));
        if (!Object.keys(media).length) throw new Error("Choose a profile picture or banner first.");
        await request("/api/cloudcord/profile", media);
        delete draft.avatar; delete draft.banner;
        return "saved — reopen your profile in CloudCord to see your pictures";
    });
    // Restore a verified browser session, including a separate app-handoff cookie.
    request("/api/cloudcord/profile").then(result => {
        editor.hidden = false;
        document.querySelector("#signIn").hidden = true;
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
