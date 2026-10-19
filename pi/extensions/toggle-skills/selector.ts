import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	fuzzyFilter,
	Input,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type Focusable,
} from "@earendil-works/pi-tui";
import { describeScope, mapsEqual, type ManagedSkill } from "./core.ts";

export type SelectorTab = "global" | "session";

export interface ToggleSkillsSelectorResult {
	cancelled: boolean;
	globalDisabled: Array<[string, boolean]>;
	sessionOverrides: Array<[string, boolean]>;
}

export class ToggleSkillsSelector implements Component, Focusable {
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly done: (result: ToggleSkillsSelectorResult) => void;
	private readonly skills: ManagedSkill[];
	private readonly originalGlobalDisabled: Map<string, boolean>;
	private readonly originalSessionOverrides: Map<string, boolean>;
	private readonly globalDisabled: Map<string, boolean>;
	private readonly sessionOverrides: Map<string, boolean>;
	private readonly searchInput = new Input();

	private activeTab: SelectorTab = "global";
	private filteredSkills: ManagedSkill[];
	private selectedIndex = 0;
	private lastWidth = 80;
	private readonly maxVisible = 10;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(
		theme: Theme,
		keybindings: KeybindingsManager,
		skills: ManagedSkill[],
		sessionOverrides: ReadonlyMap<string, boolean>,
		done: (result: ToggleSkillsSelectorResult) => void,
	) {
		this.theme = theme;
		this.keybindings = keybindings;
		this.done = done;
		this.skills = [...skills];
		this.filteredSkills = [...skills];
		this.originalGlobalDisabled = new Map(skills.map((skill) => [skill.key, skill.globalDisabled]));
		this.globalDisabled = new Map(this.originalGlobalDisabled);
		this.originalSessionOverrides = new Map(sessionOverrides);
		this.sessionOverrides = new Map(sessionOverrides);
	}

	render(width: number): string[] {
		this.lastWidth = Math.max(1, width);
		const lines: string[] = [];
		const border = new DynamicBorder((text: string) => this.theme.fg("accent", text));
		lines.push(...border.render(width));
		lines.push("");
		lines.push(this.theme.fg("accent", this.theme.bold("Toggle Skill Visibility")));
		lines.push(...this.renderTabs(width));
		lines.push(...wrapTextWithAnsi(this.theme.fg("muted", this.tabDescription()), width));
		lines.push("");
		lines.push(...this.searchInput.render(width));
		lines.push("");
		lines.push(...this.renderList(width));
		lines.push("");
		lines.push(...wrapTextWithAnsi(this.renderFooter(), width));
		lines.push(...border.render(width));
		return lines.map((line) => truncateToWidth(line, width, ""));
	}

	handleInput(data: string): void {
		if (
			this.keybindings.matches(data, "tui.input.tab") ||
			matchesKey(data, Key.shift("tab")) ||
			matchesKey(data, Key.left) ||
			matchesKey(data, Key.right)
		) {
			this.activeTab = this.activeTab === "global" ? "session" : "global";
			return;
		}

		if (this.keybindings.matches(data, "tui.select.up")) {
			this.moveSelection(-1);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.down")) {
			this.moveSelection(1);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.confirm")) {
			this.toggleSelected();
			return;
		}

		// Keep parity with pi-toggle-skills: batch operations respect search.
		if (matchesKey(data, Key.ctrl("a"))) {
			this.setFilteredDisabled(true);
			return;
		}
		if (matchesKey(data, Key.ctrl("d"))) {
			this.setFilteredDisabled(false);
			return;
		}
		if (matchesKey(data, Key.ctrl("r")) && this.activeTab === "session") {
			const selected = this.filteredSkills[this.selectedIndex];
			if (selected) this.sessionOverrides.delete(selected.key);
			return;
		}
		if (matchesKey(data, Key.ctrl("s"))) {
			this.finish(false);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
			this.finish(true);
			return;
		}
		if (matchesKey(data, Key.ctrl("c"))) {
			if (this.searchInput.getValue()) {
				this.searchInput.setValue("");
				this.refreshFilter();
			} else {
				this.finish(true);
			}
			return;
		}

		this.searchInput.handleInput(data);
		this.refreshFilter();
	}

	invalidate(): void {
		this.searchInput.invalidate();
	}

	private renderTabs(width: number): string[] {
		const globalLabel = this.activeTab === "global"
			? this.theme.bg("selectedBg", this.theme.fg("accent", " Global · persistent "))
			: this.theme.fg("dim", " Global · persistent ");
		const sessionLabel = this.activeTab === "session"
			? this.theme.bg("selectedBg", this.theme.fg("accent", " Session · current only "))
			: this.theme.fg("dim", " Session · current only ");
		const line = `${globalLabel}  ${sessionLabel}`;
		return visibleWidth(line) <= width ? [line] : [globalLabel, sessionLabel];
	}

	private tabDescription(): string {
		return this.activeTab === "global"
			? "Writes disable-model-invocation in each skill file. Changes persist for future sessions that load that skill."
			: "Overrides model visibility only in this session. Reload/resume keeps it; /new and forks start from the persistent setting.";
	}

	private renderList(width: number): string[] {
		if (this.filteredSkills.length === 0) {
			return [this.theme.fg("muted", "  No matching skills")];
		}

		const lines: string[] = [];
		const startIndex = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(this.maxVisible / 2),
				this.filteredSkills.length - this.maxVisible,
			),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredSkills.length);

		for (let index = startIndex; index < endIndex; index++) {
			const skill = this.filteredSkills[index];
			if (!skill) continue;
			const selected = index === this.selectedIndex;
			const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
			const name = selected ? this.theme.fg("accent", skill.name) : skill.name;
			const disabled = this.effectiveDisabled(skill);
			const status = disabled
				? this.theme.fg("dim", "✗ hidden")
				: this.theme.fg("success", "✓ visible");
			const provenance = this.activeTab === "session"
				? this.theme.fg("dim", this.sessionOverrides.has(skill.key) ? "session" : "global")
				: this.theme.fg("dim", skill.writable ? describeScope(skill) : "read-only");
			const changed = this.itemChanged(skill) ? this.theme.fg("warning", " *") : "";
			lines.push(truncateToWidth(`${prefix}${name}  ${status} · ${provenance}${changed}`, width, ""));
		}

		if (startIndex > 0 || endIndex < this.filteredSkills.length) {
			lines.push(this.theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredSkills.length})`));
		}

		const selected = this.filteredSkills[this.selectedIndex];
		if (selected) {
			lines.push("");
			lines.push(...wrapTextWithAnsi(this.theme.fg("dim", `  Source: ${selected.filePath}`), width));
			lines.push(...wrapTextWithAnsi(this.theme.fg("muted", `  ${selected.description}`), width));
			if (this.activeTab === "session" && this.sessionOverrides.has(selected.key)) {
				lines.push(this.theme.fg("warning", "  Session override active; Ctrl+R resets this skill to global."));
			}
		}
		return lines;
	}

	private renderFooter(): string {
		const disabledCount = this.skills.filter((skill) => this.effectiveDisabled(skill)).length;
		const visibleCount = this.skills.length - disabledCount;
		const confirmKey = this.keybindings.getKeys("tui.select.confirm")[0] ?? "enter";
		const parts = [
			"tab/←→ scope",
			`${confirmKey} toggle`,
			"ctrl+a hide all",
			"ctrl+d show all",
		];
		if (this.activeTab === "session") parts.push("ctrl+r inherit");
		parts.push("ctrl+s save", "esc cancel", `${visibleCount} visible · ${disabledCount} hidden`);
		const footer = `  ${parts.join(" · ")}`;
		return this.hasChanges()
			? `${this.theme.fg("dim", footer)} ${this.theme.fg("warning", "(unsaved)")}`
			: this.theme.fg("dim", footer);
	}

	private effectiveDisabled(skill: ManagedSkill): boolean {
		const globalDisabled = this.globalDisabled.get(skill.key) ?? skill.globalDisabled;
		if (this.activeTab === "global") return globalDisabled;
		return this.sessionOverrides.get(skill.key) ?? globalDisabled;
	}

	private itemChanged(skill: ManagedSkill): boolean {
		if (this.activeTab === "global") {
			return this.globalDisabled.get(skill.key) !== this.originalGlobalDisabled.get(skill.key);
		}
		return this.sessionOverrides.get(skill.key) !== this.originalSessionOverrides.get(skill.key)
			|| this.sessionOverrides.has(skill.key) !== this.originalSessionOverrides.has(skill.key);
	}

	private hasChanges(): boolean {
		return !mapsEqual(this.globalDisabled, this.originalGlobalDisabled)
			|| !mapsEqual(this.sessionOverrides, this.originalSessionOverrides);
	}

	private moveSelection(delta: number): void {
		if (this.filteredSkills.length === 0) return;
		this.selectedIndex = (this.selectedIndex + delta + this.filteredSkills.length) % this.filteredSkills.length;
	}

	private toggleSelected(): void {
		const selected = this.filteredSkills[this.selectedIndex];
		if (!selected) return;
		if (this.activeTab === "global") {
			if (!selected.writable) return;
			const current = this.globalDisabled.get(selected.key) ?? selected.globalDisabled;
			this.globalDisabled.set(selected.key, !current);
			return;
		}

		const globalDisabled = this.globalDisabled.get(selected.key) ?? selected.globalDisabled;
		const current = this.sessionOverrides.get(selected.key) ?? globalDisabled;
		const next = !current;
		if (next === globalDisabled) this.sessionOverrides.delete(selected.key);
		else this.sessionOverrides.set(selected.key, next);
	}

	private setFilteredDisabled(disabled: boolean): void {
		for (const skill of this.filteredSkills) {
			if (this.activeTab === "global") {
				if (skill.writable) this.globalDisabled.set(skill.key, disabled);
				continue;
			}
			const globalDisabled = this.globalDisabled.get(skill.key) ?? skill.globalDisabled;
			if (disabled === globalDisabled) this.sessionOverrides.delete(skill.key);
			else this.sessionOverrides.set(skill.key, disabled);
		}
	}

	private refreshFilter(): void {
		const query = this.searchInput.getValue().trim();
		this.filteredSkills = query
			? fuzzyFilter(this.skills, query, (skill) => `${skill.name} ${skill.description} ${skill.filePath} ${describeScope(skill)}`)
			: [...this.skills];
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredSkills.length - 1));
	}

	private finish(cancelled: boolean): void {
		this.done({
			cancelled,
			globalDisabled: [...this.globalDisabled.entries()],
			sessionOverrides: [...this.sessionOverrides.entries()],
		});
	}
}
