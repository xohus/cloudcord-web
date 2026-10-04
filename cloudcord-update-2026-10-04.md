## cloudcord update — 344.1 is back ☁️
> big update for ios, profiles, uploads, custom badges and the website. here's everything that changed.

### ios / ipados
- **344.1 is back on the website.** the ios download now points to the updated regular ipa, not the diagnostics build. 331 is still there as an older fallback if you need it.
- **startup / injection fixes.** we're keeping the working original injection setup instead of replacing it for every ui change. the startup crash problems were addressed, and the runtime changes stay separate from the native injector.
- **runtime updates.** updates now fetch the latest commit directly instead of getting stuck on an older cached copy of the main branch.
- **auto update wording.** the client has clearer feedback for checking and saving a runtime update. a saved runtime takes effect after reopening discord; it doesn't replace the running app halfway through.
- **tabs cleaned up.** overview, botcord, profile, add-ons and diagnostics are the main areas. related settings are grouped instead of taking up a separate tab for everything.
- **add-ons.** cloudsync is grouped with add-ons, alongside plugins, themes, fonts and plugin discovery.
- **diagnostics.** recovery tools are inside diagnostics instead of a separate recovery studio tab.

### profile settings
- **more native discord controls.** profile settings use discord-style rows, inputs and buttons instead of the old custom blue panels.
- **rounder controls.** the boxes under toggles were rounded off, and selected profile options are highlighted instead of just saying selected.
- **icons and descriptions.** missing row icons and inconsistent descriptions were addressed so the settings are easier to follow.
- **profile preview.** the preview action opens your discord profile instead of relying on a separate imitation of the profile screen.
- **local edits for other users.** you can change another user's profile appearance on your own client without publishing those edits to everyone else. these are local changes, not edits to their real discord account.
- **website refresh.** manually refreshing your own shared profile can run while the profile settings are open, so your uploaded pictures can be pulled back into the client.

### uploads
- **dedicated /upload page.** badges, profile pictures and banners now have their own upload page instead of being squeezed into the verification page.
- **working file selection.** upload buttons in the modded mobile client send you to the website, where the browser can open the normal file picker.
- **shorter button text.** the action is called upload, not a long explanation about uploading on the website.
- **mobile layout fixes.** section headings no longer sit across broken fieldset borders. spacing, text wrapping and the smaller-screen layout were cleaned up.
- **no forced 512 × 512 source image.** you don't need to prepare an exact-size file. choose your image, keep the whole thing or crop it. large images are optimized before saving, and input files can be up to 25 mb.
- **image cropper.** choose whole image or crop to fit, then adjust zoom and horizontal / vertical position. banners use a wide crop, while profile pictures and badges use a square crop.
- **original files stay unchanged.** cropping creates the uploaded copy; it doesn't overwrite the picture on your device.
- **png handling.** selected pictures are processed for upload, including mobile png files that arrive without a reported file type.
- **keep the picture you didn't change.** uploading a new profile picture keeps your existing banner, and uploading a banner keeps your profile picture.

### verification
- **no forced server join.** connecting your account for profile uploads doesn't force you to join our discord server.
- **account identity only.** the profile verification flow requests your discord identity, not permission to automatically add you to a server.
- **mobile redirect fixed.** completing verification now sends you straight to /upload with a verified browser session instead of losing the destination and sending you back around the verification page.
- **completed means completed.** the old verification controls are hidden after completion instead of leaving the terms checkbox and connect button active.
- **app and browser sessions are separate.** the browser upload session and the client's verification token have their own handoff, so opening uploads doesn't consume the token the app is waiting for.

### custom badges · beta
- **your name, your image.** choose the badge name and image on /upload, then add it from there.
- **approval before publishing.** badges that pass the automated checks are published, then remain available for admin review while live. blocked or unavailable checks don't mean a badge was published.
- **second review.** admins can keep an approved badge or remove it after review. impersonation, copied staff identity, unsafe content and personal information are still not allowed.
- **your badges list.** /upload lists the badges assigned to your account, with a remove button for badges you no longer want.
- **account ownership checks.** removal is restricted to your own badges; supplying another user's badge id doesn't let you delete theirs.
- **profile connection fixed.** the ios profile renderer now reads the published custom badge list from the website instead of leaving those uploads disconnected from the profile.
- **faster refresh.** badges refresh when you return to discord and roughly every five seconds while the app is active. this also picks up deleted badges.
- **less stale caching.** the public badge list no longer has the old 30-second cache delay.
- **no extra name suffix.** we removed the automatic “· custom” text. the displayed name is the name you chose. existing suffixes added by the old publisher are cleaned up too, without changing names you edited yourself.

### admin / website
- **badge review login fix.** the badge review routes now load after the admin session, so they can recognize the same login as the rest of /admin.
- **login checks kept.** anonymous requests still can't review badges, and cross-site review actions remain blocked.
- **download flow updated.** 344.1 is back as the main ios option, with the old broken-build notice removed and 331 kept as a fallback.
- **getcloudcord.com.** use the current website for downloads, verification and uploads, not the old cloudcord.xohus.lol links.

### before you try it
if you're already on the working 344.1 ipa, reopen discord after the runtime update is saved. website changes need the latest deployment too. if a badge isn't in your badges list after adding it, check the upload message first — a badge that wasn't approved or saved can't appear on the profile.

these fixes passed the code and logic checks, including mobile-width upload and crop testing. that doesn't mean every iphone / ipad has been tested, so send us the exact issue if something still breaks.

-# downloads / uploads: https://getcloudcord.com · support: https://discord.gg/EBEZJ84zBT
