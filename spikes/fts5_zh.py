# 常在 · Step 1 spike：FTS5 中文检索对比（unicode61 vs trigram）
# 目的：
#   1) 验证 SQLite FTS5 默认分词对中文是否可用；
#   2) 验证 external-content FTS5 表必须配同步触发器，否则插入不进索引。
# 运行：python spikes/fts5_zh.py --out spikes/results/fts5-zh.json
import argparse
import json
import os
import random
import sqlite3
import time

random.seed(20261117)

# 生成 1000 个互不相同的 3 字中文词（每个只出现在一条文档里），保证召回可判定
CHARS = "梧桐雨伞便利店面馆保温杯相机地铁梧桐树枇杷膏旧衬衫猫咖奶茶糖蛋糕海边生日药片便利店"
CH = list(dict.fromkeys(CHARS))
TOKENS = []
for a in CH:
    for b in CH:
        for c in CH[:8]:
            t = f"{a}{b}{c}"
            if len(set(t)) >= 2:
                TOKENS.append(t)
random.shuffle(TOKENS)
TOKENS = TOKENS[:1000]
assert len(set(TOKENS)) == 1000

FILLERS = [
    "今天下班路上看到", "你还记得吗", "我昨天又梦到", "那会儿我们经常去", "突然想起",
    "路过的时候", "在抽屉里翻到", "朋友圈里有人发", "其实我一直留着", "好像是在",
]
TAILS = ["，那天下了小雨，我站了很久。", "，后来我们再也没有回去过。", "，我把这件事写进了备忘录。"]


def make_doc(i):
    token = TOKENS[i]
    filler = random.choice(FILLERS)
    tail = random.choice(TAILS)
    # 把唯一 token 放进句子中，使其只出现在这一条文档里
    return f"{filler}{token}{tail}"


def build_db(tokenizer):
    con = sqlite3.connect(":memory:")
    con.execute(f"CREATE VIRTUAL TABLE docs USING fts5(text, tokenize='{tokenizer}')")
    docs = [make_doc(i) for i in range(1000)]
    t0 = time.perf_counter()
    con.executemany("INSERT INTO docs(text) VALUES (?)", [(d,) for d in docs])
    build_ms = (time.perf_counter() - t0) * 1000
    return con, docs, build_ms


def recall_at_5(con, tokenizer):
    """用每条文档的唯一 3 字词检索，检查目标文档是否进 top5。"""
    targets = random.sample(range(1000), 50)
    hits = 0
    lat = []
    for i in targets:
        q = TOKENS[i]
        t0 = time.perf_counter()
        try:
            rows = con.execute(
                "SELECT rowid FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT 5", (f'"{q}"',)
            ).fetchall()
        except Exception:
            rows = []
        lat.append((time.perf_counter() - t0) * 1000)
        # 目标文档在第 i+1 行 → rowid = i+1
        if (i + 1) in [r[0] for r in rows]:
            hits += 1
    return {
        "tokenizer": tokenizer,
        "queries": len(targets),
        "recallAt5": round(hits / len(targets), 4),
        "avgQueryMs": round(sum(lat) / len(lat), 3),
    }


def trigger_test():
    """external-content FTS5：无触发器时插入不进索引；加触发器后新行可检索。"""
    con = sqlite3.connect(":memory:")
    con.executescript(
        """
        CREATE TABLE memory(id INTEGER PRIMARY KEY, text TEXT);
        CREATE VIRTUAL TABLE memory_fts USING fts5(
          text, content='memory', content_rowid='id', tokenize='trigram'
        );
        """
    )
    con.execute("INSERT INTO memory(text) VALUES ('梧桐树下的约定')")
    without = con.execute(
        "SELECT count(*) FROM memory_fts WHERE memory_fts MATCH '\"梧桐树\"'"
    ).fetchone()[0]
    con.executescript(
        """
        CREATE TRIGGER memory_ai AFTER INSERT ON memory BEGIN
          INSERT INTO memory_fts(rowid, text) VALUES (new.id, new.text);
        END;
        CREATE TRIGGER memory_ad AFTER DELETE ON memory BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, text) VALUES('delete', old.id, old.text);
        END;
        CREATE TRIGGER memory_au AFTER UPDATE ON memory BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, text) VALUES('delete', old.id, old.text);
          INSERT INTO memory_fts(rowid, text) VALUES (new.id, new.text);
        END;
        """
    )
    con.execute("INSERT INTO memory(text) VALUES ('雨伞和便利店')")
    with_trigger = con.execute(
        "SELECT count(*) FROM memory_fts WHERE memory_fts MATCH '\"便利店\"'"
    ).fetchone()[0]
    return {
        "withoutTriggerHits": without,
        "withTriggerHits": with_trigger,
        "pass": without == 0 and with_trigger == 1,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)

    con_u, docs_u, build_u = build_db("unicode61")
    con_t, docs_t, build_t = build_db("trigram")
    res = {
        "sqliteVersion": sqlite3.sqlite_version,
        "python": os.sys.version.split()[0],
        "corpusDocs": 1000,
        "method": "1000 条中文记忆，每条含唯一 3 字词；50 条查询查 top5 是否命中目标",
        "unicode61": recall_at_5(con_u, "unicode61"),
        "trigram": recall_at_5(con_t, "trigram"),
        "buildMs": {"unicode61": round(build_u, 2), "trigram": round(build_t, 2)},
        "externalContentTrigger": trigger_test(),
        "conclusion": "trigram 可命中中文片段；unicode61 对连续中文几乎无效；external-content 必须配同步触发器",
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=2)
    print(
        json.dumps(
            {k: res[k] for k in ("unicode61", "trigram", "externalContentTrigger")},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
