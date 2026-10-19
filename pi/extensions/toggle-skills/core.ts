import { readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const SESSION_STATE_TYPE = "toggle-skills-session-state";
export const SESSION_STATE_VERSION = 1;

export interface ManagedSkill {
	key: string;
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	globalDisabled: boolean;
	writable: boolean;
	scope: "user" | "project" | "temporary";
	origin: "package" | "top-level";
	source: string;
}

export interface SessionStateData {
	version: 1;
	sessionId: string;
	overrides: Array<[string, boolean]>;
}

export interface FileUpdateResult {
	ok: boolean;
	changed: boolean;
	error?: string;
}

/** Resolve aliases when possible so one skill has a stable per-session identity. */
export function canonicalSkillKey(filePath: string): string {
	try {
		return realpathSync(filePath);
	} catch {
		return resolve(filePath);
	}
}

/**
 * Update only the top-level disable-model-invocation frontmatter key.
 * Other frontmatter and the Markdown body are preserved byte-for-byte.
 */
export function setDisableModelInvocation(content: string, disabled: boolean): string {
	const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
	const source = bom ? content.slice(1) : content;
	const opening = /^---[ \t]*(?:\r?\n)/.exec(source);
	if (!opening) {
		throw new Error("skill file has no YAML frontmatter");
	}

	const frontmatterStart = opening[0].length;
	const remainder = source.slice(frontmatterStart);
	const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(remainder);
	if (!closing || closing.index === undefined) {
		throw new Error("skill file has unterminated YAML frontmatter");
	}

	const frontmatter = remainder.slice(0, closing.index);
	const closingAndBody = remainder.slice(closing.index);
	const eol = source.includes("\r\n") ? "\r\n" : "\n";
	const firstYamlContent = frontmatter
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0 && !line.startsWith("#"));
	if (firstYamlContent?.startsWith("{") || firstYamlContent?.startsWith("[")) {
		throw new Error("flow-style YAML frontmatter is not supported; use block-style frontmatter");
	}
	const keyPattern = /^(?:disable-model-invocation|["']disable-model-invocation["'])[ \t]*:[^\r\n]*(?:\r?\n|$)/gm;
	const matches = [...frontmatter.matchAll(keyPattern)];

	if (disabled && matches.length === 1) {
		const currentLine = matches[0]?.[0] ?? "";
		if (/:[ \t]*true(?:[ \t]*(?:#[^\r\n]*)?)?(?:\r?\n|$)/.test(currentLine)) {
			return content;
		}
	}
	if (!disabled && matches.length === 0) {
		return content;
	}

	let nextFrontmatter = frontmatter.replace(keyPattern, "");
	if (disabled) {
		if (nextFrontmatter.length > 0 && !nextFrontmatter.endsWith("\n")) {
			nextFrontmatter += eol;
		}
		nextFrontmatter += `disable-model-invocation: true${eol}`;
	}

	return `${bom}${opening[0]}${nextFrontmatter}${closingAndBody}`;
}

/** Atomically update a skill file while following symlinks to their real target. */
export function updateSkillFile(filePath: string, disabled: boolean): FileUpdateResult {
	let temporaryPath: string | undefined;
	try {
		const targetPath = canonicalSkillKey(filePath);
		const original = readFileSync(targetPath, "utf8");
		const updated = setDisableModelInvocation(original, disabled);
		if (updated === original) return { ok: true, changed: false };

		const mode = statSync(targetPath).mode;
		temporaryPath = `${targetPath}.toggle-skills-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
		writeFileSync(temporaryPath, updated, { encoding: "utf8", mode });
		renameSync(temporaryPath, targetPath);
		return { ok: true, changed: true };
	} catch (error) {
		if (temporaryPath) {
			try {
				unlinkSync(temporaryPath);
			} catch {
				// Best-effort cleanup only.
			}
		}
		return {
			ok: false,
			changed: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Keep only meaningful session overrides; unknown skill keys are preserved. */
export function normalizeSessionOverrides(
	globalDisabledByKey: ReadonlyMap<string, boolean>,
	overrides: ReadonlyMap<string, boolean>,
): Map<string, boolean> {
	const normalized = new Map<string, boolean>();
	for (const [key, disabled] of overrides) {
		const globalDisabled = globalDisabledByKey.get(key);
		if (globalDisabled === undefined || globalDisabled !== disabled) {
			normalized.set(key, disabled);
		}
	}
	return normalized;
}

export function mapsEqual(
	left: ReadonlyMap<string, boolean>,
	right: ReadonlyMap<string, boolean>,
): boolean {
	if (left.size !== right.size) return false;
	for (const [key, value] of left) {
		if (right.get(key) !== value || !right.has(key)) return false;
	}
	return true;
}

export function encodeSessionState(sessionId: string, overrides: ReadonlyMap<string, boolean>): SessionStateData {
	return {
		version: SESSION_STATE_VERSION,
		sessionId,
		overrides: [...overrides.entries()],
	};
}

export function decodeSessionState(data: unknown, expectedSessionId: string): Map<string, boolean> | undefined {
	if (!data || typeof data !== "object") return undefined;
	const value = data as Partial<SessionStateData>;
	if (value.version !== SESSION_STATE_VERSION || value.sessionId !== expectedSessionId || !Array.isArray(value.overrides)) {
		return undefined;
	}

	const overrides = new Map<string, boolean>();
	for (const entry of value.overrides) {
		if (!Array.isArray(entry) || entry.length !== 2) continue;
		const [key, disabled] = entry;
		if (typeof key === "string" && typeof disabled === "boolean") {
			overrides.set(key, disabled);
		}
	}
	return overrides;
}

/**
 * Replace pi's generated skill block. If every global skill was hidden, insert
 * a session-enabled block immediately before the cwd marker.
 */
export function replaceSkillsPromptBlock(systemPrompt: string, originalBlock: string, replacementBlock: string): string {
	if (originalBlock === replacementBlock) return systemPrompt;

	if (originalBlock) {
		const exactStart = systemPrompt.lastIndexOf(originalBlock);
		if (exactStart >= 0) {
			return `${systemPrompt.slice(0, exactStart)}${replacementBlock}${systemPrompt.slice(exactStart + originalBlock.length)}`;
		}
	}

	if (!replacementBlock) return systemPrompt;
	const cwdMarker = "\nCurrent working directory:";
	const cwdIndex = systemPrompt.lastIndexOf(cwdMarker);
	if (cwdIndex >= 0) {
		return `${systemPrompt.slice(0, cwdIndex)}${replacementBlock}${systemPrompt.slice(cwdIndex)}`;
	}
	return `${systemPrompt}${replacementBlock}`;
}

/** Reconcile a system-prompt string at provider-request time. */
export function reconcileSkillsPromptBlock(
	text: string,
	candidateBlocks: ReadonlyArray<string>,
	desiredBlock: string,
): string {
	const candidates = [...new Set(candidateBlocks.filter(Boolean))].sort((left, right) => right.length - left.length);
	for (const candidate of candidates) {
		const start = text.lastIndexOf(candidate);
		if (start >= 0) {
			return `${text.slice(0, start)}${desiredBlock}${text.slice(start + candidate.length)}`;
		}
	}

	if (!desiredBlock) return text;
	const cwdMarker = "\nCurrent working directory:";
	const cwdIndex = text.lastIndexOf(cwdMarker);
	if (cwdIndex < 0) return text;
	return `${text.slice(0, cwdIndex)}${desiredBlock}${text.slice(cwdIndex)}`;
}

/** Rewrite only strings that look like pi's system prompt, preserving other payload objects by identity. */
export function rewriteSkillsInProviderPayload(
	payload: unknown,
	candidateBlocks: ReadonlyArray<string>,
	desiredBlock: string,
): unknown {
	const seen = new WeakMap<object, unknown>();

	const visit = (value: unknown, systemContext = false): unknown => {
		if (typeof value === "string") {
			return systemContext ? reconcileSkillsPromptBlock(value, candidateBlocks, desiredBlock) : value;
		}
		if (!value || typeof value !== "object") return value;
		const existing = seen.get(value);
		if (existing !== undefined) return existing;

		if (Array.isArray(value)) {
			const next: unknown[] = [];
			seen.set(value, next);
			let changed = false;
			for (const item of value) {
				const rewritten = visit(item, systemContext);
				next.push(rewritten);
				if (rewritten !== item) changed = true;
			}
			if (!changed) {
				seen.set(value, value);
				return value;
			}
			return next;
		}

		if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
			return value;
		}
		const record = value as Record<string, unknown>;
		const next: Record<string, unknown> = {};
		seen.set(value, next);
		let changed = false;
		const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
		const objectIsSystemContext = systemContext || role === "system" || role === "developer";
		for (const [key, item] of Object.entries(record)) {
			const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
			const childIsSystemContext = objectIsSystemContext
				|| normalizedKey === "system"
				|| normalizedKey === "systeminstruction"
				|| normalizedKey === "instructions";
			const rewritten = visit(item, childIsSystemContext);
			next[key] = rewritten;
			if (rewritten !== item) changed = true;
		}
		if (!changed) {
			seen.set(value, value);
			return value;
		}
		return next;
	};

	return visit(payload);
}

export function describeScope(skill: ManagedSkill): string {
	const ownership = skill.scope === "user" ? "user" : skill.scope === "project" ? "project" : "temporary";
	return skill.origin === "package" ? `${ownership} package` : ownership;
}
