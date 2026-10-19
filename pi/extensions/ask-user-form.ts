import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	truncateToWidth,
	type Component,
	type Focusable,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

const QuestionKindSchema = StringEnum(["single", "multi", "input"] as const);

const OptionSchema = Type.Object({
	label: Type.String({ description: "Option label shown to the user" }),
	description: Type.Optional(Type.String({ description: "Short explanation shown below the option" })),
});

const FormQuestionSchema = Type.Object({
	id: Type.String({ description: "Stable identifier returned with the answer" }),
	header: Type.String({ description: "Short tab label" }),
	question: Type.String({ description: "Question shown above the control" }),
	kind: QuestionKindSchema,
	options: Type.Optional(Type.Array(OptionSchema, { description: "Options for single or multi questions" })),
	defaultSelected: Type.Optional(
		Type.Array(Type.String(), {
			description: 'Initially selected option labels. Use ["*"] to select every option.',
		}),
	),
	defaultValue: Type.Optional(Type.String({ description: "Initial editable value for an input question" })),
});

const FormParamsSchema = Type.Object({
	title: Type.Optional(Type.String({ description: "Form title" })),
	questions: Type.Array(FormQuestionSchema, {
		minItems: 1,
		maxItems: 4,
		description: "One to four fields shown in a tabbed confirmation form",
	}),
});

type FormQuestion = {
	id: string;
	header: string;
	question: string;
	kind: "single" | "multi" | "input";
	options: Array<{ label: string; description?: string }>;
	defaultSelected: string[];
	defaultValue: string;
};

type FormAnswer = {
	id: string;
	question: string;
	kind: "single" | "multi" | "input";
	selected?: string[];
	value?: string;
};

type FormResult = {
	answers: FormAnswer[];
	cancelled: boolean;
};

function normalizeQuestions(raw: Array<Record<string, unknown>>): FormQuestion[] {
	return raw.map((question) => ({
		id: String(question.id ?? ""),
		header: String(question.header ?? question.id ?? "Field"),
		question: String(question.question ?? ""),
		kind: question.kind as FormQuestion["kind"],
		options: Array.isArray(question.options)
			? question.options.map((option) => {
				const value = option as { label?: unknown; description?: unknown };
				return {
					label: String(value.label ?? ""),
					...(typeof value.description === "string" ? { description: value.description } : {}),
				};
			})
			: [],
		defaultSelected: Array.isArray(question.defaultSelected)
			? question.defaultSelected.map((label) => String(label))
			: [],
		defaultValue: typeof question.defaultValue === "string" ? question.defaultValue : "",
	}));
}

function validationError(questions: FormQuestion[]): string | undefined {
	const ids = new Set<string>();
	for (const question of questions) {
		if (!question.id || !question.question) return "Every form field requires a non-empty id and question";
		if (ids.has(question.id)) return `Duplicate form field id: ${question.id}`;
		ids.add(question.id);
		if (question.kind !== "input" && question.options.length < 2) {
			return `${question.id} requires at least two options`;
		}
		const labels = new Set(question.options.map((option) => option.label));
		if (labels.size !== question.options.length || labels.has("")) {
			return `${question.id} has empty or duplicate option labels`;
		}
		for (const label of question.defaultSelected) {
			if (label !== "*" && !labels.has(label)) return `${question.id} has unknown default selection: ${label}`;
		}
	}
	return undefined;
}

function makeEditorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (text) => theme.fg("borderMuted", text),
		selectList: {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		},
	};
}

class ParameterForm implements Component, Focusable {
	private currentTab = 0;
	private optionIndex = 0;
	private readonly selected: Array<Set<string>>;
	private readonly editors: Array<Editor | undefined>;
	private _focused = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly keybindings: { matches(data: string, name: string): boolean },
		private readonly title: string,
		private readonly questions: FormQuestion[],
		private readonly done: (result: FormResult) => void,
	) {
		this.selected = questions.map((question) => {
			const defaults = question.defaultSelected.includes("*")
				? question.options.map((option) => option.label)
				: question.defaultSelected;
			return new Set(question.kind === "single" ? defaults.slice(0, 1) : defaults);
		});
		const editorTheme = makeEditorTheme(theme);
		this.editors = questions.map((question) => {
			if (question.kind !== "input") return undefined;
			const editor = new Editor(tui, editorTheme);
			editor.disableSubmit = true;
			editor.setText(question.defaultValue);
			return editor;
		});
		this.syncEditorFocus();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.syncEditorFocus();
	}

	private syncEditorFocus(): void {
		for (let i = 0; i < this.editors.length; i++) {
			const editor = this.editors[i];
			if (editor) editor.focused = this._focused && i === this.currentTab;
		}
	}

	private refresh(): void {
		this.tui.requestRender();
	}

	private setTab(index: number): void {
		const total = this.questions.length + 1;
		this.currentTab = ((index % total) + total) % total;
		this.optionIndex = 0;
		this.syncEditorFocus();
		this.refresh();
	}

	private answers(): FormAnswer[] {
		return this.questions.map((question, index) => {
			if (question.kind === "input") {
				const editor = this.editors[index];
				const value = (editor?.getExpandedText?.() ?? editor?.getText() ?? "").trim();
				return { id: question.id, question: question.question, kind: "input", value };
			}
			const choices = question.options
				.map((option) => option.label)
				.filter((label) => this.selected[index]!.has(label));
			return { id: question.id, question: question.question, kind: question.kind, selected: choices };
		});
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.done({ answers: this.answers(), cancelled: true });
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.setTab(this.currentTab + 1);
			return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			this.setTab(this.currentTab - 1);
			return;
		}

		if (this.currentTab === this.questions.length) {
			if (this.keybindings.matches(data, "tui.input.submit") || this.keybindings.matches(data, "tui.select.confirm")) {
				this.done({ answers: this.answers(), cancelled: false });
			}
			return;
		}

		const question = this.questions[this.currentTab]!;
		if (question.kind === "input") {
			if (this.keybindings.matches(data, "tui.input.submit")) {
				this.setTab(this.currentTab + 1);
				return;
			}
			this.editors[this.currentTab]?.handleInput(data);
			this.refresh();
			return;
		}

		if (this.keybindings.matches(data, "tui.select.up")) {
			this.optionIndex = Math.max(0, this.optionIndex - 1);
			this.refresh();
			return;
		}
		if (this.keybindings.matches(data, "tui.select.down")) {
			this.optionIndex = Math.min(question.options.length - 1, this.optionIndex + 1);
			this.refresh();
			return;
		}
		if (
			matchesKey(data, Key.space) ||
			this.keybindings.matches(data, "tui.select.confirm") ||
			this.keybindings.matches(data, "tui.input.submit")
		) {
			const option = question.options[this.optionIndex];
			if (!option) return;
			const selected = this.selected[this.currentTab]!;
			if (question.kind === "single") {
				selected.clear();
				selected.add(option.label);
				this.setTab(this.currentTab + 1);
				return;
			}
			if (selected.has(option.label)) selected.delete(option.label);
			else selected.add(option.label);
			this.refresh();
		}
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const lines: string[] = [];
		const pushWrapped = (prefix: string, text: string): void => {
			const prefixWidth = visibleWidth(prefix);
			const available = Math.max(1, renderWidth - prefixWidth);
			const wrapped = wrapTextWithAnsi(text, available);
			for (let i = 0; i < wrapped.length; i++) {
				lines.push(truncateToWidth(`${i === 0 ? prefix : " ".repeat(prefixWidth)}${wrapped[i]}`, renderWidth, ""));
			}
		};

		lines.push(this.theme.fg("accent", "─".repeat(renderWidth)));
		pushWrapped(" ", this.theme.fg("accent", this.theme.bold(this.title)));

		const tabText = [
			...this.questions.map((question, index) => {
				const text = ` ${question.header} `;
				return index === this.currentTab
					? this.theme.bg("selectedBg", this.theme.fg("text", text))
					: this.theme.fg("muted", text);
			}),
			this.currentTab === this.questions.length
				? this.theme.bg("selectedBg", this.theme.fg("text", " Confirm "))
				: this.theme.fg("success", " Confirm "),
		].join(" ");
		lines.push(truncateToWidth(` ${tabText}`, renderWidth, "…"));
		lines.push("");

		if (this.currentTab === this.questions.length) {
			pushWrapped(" ", this.theme.fg("text", this.theme.bold("确认参数")));
			lines.push("");
			for (const answer of this.answers()) {
				const question = this.questions.find((item) => item.id === answer.id)!;
				const value = answer.kind === "input" ? answer.value || "(empty)" : answer.selected?.join(", ") || "(none)";
				pushWrapped(" ", `${this.theme.fg("muted", `${question.header}: `)}${this.theme.fg("text", value)}`);
			}
			lines.push("");
			pushWrapped(" ", this.theme.fg("success", "Enter 确认执行"));
		} else {
			const question = this.questions[this.currentTab]!;
			pushWrapped(" ", this.theme.fg("text", question.question));
			lines.push("");
			if (question.kind === "input") {
				const editor = this.editors[this.currentTab]!;
				for (const line of editor.render(Math.max(1, renderWidth - 2))) {
					lines.push(truncateToWidth(` ${line}`, renderWidth, ""));
				}
			} else {
				for (let i = 0; i < question.options.length; i++) {
					const option = question.options[i]!;
					const active = i === this.optionIndex;
					const checked = this.selected[this.currentTab]!.has(option.label);
					const pointer = active ? this.theme.fg("accent", "❯ ") : "  ";
					const mark = question.kind === "multi" ? (checked ? "[✔] " : "[ ] ") : checked ? "(●) " : "( ) ";
					const label = active ? this.theme.fg("accent", this.theme.bold(option.label)) : option.label;
					pushWrapped(pointer, `${this.theme.fg(checked ? "accent" : "muted", mark)}${label}`);
					if (option.description) pushWrapped("      ", this.theme.fg("muted", option.description));
				}
			}
		}

		lines.push("");
		const help =
			this.currentTab === this.questions.length
				? "Enter confirm • Tab/Shift+Tab navigate • Esc cancel"
				: this.questions[this.currentTab]?.kind === "input"
					? "Edit value • Enter/Tab next • Shift+Tab previous • Esc cancel"
					: "↑↓ navigate • Space/Enter toggle • Tab next • Esc cancel";
		pushWrapped(" ", this.theme.fg("dim", help));
		lines.push(this.theme.fg("accent", "─".repeat(renderWidth)));
		return lines;
	}

	invalidate(): void {
		for (const editor of this.editors) editor?.invalidate();
	}
}

export default function askUserForm(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask_user_form",
		label: "Ask User Form",
		description:
			"Show a tabbed confirmation form that supports preselected checkbox options and editable prefilled text inputs. Use this instead of ask_user_question when defaults must already be selected or entered.",
		promptSnippet: "Ask for parameters with preselected multi-choice defaults and prefilled text inputs",
		promptGuidelines: [
			"Use ask_user_form when a workflow requires defaultSelected checkbox values or an editable defaultValue input.",
			'For selecting every multi option initially, pass defaultSelected: ["*"].',
		],
		parameters: FormParamsSchema,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui") {
				return {
					content: [{ type: "text" as const, text: "ask_user_form requires Pi TUI mode" }],
					details: { answers: [], cancelled: true } satisfies FormResult,
				};
			}

			const questions = normalizeQuestions(params.questions as unknown as Array<Record<string, unknown>>);
			const error = validationError(questions);
			if (error) {
				return {
					content: [{ type: "text" as const, text: `Invalid ask_user_form parameters: ${error}` }],
					details: { answers: [], cancelled: true } satisfies FormResult,
				};
			}

			const result = await ctx.ui.custom<FormResult>(
				(tui, theme, keybindings, done) =>
					new ParameterForm(tui, theme, keybindings, params.title || "确认参数", questions, done),
				{
					overlay: true,
					overlayOptions: {
						anchor: "bottom-center",
						width: "100%",
						maxHeight: "100%",
						margin: { left: 0, right: 0, bottom: 0 },
					},
				},
			);

			if (!result || result.cancelled) {
				return {
					content: [{ type: "text" as const, text: "User cancelled the parameter form" }],
					details: result ?? ({ answers: [], cancelled: true } satisfies FormResult),
				};
			}

			const summary = result.answers
				.map((answer) =>
					answer.kind === "input"
						? `${answer.id}=${answer.value ?? ""}`
						: `${answer.id}=${answer.selected?.join(", ") ?? ""}`,
				)
				.join("; ");
			return {
				content: [{ type: "text" as const, text: `User confirmed parameters: ${summary}` }],
				details: result,
			};
		},
	});
}
