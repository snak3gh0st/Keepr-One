import "server-only";

const DEFAULT_FOUNDER_WHATSAPP_GROUP_URL =
  "https://chat.whatsapp.com/J6zgR1GL9VaFVq77OzNcCi?s=cl&p=i&mlu=4";

export function getFounderWhatsappGroupUrl(): string | null {
  const configuredUrl = (
    process.env.FOUNDERS_WHATSAPP_GROUP_URL ?? DEFAULT_FOUNDER_WHATSAPP_GROUP_URL
  ).trim();
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "chat.whatsapp.com" ||
      url.username ||
      url.password ||
      url.port ||
      !/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}
