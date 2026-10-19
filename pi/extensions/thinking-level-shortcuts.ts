import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  function adjustThinkingLevel(direction: -1 | 1, ctx: ExtensionContext): void {
    if (!ctx.model?.reasoning) {
      ctx.ui.notify("Current model does not support thinking", "warning");
      return;
    }

    const levels = getSupportedThinkingLevels(ctx.model);
    const currentIndex = levels.indexOf(pi.getThinkingLevel());
    const nextIndex = Math.min(levels.length - 1, Math.max(0, currentIndex + direction));
    const nextLevel = levels[nextIndex];

    pi.setThinkingLevel(nextLevel);
    ctx.ui.notify(`Thinking level: ${nextLevel}`, "info");
  }

  pi.registerShortcut("ctrl+,", {
    description: "Decrease thinking level",
    handler: (ctx) => adjustThinkingLevel(-1, ctx),
  });

  pi.registerShortcut("ctrl+.", {
    description: "Increase thinking level",
    handler: (ctx) => adjustThinkingLevel(1, ctx),
  });
}
