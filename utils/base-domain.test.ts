import { describe, expect, it } from "vitest";
import { deriveBaseDomain, trackingOriginPatterns } from "./base-domain";

describe("deriveBaseDomain", () => {
  it.each([
    ["manhwa-latino.com", "manhwa-latino.com"],
    ["zai.manhwa-latino.com", "manhwa-latino.com"],
    ["viralikigai.milkchoco.online", "milkchoco.online"],
    ["imagenes.mangasnosekai.com", "mangasnosekai.com"],
    ["example.com.mx", "example.com.mx"],
    ["cdn.example.com.mx", "example.com.mx"],
    ["reader.example.co.uk", "example.co.uk"],
    ["localhost", "localhost"],
  ])("derives %s → %s", (hostname, expected) => {
    expect(deriveBaseDomain(hostname)).toBe(expected);
  });
});

describe("trackingOriginPatterns", () => {
  it("covers both schemes across the whole base domain", () => {
    expect(trackingOriginPatterns("manhwa-latino.com")).toEqual([
      "https://*.manhwa-latino.com/*",
      "http://*.manhwa-latino.com/*",
    ]);
  });

  it("widens a subdomain hostname to its base domain", () => {
    expect(trackingOriginPatterns("viralikigai.milkchoco.online")).toEqual([
      "https://*.milkchoco.online/*",
      "http://*.milkchoco.online/*",
    ]);
  });
});
