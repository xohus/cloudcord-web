document.addEventListener("DOMContentLoaded", () => {
    const platformButtons = [...document.querySelectorAll("[data-platform]")];
    const clientButtons = [...document.querySelectorAll("[data-client]")];
    const mobilePanel = document.querySelector("#mobile-panel");
    const desktopPanel = document.querySelector("#desktop-panel");
    const installPanel = document.querySelector(".bridge-install");

    platformButtons.forEach(button => button.classList.remove("is-active"));
    clientButtons.forEach(button => button.classList.remove("is-active"));
    mobilePanel.hidden = true;
    desktopPanel.hidden = true;
    installPanel.hidden = true;

    platformButtons.forEach(button => {
        const originalHandler = button.onclick;
        button.onclick = event => {
            originalHandler?.call(button, event);
            clientButtons.forEach(client => client.classList.remove("is-active"));
            installPanel.hidden = true;
            document.querySelector(button.dataset.platform === "mobile" ? "#mobile-panel" : "#desktop-panel")
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
        };
    });

    clientButtons.forEach(button => {
        const originalHandler = button.onclick;
        button.onclick = event => {
            originalHandler?.call(button, event);
            installPanel.hidden = false;
            installPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        };
    });
});
