// 对话质量：拦截“没有明确指代的半句”/奇怪的碎片
//
// 只处理高置信度模式，避免把真实口语（如“我刚看来着”）全部误杀。

export interface QualityIssue {
  code: string;
  reason: string;
}

export function qualityIssues(text: string): QualityIssue[] {
  const value = text.trim();
  if (!value) return [{ code: "empty", reason: "空回复" }];
  const issues: QualityIssue[] = [];
  if (/^还是那句话/.test(value)) {
    issues.push({ code: "dangling_reference", reason: "“还是那句话”没有明确指代" });
  }
  if (/^(那个|这个|刚刚那个)[，,。！？!?\s]/.test(value) && value.length < 40) {
    issues.push({ code: "dangling_reference", reason: "开头指代不清" });
  }
  if (/似的[。！？!?]?$/.test(value) && value.length < 30 && !/[像好像]/.test(value)) {
    issues.push({ code: "simile_missing_object", reason: "比喻缺少本体" });
  }
  if (/(.)\1{4,}/.test(value)) {
    issues.push({ code: "repeated_chars", reason: "重复字符异常" });
  }
  return issues;
}

/** 尽量把奇怪的半句改成能读的短句；改不动就返回空字符串，让调用方丢弃 */
export function softenWeirdText(text: string): string {
  let value = text.trim();
  value = value.replace(/^还是那句话[^。！？!?\n]*[。！？!?]?/g, "").trim();
  value = value.replace(/^(那个|这个|刚刚那个)[，,。！？!?\s]+/g, "").trim();
  value = value.replace(/来着([。！？!?]?)$/g, "$1").trim();
  value = value.replace(/似的([。！？!?]?)$/g, "的感觉$1").trim();
  value = value.replace(/(.)\1{4,}/g, "$1$1");
  return value;
}
