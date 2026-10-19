import { accessSync, constants } from "node:fs";
import {
	formatSkillsForPrompt,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import {
	SESSION_STATE_TYPE,
	canonicalSkillKey,
	decodeSessionState,
	describeScope,
	encodeSessionState,
	mapsEqual,
	normalizeSessionOverrides,
	replaceSkillsPromptBlock,
	rewriteSkillsInProviderPayload,
	updateSkillFile,
	type ManagedSkill,
} from "./core.ts";
import { ToggleSkillsSelector, type ToggleSkillsSelectorResult } from "./selector.ts";

const COMMAND_DESCRIPTION = "Toggle skill visibility globally or for the current session";
type ToggleAction = "enable" | "disable";
type ToggleScope = "global" | "session";

interface ParsedToggle {
	action: ToggleAction;
	scope: ToggleScope;
	name: string;
}

interface SkillLookup {
	skill?: ManagedSkill;
	ambiguous?: string[];
}

export default function toggleSkillsExtension(pi: ExtensionAPI) {
	let sessionOverrides = new Map<string, boolean>();
	let activeRunSkills: Skill[] = [];
	const knownSkillNames = new Set<string>();

	function setStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(
			"toggle-skills",
			sessionOverrides.size > 0 ? `skills:${sessionOverrides.size} session override${sessionOverrides.size === 1 ? "" : "s"}` : undefined,
		);
	}

	function restoreSessionState(ctx: ExtensionContext): void {
		const sessionId = ctx.sessionManager.getSessionId();
		let restored: Map<string, boolean> | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== SESSION_STATE_TYPE) continue;
			const decoded = decodeSessionState(entry.data, sessionId);
			if (decoded) restored = decoded;
		}
		sessionOverrides = restored ?? new Map();
		setStatus(ctx);
	}

	function persistSessionState(ctx: ExtensionContext): void {
		pi.appendEntry(SESSION_STATE_TYPE, encodeSessionState(ctx.sessionManager.getSessionId(), sessionOverrides));
		setStatus(ctx);
	}

	function getManagedSkills(skills: ReadonlyArray<Skill>): ManagedSkill[] {
		const seen = new Set<string>();
		const managed: ManagedSkill[] = [];
		for (const skill of skills) {
			const key = canonicalSkillKey(skill.filePath);
			knownSkillNames.add(skill.name);
			if (seen.has(key)) continue;
			seen.add(key);
			let writable = true;
			try {
				accessSync(key, constants.W_OK);
			} catch {
				writable = false;
			}
			managed.push({
				key,
				name: skill.name,
				description: skill.description,
				filePath: skill.filePath,
				baseDir: skill.baseDir,
				globalDisabled: skill.disableModelInvocation,
				writable,
				scope: skill.sourceInfo.scope,
				origin: skill.sourceInfo.origin,
				source: skill.sourceInfo.source,
			});
		}
		return managed.sort((left, right) => left.name.localeCompare(right.name));
	}

	function skillsForCommand(ctx: ExtensionCommandContext): ManagedSkill[] {
		return getManagedSkills(ctx.getSystemPromptOptions().skills ?? []);
	}

	function globalMap(skills: ReadonlyArray<ManagedSkill>): Map<string, boolean> {
		return new Map(skills.map((skill) => [skill.key, skill.globalDisabled]));
	}

	function lookupSkill(skills: ReadonlyArray<ManagedSkill>, query: string): SkillLookup {
		const normalized = query.trim().toLowerCase();
		const exact = skills.find((skill) => skill.name.toLowerCase() === normalized);
		if (exact) return { skill: exact };
		for (const matcher of [
			(skill: ManagedSkill) => skill.name.toLowerCase().startsWith(normalized),
			(skill: ManagedSkill) => skill.name.toLowerCase().includes(normalized),
		]) {
			const matches = skills.filter(matcher);
			if (matches.length === 1) return { skill: matches[0] };
			if (matches.length > 1) return { ambiguous: matches.map((skill) => skill.name) };
		}
		return {};
	}

	function reportLookupFailure(ctx: ExtensionCommandContext, name: string, lookup: SkillLookup): void {
		if (lookup.ambiguous) {
			ctx.ui.notify(`Ambiguous skill "${name}": ${lookup.ambiguous.join(", ")}`, "warning");
		} else {
			ctx.ui.notify(`Skill not found: "${name}". Use /toggle-skills list to see loaded skills.`, "warning");
		}
	}

	async function applyDirectToggle(
		ctx: ExtensionCommandContext,
		skill: ManagedSkill,
		action: ToggleAction,
		scope: ToggleScope,
	): Promise<void> {
		const targetDisabled = action === "disable";
		if (scope === "session") {
			const before = new Map(sessionOverrides);
			if (targetDisabled === skill.globalDisabled) sessionOverrides.delete(skill.key);
			else sessionOverrides.set(skill.key, targetDisabled);
			if (mapsEqual(before, sessionOverrides)) {
				ctx.ui.notify(`Skill "${skill.name}" is already ${targetDisabled ? "hidden" : "visible"} in this session.`, "info");
				return;
			}
			persistSessionState(ctx);
			ctx.ui.notify(
				`${targetDisabled ? "Disabled" : "Enabled"} "${skill.name}" for this session only. No reload needed.`,
				"info",
			);
			return;
		}

		if (skill.globalDisabled === targetDisabled) {
			ctx.ui.notify(`Skill "${skill.name}" is already globally ${targetDisabled ? "hidden" : "visible"}.`, "info");
			return;
		}
		if (!skill.writable) {
			ctx.ui.notify(`Cannot update "${skill.name}": ${skill.filePath} is read-only.`, "error");
			return;
		}

		const result = updateSkillFile(skill.filePath, targetDisabled);
		if (!result.ok) {
			ctx.ui.notify(`Failed to update "${skill.name}": ${result.error ?? "unknown error"}`, "error");
			return;
		}

		// Drop an override that became identical to the new persistent setting.
		if (sessionOverrides.get(skill.key) === targetDisabled) {
			sessionOverrides.delete(skill.key);
			persistSessionState(ctx);
		}
		const effective = sessionOverrides.get(skill.key) ?? targetDisabled;
		const overrideNote = effective !== targetDisabled
			? ` Current session remains ${effective ? "hidden" : "visible"} because of its session override.`
			: "";
		ctx.ui.notify(
			`${targetDisabled ? "Disabled" : "Enabled"} "${skill.name}" globally.${overrideNote} Reloading skills…`,
			"info",
		);
		await ctx.reload();
	}

	async function showInteractiveSelector(ctx: ExtensionCommandContext, skills: ManagedSkill[]): Promise<void> {
		if (skills.length === 0) {
			ctx.ui.notify("No loaded skills found.", "warning");
			return;
		}
		if (ctx.mode !== "tui") {
			if (!ctx.hasUI) {
				ctx.ui.notify("/toggle-skills requires TUI/RPC UI; use enable/disable subcommands in this mode.", "error");
				return;
			}
			const scopeChoice = await ctx.ui.select("Skill visibility scope", ["Global (persistent)", "Current session only"]);
			if (!scopeChoice) return;
			const scope: ToggleScope = scopeChoice.startsWith("Global") ? "global" : "session";
			const labels = skills.map((skill) => {
				const disabled = scope === "global"
					? skill.globalDisabled
					: (sessionOverrides.get(skill.key) ?? skill.globalDisabled);
				return `${skill.name} — ${disabled ? "hidden" : "visible"}`;
			});
			const selected = await ctx.ui.select("Pick a skill to toggle", labels);
			if (!selected) return;
			const index = labels.indexOf(selected);
			const skill = skills[index];
			if (!skill) return;
			const currentlyDisabled = scope === "global"
				? skill.globalDisabled
				: (sessionOverrides.get(skill.key) ?? skill.globalDisabled);
			await applyDirectToggle(ctx, skill, currentlyDisabled ? "enable" : "disable", scope);
			return;
		}

		const result = await ctx.ui.custom<ToggleSkillsSelectorResult>((tui, theme, keybindings, done) => {
			const selector = new ToggleSkillsSelector(theme, keybindings, skills, sessionOverrides, done);
			return {
				get focused() {
					return selector.focused;
				},
				set focused(value: boolean) {
					selector.focused = value;
				},
				render: (width: number) => selector.render(width),
				invalidate: () => selector.invalidate(),
				handleInput: (data: string) => {
					selector.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (!result || result.cancelled) {
			ctx.ui.notify("Skill changes cancelled.", "info");
			return;
		}

		const requestedGlobal = new Map(result.globalDisabled);
		const actualGlobal = globalMap(skills);
		const globalSucceeded: Array<{ skill: ManagedSkill; disabled: boolean }> = [];
		const globalFailed: Array<{ skill: ManagedSkill; error: string }> = [];
		for (const skill of skills) {
			const requested = requestedGlobal.get(skill.key) ?? skill.globalDisabled;
			if (requested === skill.globalDisabled) continue;
			if (!skill.writable) {
				globalFailed.push({ skill, error: "read-only" });
				continue;
			}
			const update = updateSkillFile(skill.filePath, requested);
			if (update.ok) {
				actualGlobal.set(skill.key, requested);
				globalSucceeded.push({ skill, disabled: requested });
			} else {
				globalFailed.push({ skill, error: update.error ?? "unknown error" });
			}
		}

		const beforeSession = new Map(sessionOverrides);
		sessionOverrides = normalizeSessionOverrides(actualGlobal, new Map(result.sessionOverrides));
		const sessionChanged = !mapsEqual(beforeSession, sessionOverrides);
		if (sessionChanged) persistSessionState(ctx);

		const summary: string[] = [];
		if (globalSucceeded.length > 0) {
			const hidden = globalSucceeded.filter((change) => change.disabled).length;
			summary.push(`global: ${globalSucceeded.length} changed (${globalSucceeded.length - hidden} visible, ${hidden} hidden)`);
		}
		if (sessionChanged) summary.push(`session: ${sessionOverrides.size} override${sessionOverrides.size === 1 ? "" : "s"}`);
		if (globalFailed.length > 0) summary.push(`${globalFailed.length} global update${globalFailed.length === 1 ? "" : "s"} failed`);

		if (summary.length === 0) {
			ctx.ui.notify("No skill visibility changes to apply.", "info");
			return;
		}
		if (globalFailed.length > 0) {
			const failures = globalFailed.map(({ skill, error }) => `${skill.name}: ${error}`).join("; ");
			ctx.ui.notify(`Skills updated (${summary.join("; ")}). Failures: ${failures}`, "warning");
		} else {
			ctx.ui.notify(`Skills updated (${summary.join("; ")})${globalSucceeded.length > 0 ? ". Reloading…" : "."}`, "info");
		}
		if (globalSucceeded.length > 0) {
			await ctx.reload();
			return;
		}
	}

	function showStatus(ctx: ExtensionCommandContext, skills: ManagedSkill[], requestedScope?: ToggleScope): void {
		if (skills.length === 0) {
			ctx.ui.notify("No loaded skills found.", "info");
			return;
		}
		const lines: string[] = [];
		const visibleGlobal = skills.filter((skill) => !skill.globalDisabled).length;
		const visibleSession = skills.filter((skill) => !(sessionOverrides.get(skill.key) ?? skill.globalDisabled)).length;
		lines.push(`Skills: ${skills.length} loaded · global ${visibleGlobal} visible · session ${visibleSession} visible · ${sessionOverrides.size} session overrides`);
		lines.push("");
		for (const skill of skills) {
			const sessionDisabled = sessionOverrides.get(skill.key) ?? skill.globalDisabled;
			const hasOverride = sessionOverrides.has(skill.key);
			if (requestedScope === "global") {
				lines.push(`  ${skill.globalDisabled ? "✗" : "✓"} ${skill.name} — global ${skill.globalDisabled ? "hidden" : "visible"} · ${describeScope(skill)}`);
			} else if (requestedScope === "session") {
				lines.push(`  ${sessionDisabled ? "✗" : "✓"} ${skill.name} — session ${sessionDisabled ? "hidden" : "visible"}${hasOverride ? " (override)" : " (global)"}`);
			} else {
				lines.push(`  ${sessionDisabled ? "✗" : "✓"} ${skill.name} — global:${skill.globalDisabled ? "hidden" : "visible"} · session:${sessionDisabled ? "hidden" : "visible"}${hasOverride ? "*" : ""}`);
			}
		}
		ctx.ui.notify(lines.join("\n"), "info");
	}

	function parseToggle(args: string): ParsedToggle | undefined {
		const tokens = args.trim().split(/\s+/).filter(Boolean);
		if (tokens.length < 2) return undefined;
		let scope: ToggleScope = "global";
		if (tokens[0] === "global" || tokens[0] === "session") scope = tokens.shift() as ToggleScope;
		const action = tokens.shift();
		if (action !== "enable" && action !== "disable") return undefined;
		const scopeFlagIndex = tokens.findIndex((token) => token === "--session" || token === "--global");
		if (scopeFlagIndex >= 0) {
			scope = tokens[scopeFlagIndex] === "--session" ? "session" : "global";
			tokens.splice(scopeFlagIndex, 1);
		}
		const name = tokens.join(" ").trim();
		if (!name) return undefined;
		return { action, scope, name };
	}

	function showHelp(ctx: ExtensionCommandContext): void {
		ctx.ui.notify([
			"pi toggle-skills commands:",
			"  /toggle-skills                         Open the two-tab selector",
			"  /toggle-skills status [global|session] Show visibility status",
			"  /toggle-skills list                    Same as status",
			"  /toggle-skills enable <name>           Enable persistently (compatibility default)",
			"  /toggle-skills disable <name>          Disable persistently (compatibility default)",
			"  /toggle-skills session enable <name>   Enable for this session only",
			"  /toggle-skills session disable <name>  Disable for this session only",
			"  /toggle-skills reset-session [name]    Clear one/all session overrides",
			"  /toggle-skills help                    Show this help",
			"",
			"Global changes edit disable-model-invocation in the skill file and auto-reload pi.",
			"Session changes rewrite only this session's system prompt; /skill:name remains available in both scopes.",
		].join("\n"), "info");
	}

	pi.registerCommand("toggle-skills", {
		description: COMMAND_DESCRIPTION,
		getArgumentCompletions(prefix: string) {
			const commands = ["status", "list", "enable", "disable", "global enable", "global disable", "session enable", "session disable", "reset-session", "help"];
			const normalized = prefix.toLowerCase();
			const commandMatches = commands.filter((command) => command.startsWith(normalized));
			if (commandMatches.length > 0) return commandMatches.map((value) => ({ value, label: value }));

			const match = prefix.match(/^(?:(?:global|session)\s+)?(?:enable|disable)\s+([^\s]*)$/i);
			if (!match) return null;
			const skillPrefix = (match[1] ?? "").toLowerCase();
			const leading = prefix.slice(0, prefix.length - (match[1]?.length ?? 0));
			const names = [...new Set([
				...knownSkillNames,
				...pi.getCommands()
					.filter((command) => command.source === "skill" && command.name.startsWith("skill:"))
					.map((command) => command.name.slice("skill:".length)),
			])].filter((name) => name.toLowerCase().startsWith(skillPrefix));
			return names.length > 0 ? names.map((name) => ({ value: `${leading}${name}`, label: name })) : null;
		},
		handler: async (rawArgs, ctx) => {
			const args = rawArgs.trim();
			const skills = skillsForCommand(ctx);
			if (!args) {
				await showInteractiveSelector(ctx, skills);
				return;
			}

			const tokens = args.split(/\s+/);
			const command = tokens[0]?.toLowerCase();
			if (command === "help") {
				showHelp(ctx);
				return;
			}
			if (command === "status" || command === "list") {
				const scope = tokens[1] === "global" || tokens[1] === "session" ? tokens[1] : undefined;
				showStatus(ctx, skills, scope);
				return;
			}
			if (command === "reset-session") {
				const name = tokens.slice(1).join(" ").trim();
				if (!name || name === "all") {
					if (sessionOverrides.size === 0) {
						ctx.ui.notify("This session already inherits all global skill settings.", "info");
						return;
					}
					sessionOverrides.clear();
					persistSessionState(ctx);
					ctx.ui.notify("Cleared all current-session skill overrides.", "info");
					return;
				}
				const lookup = lookupSkill(skills, name);
				if (!lookup.skill) {
					reportLookupFailure(ctx, name, lookup);
					return;
				}
				if (!sessionOverrides.delete(lookup.skill.key)) {
					ctx.ui.notify(`Skill "${lookup.skill.name}" already inherits its global setting.`, "info");
					return;
				}
				persistSessionState(ctx);
				ctx.ui.notify(`Skill "${lookup.skill.name}" now inherits its global setting.`, "info");
				return;
			}

			const parsed = parseToggle(args);
			if (!parsed) {
				ctx.ui.notify(`Unknown arguments: "${args}". Use /toggle-skills help.`, "warning");
				return;
			}
			const lookup = lookupSkill(skills, parsed.name);
			if (!lookup.skill) {
				reportLookupFailure(ctx, parsed.name, lookup);
				return;
			}
			await applyDirectToggle(ctx, lookup.skill, parsed.action, parsed.scope);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreSessionState(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreSessionState(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		const skills = event.systemPromptOptions.skills ?? [];
		activeRunSkills = [...skills];
		getManagedSkills(skills);
		const hasReadTool = !event.systemPromptOptions.selectedTools
			|| event.systemPromptOptions.selectedTools.includes("read");
		if (!hasReadTool || sessionOverrides.size === 0 || skills.length === 0) return;

		const adjustedSkills = skills.map((skill) => {
			const override = sessionOverrides.get(canonicalSkillKey(skill.filePath));
			return override === undefined ? skill : { ...skill, disableModelInvocation: override };
		});
		const originalBlock = formatSkillsForPrompt(skills);
		const replacementBlock = formatSkillsForPrompt(adjustedSkills);
		const systemPrompt = replaceSkillsPromptBlock(event.systemPrompt, originalBlock, replacementBlock);
		return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
	});

	pi.on("before_provider_request", async (event) => {
		if (sessionOverrides.size === 0 || activeRunSkills.length === 0) return;
		const adjustedSkills = activeRunSkills.map((skill) => {
			const override = sessionOverrides.get(canonicalSkillKey(skill.filePath));
			return override === undefined ? skill : { ...skill, disableModelInvocation: override };
		});
		const globalBlock = formatSkillsForPrompt(activeRunSkills);
		const adjustedBlock = formatSkillsForPrompt(adjustedSkills);
		const desiredBlock = pi.getActiveTools().includes("read") ? adjustedBlock : "";
		const payload = rewriteSkillsInProviderPayload(event.payload, [adjustedBlock, globalBlock], desiredBlock);
		return payload === event.payload ? undefined : payload;
	});
}
