// Modified from mitsuhiko/agent-stuff: native macOS notifications, sound control
// and tmux passthrough. Upstream and license details: ../NOTICE.md.
/**
 * Desktop Notification Extension
 *
 * Sends a native desktop notification when the agent finishes and is waiting for input.
 *
 * macOS: uses Notification Center via `osascript` (works in any terminal, including
 * iTerm2 and inside tmux, where OSC escape sequences are unreliable or swallowed).
 * Other platforms: OSC 777 escape sequence - no external dependencies.
 *
 * Terminals supporting OSC 777: Ghostty, WezTerm, foot, rxvt-unicode.
 * Not supported: iTerm2 (OSC 9), Kitty (OSC 99), Terminal.app, Windows Terminal, Alacritty.
 * Inside tmux the sequence is wrapped for passthrough, which additionally requires
 * `tmux set -g allow-passthrough on`.
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";

/**
 * Sound played alongside the notification. Any name from /System/Library/Sounds
 * (Basso, Blow, Bottle, Frog, Funk, Glass, Hero, Morse, Ping, Pop, Purr, Sosumi,
 * Submarine, Tink). Set PI_NOTIFY_SOUND to override, or to "off" to stay silent.
 */
const notificationSound = (): string | null => {
	const configured = process.env.PI_NOTIFY_SOUND?.trim();
	if (configured && /^(off|none|false|0)$/i.test(configured)) {
		return null;
	}
	return configured || "Glass";
};

/** Escape a string for embedding in an AppleScript string literal. */
const escapeAppleScript = (text: string): string =>
	text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Send a notification through macOS Notification Center. */
const notifyMacOS = (title: string, body: string): void => {
	// `display notification` requires a non-empty body, so fall back to the title.
	const message = escapeAppleScript(body || title);
	const sound = notificationSound();
	const soundClause = sound ? ` sound name "${escapeAppleScript(sound)}"` : "";
	const script = `display notification "${message}" with title "${escapeAppleScript(title)}"${soundClause}`;
	const child = spawn("osascript", ["-e", script], { stdio: "ignore", detached: true });
	child.on("error", () => {});
	child.unref();
};

/** tmux only forwards escape sequences wrapped in its passthrough DCS envelope. */
const wrapForTmux = (sequence: string): string =>
	process.env.TMUX ? `\x1bPtmux;${sequence.replace(/\x1b/g, "\x1b\x1b")}\x1b\\` : sequence;

/** Send a desktop notification via OSC 777 escape sequence, plus a terminal bell. */
const notifyOsc777 = (title: string, body: string): void => {
	// OSC 777 format: ESC ] 777 ; notify ; title ; body BEL
	process.stdout.write(wrapForTmux(`\x1b]777;notify;${title};${body}\x07`));
	if (notificationSound()) {
		process.stdout.write("\x07");
	}
};

const notify = (title: string, body: string): void => {
	if (process.platform === "darwin") {
		notifyMacOS(title, body);
		return;
	}
	notifyOsc777(title, body);
};

const isTextPart = (part: unknown): part is { type: "text"; text: string } =>
	Boolean(part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part);

const extractLastAssistantText = (messages: Array<{ role?: string; content?: unknown }>): string | null => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") {
			continue;
		}

		const content = message.content;
		if (typeof content === "string") {
			return content.trim() || null;
		}

		if (Array.isArray(content)) {
			const text = content.filter(isTextPart).map((part) => part.text).join("\n").trim();
			return text || null;
		}

		return null;
	}

	return null;
};

const plainMarkdownTheme: MarkdownTheme = {
	heading: (text) => text,
	link: (text) => text,
	linkUrl: () => "",
	code: (text) => text,
	codeBlock: (text) => text,
	codeBlockBorder: () => "",
	quote: (text) => text,
	quoteBorder: () => "",
	hr: () => "",
	listBullet: () => "",
	bold: (text) => text,
	italic: (text) => text,
	strikethrough: (text) => text,
	underline: (text) => text,
};

const simpleMarkdown = (text: string, width = 80): string => {
	const markdown = new Markdown(text, 0, 0, plainMarkdownTheme);
	return markdown.render(width).join("\n");
};

const formatNotification = (text: string | null): { title: string; body: string } => {
	const simplified = text ? simpleMarkdown(text) : "";
	const normalized = simplified.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return { title: "Ready for input", body: "" };
	}

	const maxBody = 200;
	const body = normalized.length > maxBody ? `${normalized.slice(0, maxBody - 1)}…` : normalized;
	return { title: "π", body };
};

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async (event) => {
		const lastText = extractLastAssistantText(event.messages ?? []);
		const { title, body } = formatNotification(lastText);
		notify(title, body);
	});
}
