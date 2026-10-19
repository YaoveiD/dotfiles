import assert from "node:assert/strict";
import test from "node:test";
import {
	decodeSessionState,
	encodeSessionState,
	normalizeSessionOverrides,
	reconcileSkillsPromptBlock,
	replaceSkillsPromptBlock,
	rewriteSkillsInProviderPayload,
	setDisableModelInvocation,
} from "../core.ts";

test("setDisableModelInvocation adds the key and preserves body/frontmatter text", () => {
	const input = "---\nname: demo\ndescription: Demo\nmetadata:\n  owner: me\n---\n\n# Demo\n\nBody\n";
	const output = setDisableModelInvocation(input, true);
	assert.equal(
		output,
		"---\nname: demo\ndescription: Demo\nmetadata:\n  owner: me\ndisable-model-invocation: true\n---\n\n# Demo\n\nBody\n",
	);
});

test("setDisableModelInvocation removes the key and preserves CRLF", () => {
	const input = "---\r\nname: demo\r\ndisable-model-invocation: true # hidden\r\ndescription: Demo\r\n---\r\n# Body\r\n";
	const output = setDisableModelInvocation(input, false);
	assert.equal(output, "---\r\nname: demo\r\ndescription: Demo\r\n---\r\n# Body\r\n");
});

test("setDisableModelInvocation leaves an existing true key byte-identical", () => {
	const input = "---\nname: demo\ndisable-model-invocation: true # keep this comment\ndescription: Demo\n---\nBody";
	assert.equal(setDisableModelInvocation(input, true), input);
});

test("setDisableModelInvocation removes quoted key variants", () => {
	const input = "---\nname: demo\n'disable-model-invocation': true\ndescription: Demo\n---\nBody";
	assert.equal(setDisableModelInvocation(input, false), "---\nname: demo\ndescription: Demo\n---\nBody");
});

test("setDisableModelInvocation rejects files without frontmatter", () => {
	assert.throws(() => setDisableModelInvocation("# Demo\n", true), /no YAML frontmatter/);
});

test("setDisableModelInvocation rejects flow-style YAML instead of corrupting it", () => {
	const input = "---\n{name: demo, description: Demo}\n---\nBody";
	assert.throws(() => setDisableModelInvocation(input, true), /flow-style YAML/);
	assert.throws(() => setDisableModelInvocation(input, false), /flow-style YAML/);
});

test("replaceSkillsPromptBlock replaces pi's exact generated block", () => {
	const original = "\n\nThe following skills provide specialized instructions for specific tasks.\n<available_skills>\nold\n</available_skills>";
	const replacement = "\n\nThe following skills provide specialized instructions for specific tasks.\n<available_skills>\nnew\n</available_skills>";
	assert.equal(
		replaceSkillsPromptBlock(`prefix${original}\nCurrent working directory: /tmp`, original, replacement),
		`prefix${replacement}\nCurrent working directory: /tmp`,
	);
});

test("replaceSkillsPromptBlock inserts session-enabled skills before cwd when global block is empty", () => {
	const replacement = "\n\nThe following skills provide specialized instructions for specific tasks.\n<available_skills>\nnew\n</available_skills>";
	assert.equal(
		replaceSkillsPromptBlock("prefix\nCurrent working directory: /tmp", "", replacement),
		`prefix${replacement}\nCurrent working directory: /tmp`,
	);
});

test("replaceSkillsPromptBlock removes the generated block when session hides every skill", () => {
	const original = "\n\nThe following skills provide specialized instructions for specific tasks.\n<available_skills>\nold\n</available_skills>";
	assert.equal(
		replaceSkillsPromptBlock(`prefix${original}\nCurrent working directory: /tmp`, original, ""),
		"prefix\nCurrent working directory: /tmp",
	);
});

test("replaceSkillsPromptBlock does not overwrite a custom lookalike when the global block is empty", () => {
	const custom = "The following skills provide specialized instructions for specific tasks.\n<available_skills>custom</available_skills>";
	const replacement = "\n\nThe following skills provide specialized instructions for specific tasks.\n<available_skills>session</available_skills>";
	assert.equal(
		replaceSkillsPromptBlock(`${custom}\nCurrent working directory: /tmp`, "", replacement),
		`${custom}${replacement}\nCurrent working directory: /tmp`,
	);
});

test("provider payload reconciliation follows dynamic read-tool visibility", () => {
	const globalBlock = "\n\n<available_skills>global</available_skills>";
	const adjustedBlock = "\n\n<available_skills>session</available_skills>";
	const prompt = `System${adjustedBlock}\nCurrent working directory: /tmp`;
	const withoutRead = rewriteSkillsInProviderPayload(
		{ instructions: prompt, input: "user text\nCurrent working directory: must not change" },
		[adjustedBlock, globalBlock],
		"",
	) as { instructions: string; input: string };
	assert.equal(withoutRead.instructions, "System\nCurrent working directory: /tmp");
	assert.equal(withoutRead.input, "user text\nCurrent working directory: must not change");

	const addedRead = rewriteSkillsInProviderPayload(
		{ messages: [{ role: "system", content: "System\nCurrent working directory: /tmp" }] },
		[adjustedBlock, globalBlock],
		adjustedBlock,
	) as { messages: Array<{ content: string }> };
	assert.equal(addedRead.messages[0]?.content, `System${adjustedBlock}\nCurrent working directory: /tmp`);
});

test("reconcileSkillsPromptBlock targets the last matching block", () => {
	const block = "\n\n<available_skills>same</available_skills>";
	assert.equal(
		reconcileSkillsPromptBlock(`custom${block}\nsystem${block}\nCurrent working directory: /tmp`, [block], ""),
		`custom${block}\nsystem\nCurrent working directory: /tmp`,
	);
});

test("normalizeSessionOverrides drops values equal to global and preserves unknown keys", () => {
	const globals = new Map([["a", false], ["b", true]]);
	const overrides = new Map([["a", false], ["b", false], ["missing", true]]);
	assert.deepEqual([...normalizeSessionOverrides(globals, overrides)], [["b", false], ["missing", true]]);
});

test("session state round-trips only for the originating session id", () => {
	const encoded = encodeSessionState("session-a", new Map([["/skill", true]]));
	assert.deepEqual([...decodeSessionState(encoded, "session-a")!], [["/skill", true]]);
	assert.equal(decodeSessionState(encoded, "session-b"), undefined);
});
