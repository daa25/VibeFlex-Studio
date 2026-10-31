/* VibeFlex Studio website launcher. No customer data or credentials are collected. */
(() => {
  "use strict";
  const script = document.currentScript;
  if (!script || !script.src) return;
  const source = new URL(script.src);
  if (source.protocol !== "https:" && source.hostname !== "localhost") return;
  const studio = new URL("/studio", source.origin);
  studio.searchParams.set("utm_source", "website-launcher");
  studio.searchParams.set("utm_medium", "referral");
  const mount = document.createElement("span");
  mount.setAttribute("data-vibeflex-launcher", "");
  const root = mount.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = "a{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:48px;padding:14px 24px;border:2px solid transparent;border-radius:12px;background:#2563eb;color:#fff;font:600 16px/1.3 system-ui,sans-serif;text-decoration:none}a:hover{background:#1d4ed8}a:focus-visible{outline:3px solid #2563eb;outline-offset:4px}";
  const link = document.createElement("a");
  link.href = studio.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = script.dataset.label || "Customize with VibeFlex Studio";
  link.setAttribute("aria-label", `${link.textContent} (opens in a new tab)`);
  root.append(style, link);
  script.insertAdjacentElement("afterend", mount);
})();
