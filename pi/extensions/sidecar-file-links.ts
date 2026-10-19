import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Terminal } from "@earendil-works/pi-tui";

const OSC8 = /(\x1b\]8;[^\x00-\x1f\x7f;]*;)([^\x00-\x1f\x7f]*)(\x07|\x1b\\)/g;
const INCOMPLETE_OSC8 = /\x1b(?:\](?:8(?:;[^\x00-\x1f\x7f]*(?:\x1b)?)?)?)?$/;
const MAX_PENDING = 16 * 1024;

export function withDefaultLine(href: string): string {
	// Preserve remote hosts, existing fragments, queries, and directory URLs.
	if (!/^file:\/\/(?:localhost)?\//i.test(href) || /[#?]/.test(href) || href.endsWith("/")) return href;
	try {
		const url = new URL(href);
		if (url.protocol !== "file:" || url.hostname || url.pathname.startsWith("//")) return href;
		decodeURIComponent(url.pathname); // Do not rewrite malformed escapes.
		return `${href}#1`;
	} catch {
		return href;
	}
}

export function rewriteLinks(data: string): string {
	return data.replace(OSC8, (_match, prefix: string, href: string, end: string) =>
		`${prefix}${withDefaultLine(href)}${end}`,
	);
}

export function installOutputFilter(terminal: Pick<Terminal, "write">): () => void {
	const original = terminal.write;
	const hadOwnWrite = Object.hasOwn(terminal, "write");
	let pending = "";
	let enabled = true;
	const write = function (this: Pick<Terminal, "write">, data: string): void {
		if (!enabled) return original.call(this, data);
		data = pending + data;
		pending = "";
		// Pi splits large renders into chunks, including within OSC sequences.
		const incomplete = INCOMPLETE_OSC8.exec(data);
		if (incomplete && incomplete[0].length <= MAX_PENDING) {
			pending = incomplete[0];
			data = data.slice(0, incomplete.index);
		}
		if (data) original.call(this, rewriteLinks(data));
	};
	terminal.write = write;
	return () => {
		if (!enabled) return;
		enabled = false;
		if (pending) original.call(terminal, pending);
		pending = "";
		// Leave another extension's later wrapper intact; ours becomes a pass-through.
		if (terminal.write === write) {
			if (hadOwnWrite) terminal.write = original;
			else Reflect.deleteProperty(terminal, "write");
		}
	};
}

export function isLocalItermTmux(env: NodeJS.ProcessEnv, platform = process.platform): boolean {
	return platform === "darwin" && Boolean(env.TMUX) &&
		!env.SSH_CONNECTION && !env.SSH_CLIENT && !env.SSH_TTY &&
		(env.TERM_PROGRAM === "iTerm.app" || env.LC_TERMINAL === "iTerm2" || Boolean(env.ITERM_SESSION_ID));
}

export default function (pi: ExtensionAPI): void {
	let dispose: (() => void) | undefined;
	pi.on("session_start", (_event, ctx) => {
		dispose?.();
		if (!ctx.hasUI || !isLocalItermTmux(process.env)) return;
		// No generic output hook exists. Use the widget's public TUI terminal,
		// not Markdown-only hooks (which miss built-in tool path hyperlinks).
		ctx.ui.setWidget("sidecar-file-links", (tui) => {
			const remove = installOutputFilter(tui.terminal);
			dispose = remove;
			tui.requestRender(true);
			return { render: () => [], invalidate() {}, dispose: remove };
		}, { placement: "belowEditor" });
	});
	pi.on("session_shutdown", () => dispose?.());
}
