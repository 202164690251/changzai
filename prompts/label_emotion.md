# label_emotion · v0（Step 3 实现，Step 1 仅占位）

输入：连续 20 条消息窗口（保留上下文）。
输出：严格 JSON 数组，一条消息一个对象：

```json
[
  {
    "msg_id": "m_1",
    "valence": -0.4,
    "arousal": 0.6,
    "closeness": 0.7,
    "defensiveness": 0.2,
    "label": "委屈",
    "confidence": 0.8
  }
]
```

约束：
- `valence/arousal ∈ [-1,1]`；`closeness/defensiveness ∈ [0,1]`。
- `label` 只能取 24 个枚举值：喜/怒/哀/惧/厌/惊/委屈/撒娇/敷衍/冷淡/试探/吃醋/愧疚/心疼/怀念/调侃/认真/疲惫/兴奋/焦虑/失望/释然/暧昧/平静。
- 批量 200 条/请求；失败重试 2 次后跳过并记录。
- 校准：随机 200 条人工标注，Cohen's Kappa <0.6 不得上线情绪引擎。
