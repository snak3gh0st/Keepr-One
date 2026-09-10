import { afterEach, describe, expect, it, vi } from "vitest";
import { getFounderWhatsappGroupUrl } from "./founder-community-config";

afterEach(() => vi.unstubAllEnvs());

describe("founder WhatsApp group configuration", () => {
  it("uses the founder invitation with its query when no override is supplied", () => {
    vi.stubEnv("FOUNDERS_WHATSAPP_GROUP_URL", undefined);
    expect(getFounderWhatsappGroupUrl()).toBe(
      "https://chat.whatsapp.com/J6zgR1GL9VaFVq77OzNcCi?s=cl&p=i&mlu=4",
    );
  });

  it.each(["", "   "])(
    "disables the invitation for an explicitly empty override: %j",
    (url) => {
      vi.stubEnv("FOUNDERS_WHATSAPP_GROUP_URL", url);
      expect(getFounderWhatsappGroupUrl()).toBeNull();
    },
  );

  it("accepts the HTTPS group invitation and preserves its query", () => {
    vi.stubEnv(
      "FOUNDERS_WHATSAPP_GROUP_URL",
      " https://chat.whatsapp.com/ExampleInvite?mode=gi_t ",
    );
    expect(getFounderWhatsappGroupUrl()).toBe(
      "https://chat.whatsapp.com/ExampleInvite?mode=gi_t",
    );
  });

  it.each([
    "not a url",
    "javascript:alert(1)",
    "http://chat.whatsapp.com/ExampleInvite",
    "https://example.com/ExampleInvite",
    "https://chat.whatsapp.com.example.com/ExampleInvite",
    "https://chat.whatsapp.com/",
    "https://user:pass@chat.whatsapp.com/ExampleInvite",
    "https://chat.whatsapp.com:8443/ExampleInvite",
  ])("rejects an unusable group URL: %s", (url) => {
    vi.stubEnv("FOUNDERS_WHATSAPP_GROUP_URL", url);
    expect(getFounderWhatsappGroupUrl()).toBeNull();
  });
});
