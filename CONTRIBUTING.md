# 贡献指南（Contributing）

> 项目：**常在（Still Here）** · Windows PC 单端
> 目标：多人协作时 **不互相踩踏、不污染数据、不破坏构建**。本文件是协作的唯一约定来源。

## 1. 环境准备（新成员第一次）

| 依赖 | 版本 | 说明 |
|---|---|---|
| Windows | 10 1809+ / 11 x64 | 本期只做 Windows |
| Node.js | **24 LTS**（≥20） | 本项目用 Node 24 原生跑 TypeScript 单测 |
| pnpm | 11.x | 仓库用 pnpm workspace |
| Rust | stable（MSVC） | `rustup default stable-x86_64-pc-windows-msvc` |
| Visual Studio 2022 | C++ 桌面开发工作负载 | 提供 MSVC / nmake / Windows SDK |
| OpenSSL | 3.x（Win64 预编译） | SQLCipher 默认链接；`scripts/env.ps1` 自动探测 `D:\tools\openssl\x64` 或 `C:\Program Files\OpenSSL-Win64`，或手动设 `OPENSSL_DIR` |
| Strawberry Perl + NASM | 可选（仅 vendored 构建） | 默认不需要；见 `docs/step1-spike-report.md` §3 |
| WebView2 Runtime | 已安装 | Windows 11 预装；Win10 由安装包内置 Bootstrapper |

```powershell
git clone https://github.com/202164690251/changzai.git
cd changzai

# 一次性：引导 Node/Rust/MSVC/Perl/NASM 到当前终端（每个新终端都要执行）
powershell -ExecutionPolicy Bypass -File scripts\env.ps1

pnpm install
# 全量验收：类型检查 + core 单测 + Rust 探针 + spike
powershell -ExecutionPolicy Bypass -File scripts\verify.ps1
```

> 国内网络：仓库 `.npmrc` 已配 npmmirror；Cargo 镜像与 Tauri 打包镜像见 `docs/step1-spike-report.md` §3/§6。

## 2. 分支模型（GitHub Flow）

| 分支 | 用途 | 规则 |
|---|---|---|
| `main` | 唯一长期分支 | 团队约定：不直接 push，必须 PR + 1 人 review，禁止 force push / 删除（GitHub 免费私有仓库暂不支持强制分支保护；升级 Pro 或仓库公开后可启用） |
| `feat/<scope>-<short>` | 新功能 | 例：`feat/ui-wechat-shell`、`feat/ingest-adapters` |
| `fix/<scope>-<short>` | 缺陷修复 | 例：`fix/db-probe-wrong-key` |
| `docs/<short>` / `chore/<short>` | 文档 / 工程杂项 | 可单人快速合并（仍需 CI 通过） |

**分工原则**：一个任务一个分支；一个 PR 只做一件事（建议 < 400 行 diff）。跨模块改动先开 Issue 对齐接口，再动代码。

```powershell
git switch main
git pull --rebase
git switch -c feat/ui-wechat-shell

# ...开发...
git add -A
git commit -m "feat(ui): WeChat-like layout with both-side avatars"
git push -u origin feat/ui-wechat-shell
# 在 GitHub 上开 PR → 填模板 → 等 CI 通过 + 1 review → Squash merge
```

合并后清理：`git switch main && git pull --rebase && git branch -d feat/ui-wechat-shell`。

## 3. 提交信息（Conventional Commits）

格式：`type(scope): summary`，summary 用中文或英文均可，祈使句、不超过 72 字符。

- `feat` 新功能；`fix` 修复；`docs` 文档；`refactor` 重构；`test` 测试；`chore` 构建/依赖；`style` 纯样式
- scope 建议：`ui` `core` `ingest` `db` `runtime` `memory` `emotion` `active` `media` `tauri` `ci` `docs`
- 例：`feat(media): import images/voice and render bubbles`

## 4. PR 流程与验收

1. PR 模板必填：做了什么、怎么验证、截图（UI 改动必须）、关联 Issue。
2. **CI 必须全绿**：`web`（类型检查 + core 单测 + 前端构建）与 `rust`（SQLCipher/FTS5/加密探针 cargo test）。
3. 至少 1 名 reviewer 批准；UI/数据/安全相关改动建议由产品负责人再确认。
4. 合并方式：**Squash merge**；合并前确保本地已 rebase `main`。
5. 合并后由作者在 Issue 里写一句"已完成 + 验证方式"。

## 5. 代码与边界约定

- `packages/core` **禁止**出现 `window` / `fs` / `fetch` / `localStorage`；平台能力走 `ports.ts` 注入。
- 界面层不直接操作 DB；统一走 `CoreAPI`（Step 2 起接入）。
- 新增/修改数据结构：先改 `packages/shared/src/types.ts`，再改 core 与 Rust 契约，最后改 UI。
- 数据库变更：更新 `packages/core/src/db/ddl.ts` 并递增 `SCHEMA_VERSION`，同时写迁移说明。
- Prompt 一律放 `prompts/`，禁止内联硬编码；改 Prompt 必须跑黄金集回归（Step 3 起）。
- 安全阀（归因/上限/出口）、事实锁、AI 使用说明属于不可静默移除的能力；改它们需要产品负责人 review。

## 6. 数据与隐私红线（必须遵守）

- **绝不提交**真实聊天记录、图片/语音、头像、数据库文件、API Key、token、个人路径。
  `.gitignore` 已忽略 `data/ media/ exports/ logs/ release/ *.db *.log`。
- 测试用合成数据（`packages/core/test/` 里的示例即可）。
- 截图中如含真实聊天内容，先打码再上传；不要贴到公开 Issue。
- Issue/PR 中不粘贴 API Key；泄露立即在对应厂商后台吊销。

## 7. 发布

- 版本号遵循 SemVer；`main` 上打 tag `v0.x.y`。
- 构建：`powershell -ExecutionPolicy Bypass -File scripts\build.ps1`
- 产物：`release/Changzai_<version>_x64-setup.exe`（未签名前仅内测分发；签名证书到位后替换）。

## 8. 合并审核与 main 保护（重要）

### 8.1 当前限制（已实测）

仓库目前是 **private + GitHub Free**。这种组合下 GitHub 不提供强制分支保护：调用分支保护或 Rulesets API 都会返回
`403 Upgrade to GitHub Pro or make this repository public to enable this feature`。
所以现在没有任何“平台强制必须审核才能进 main”的开关。

### 8.2 三种实现方式

#### 方案 A（推荐、零成本）：协作者只给 Read 权限 + Fork/PR

这是免费私有仓库下最接近“我审核后他们才能进 main”的做法：

1. 仓库 Settings → Collaborators → Add people，把对方权限设为 **Read**（不要 Write）；
2. 对方在 GitHub 网页点 **Fork**（私有仓库的 fork 也是 private，本仓库已开启 allow_forking）；
3. 对方 clone **自己的 fork**，在自己的分支上开发并 push 到 fork；
4. 对方从 fork 向本仓库 `main` 发 **Pull Request**；
5. CI 跑完、你 review 并点 **Squash merge** 后，代码才进入 main。

效果：**对方没有 main 的写权限，不能直接 push，也不能合并 PR；只有你审核并合并后提交才进入 main。**
代价：对方不能在主仓库建共享分支（都在自己 fork 里）；适合外部/外包/实习贡献者。
注意：来自 fork 的首次 PR，CI 需要你点一次 “Approve and run workflows”。

#### 方案 B（最标准、需要 Public 或 GitHub Pro）：开启强制分支保护 / Rulesets

前置二选一：
- 仓库 Settings → General → Danger Zone → **Change visibility → Public**（免费即可用）；或
- 升级 **GitHub Pro**（私有仓库也可用）。

然后（二选一）：

**Classic 分支保护**：Settings → Branches → Add branch protection rule
- Branch name pattern：`main`
- ☑ Require a pull request before merging
  - Required approvals：`1`
  - ☑ Dismiss stale pull request approvals when new commits are pushed
  - ☑ Require review from Code Owners（仓库已有 `.github/CODEOWNERS`）
- ☑ Require status checks to pass before merging
  - 勾选 CI 的 `web` 与 `rust`
  - ☑ Require branches to be up to date before merging
- ☑ Require conversation resolution before merging
- ☑ Do not allow bypassing the above settings
- 关闭 Allow force pushes / Allow deletions

**Rulesets（新版界面）**：Settings → Rules → Rulesets → New branch ruleset
- Target branches：`main`
- Rules：Require a pull request（1 approval）+ Require status checks（`web`、`rust`）+ Block force pushes + Restrict deletions
- Enforcement status：**Active**

开启后：任何协作者（包括 Write 权限）直接 push main 都会被拒绝；PR 必须 **1 人 review + CI 全绿** 才能合并；即使管理员默认也不能绕过（如勾选 Do not allow bypassing）。

#### 方案 C（不推荐）：Write 权限 + 团队口头约定

给协作者 Write 权限、约定“必须走 PR”。在没有平台保护的情况下，这**不能阻止**对方直接 push main，只能事后 review/回滚。只适合完全信任的小团队临时使用。

### 8.3 建议

- **外部/外包/短期贡献者**：用方案 A（Read + Fork/PR），零成本，效果就是“你审核后才进 main”；
- **长期核心成员、需要共享分支**：把仓库设为 Public（若内容可公开）或升级 Pro，然后用方案 B 的强制保护；
- 需要我帮你切换哪种，直接说：我可以把仓库改成 Public 并立刻开保护，或按方案 A 更新邀请/文档。

## 9. 出问题找谁

- 构建/环境：先跑 `scripts\env.ps1` 与 `scripts\verify.ps1`，把完整日志贴到 Issue。
- 产品行为/文案/安全边界：找产品负责人（仓库 owner）确认，不要自行放宽。
