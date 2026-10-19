import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ServiceTier = "standard" | "fast";

function currentTier(ctx: ExtensionContext): ServiceTier {
  const entries = ctx.sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== "service-tier") continue;

    const tier = (entry.data as { tier?: unknown } | undefined)?.tier;
    if (tier === "standard" || tier === "fast") return tier;
  }
  return "standard";
}

export default function (pi: ExtensionAPI): void {
  pi.registerShortcut("shift+tab", {
    description: "Toggle response speed",
    handler: (ctx) => {
      const next = currentTier(ctx) === "fast" ? "standard" : "fast";
      pi.sendUserMessage(`/speed ${next}`, {
        deliverAs: "steer",
        expandPromptTemplates: true,
      });
    },
  });
}
