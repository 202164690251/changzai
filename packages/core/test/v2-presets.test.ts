// v2.0 · 8 个性格模板 + 结构化自定义
import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONA_PRESETS,
  buildPresetPersona,
  buildCustomPersona,
  buildPresetRelationship,
  buildCustomRelationship,
  findPersonaPreset,
  personaHeadline,
  buildSystemPrompt,
  type CustomPersonaForm,
} from "../src/index.ts";

test("presets：8 个模板，结构完整", () => {
  assert.equal(PERSONA_PRESETS.length, 8);
  assert.equal(new Set(PERSONA_PRESETS.map((preset) => preset.id)).size, 8);
  for (const preset of PERSONA_PRESETS) {
    const profile = buildPresetPersona(preset, 1_700_000_000_000);
    assert.equal(profile.origin, "preset");
    assert.equal(profile.preset_id, preset.id);
    assert.ok(profile.samples.length >= 3);
    assert.ok(profile.style.avg_len > 0);
    assert.ok(profile.summary.length > 0);
    assert.ok(profile.boundaries.length >= 3);
    assert.equal(personaHeadline(profile), "预设人格 · 本地模板");
  }
});

test("presets：能找到指定模板，关系有默认值", () => {
  const preset = findPersonaPreset("gentle");
  assert.ok(preset);
  const relation = buildPresetRelationship(preset!, "CC", 1_700_000_000_000);
  assert.equal(relation.type, "朋友");
  assert.equal(relation.confidence, 1);
  assert.ok(relation.summary.includes("朋友"));
});

test("custom：字段进入人格卡与 prompt", () => {
  const form: CustomPersonaForm = {
    name: "小雨",
    identity: "一个喜欢看书、说话慢的人",
    relation: "朋友",
    tone: "gentle",
    sentenceLength: "short",
    initiative: 0.4,
    emojiLevel: 0.1,
    catchphrases: ["慢慢来"],
    likes: ["雨天", "热茶"],
    dislikes: ["被催"],
    boundaries: ["不要提工作"],
    advancedPrompt: "偶尔会用反问句",
  };
  const profile = buildCustomPersona(form, 1_700_000_000_000);
  assert.equal(profile.origin, "custom");
  assert.equal(profile.custom_prompt, "偶尔会用反问句");
  assert.ok(profile.facts.some((fact) => fact.text === "雨天"));
  assert.ok(profile.boundaries.some((rule) => rule.includes("不要提工作")));
  const prompt = buildSystemPrompt(profile, { name: "小雨", selfName: "CC" });
  assert.ok(prompt.includes("小雨"));
  assert.ok(prompt.includes("慢慢来"));
  const relation = buildCustomRelationship(form, "CC", 1_700_000_000_000);
  assert.equal(relation.type, "朋友");
  assert.equal(relation.userName, "CC");
});
