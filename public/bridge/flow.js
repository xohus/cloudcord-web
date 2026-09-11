document.addEventListener("DOMContentLoaded", () => {
    const platformButtons = [...document.querySelectorAll("[data-platform]")];
    const clientButtons = [...document.querySelectorAll("[data-client]")];
    const mobilePanel = document.querySelector("#mobile-panel");
    const desktopPanel = document.querySelector("#desktop-panel");
    const installPanel = document.querySelector(".bridge-install");
    const progress = [...document.querySelectorAll(".bridge-progress span")];

    platformButtons.forEach(button => button.classList.remove("is-active"));
    clientButtons.forEach(button => button.classList.remove("is-active"));
    mobilePanel.hidden = true;
    desktopPanel.hidden = true;
    installPanel.hidden = true;

    const setProgress = step => progress.forEach((item, index) => {
        item.classList.toggle("is-current", index + 1 === step);
        item.classList.toggle("is-complete", index + 1 < step);
    });

    platformButtons.forEach(button => {
        const originalHandler = button.onclick;
        button.onclick = event => {
            originalHandler?.call(button, event);
            clientButtons.forEach(client => client.classList.remove("is-active"));
            installPanel.hidden = true;
            setProgress(2);
            document.querySelector(button.dataset.platform === "mobile" ? "#mobile-panel" : "#desktop-panel")
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
        };
    });

    clientButtons.forEach(button => {
        const originalHandler = button.onclick;
        button.onclick = event => {
            originalHandler?.call(button, event);
            const action = document.querySelector("#primary-action");
            action.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg><span>${action.textContent}</span>`;
            installPanel.hidden = false;
            setProgress(3);
            installPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        };
    });
});
