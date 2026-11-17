# appraise · v0（Step 5 实现，Step 1 仅占位）

输入：用户一条消息 + 当前关系状态摘要（最近 6 轮 + 情绪态 + 未闭合话题）
输出：严格 JSON

```json
{
  "topic": "工作抱怨",
  "emotion": "疲惫",
  "intensity": 0.6,
  "relation_signal": "寻求安慰",
  "taboo_hit": false,
  "tension_delta": 0.05,
  "needs_memory": true,
  "memory_hint": "加班"
}
```

约束：
- `intensity`、`tension_delta` ∈ [0,1]；`tension_delta` 通常 ≤0.12。
- 禁止输出解释、Markdown、代码块围栏；只输出 JSON。
- 关系到安全阀：`taboo_hit=true` 时交给 Comfort Governor 复核。
