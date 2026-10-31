import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const code = readFileSync("public/studio-launcher.js", "utf8");

function render(src: string, label?: string) {
  const elements: any[] = [];
  const script = { src, dataset: { label }, insertAdjacentElement: (...args: unknown[]) => elements.push(args) };
  const document = {
    currentScript: script,
    createElement: (tag: string): any => ({
      tag, attrs: {}, children: [],
      setAttribute(key: string, value: string) { this.attrs[key] = value; },
      append(...nodes: unknown[]) { this.children.push(...nodes); },
      attachShadow() { this.shadow = document.createElement("shadow"); return this.shadow; },
    }),
  };
  runInNewContext(code, { document, URL });
  return elements[0]?.[1]?.shadow?.children?.[1];
}

describe("website launcher", () => {
  it("opens the script host studio without trusting the embedding website", () => {
    const link = render("https://studio.example.com/studio-launcher.js");
    expect(new URL(link.href).origin).toBe("https://studio.example.com");
    expect(new URL(link.href).pathname).toBe("/studio");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.target).toBe("_blank");
    expect(link.attrs["aria-label"]).toContain("new tab");
  });
  it("keeps merchant labels as text rather than executable markup", () => {
    const label = '<img src=x onerror="alert(1)">';
    expect(render("https://studio.example.com/studio-launcher.js", label).textContent).toBe(label);
  });
  it("rejects insecure remote script hosts", () => {
    expect(render("http://studio.example.com/studio-launcher.js")).toBeUndefined();
  });
});
