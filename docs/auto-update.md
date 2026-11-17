# 自动更新（未启用，设计草案）

## 为什么没启用

Tauri v2 的 updater 需要：

1. 一个稳定的 HTTPS endpoint（`latest.json`）；
2. 一对更新签名密钥（私钥只放 CI secret）；
3. 每个版本的安装包/签名；
4. 域名/对象存储。

当前没有 Release 托管域名与签名密钥，强行启用会让构建失败或产生不可验证的更新包，所以本期只保留设计。

## 推荐方案

- 用 GitHub Releases 作为更新源（公共仓库免费）；
- 用 `tauri-plugin-updater` + `createUpdaterArtifacts`；
- CI 在 tag 构建时读取 `TAURI_SIGNING_PRIVATE_KEY`，生成 `.sig` 与 `latest.json`；
- 应用启动检查更新，下载后提示重启；
- 失败回退：保留上一版安装包，不做强制更新。

## 启用步骤

1. `cargo add tauri-plugin-updater` + `tauri-plugin-process`；
2. 在 `lib.rs` 注册插件；
3. `tauri.conf.json` 增加 `plugins.updater`（pubkey、endpoints）；
4. 生成密钥：`pnpm tauri signer generate`；
5. 把公钥写进配置，私钥放 GitHub Actions secret；
6. 构建时设置 `TAURI_SIGNING_PRIVATE_KEY`，Tauri 自动生成更新包；
7. 在 GitHub Release 上传 `latest.json` 与 `.sig`。

## 风险

- 更新包必须签名；私钥泄漏 = 可远程执行任意代码；
- 自动更新会改变用户本机程序，需要在隐私政策/协议中说明；
- 没有代码签名证书时，更新安装仍可能被 SmartScreen 拦截。
