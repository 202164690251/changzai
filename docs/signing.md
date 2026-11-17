# Windows 代码签名与安装包（发布前）

## 现状

- 安装包：NSIS `.exe`，未签名；SmartScreen 会提示“更多信息 → 仍要运行”。
- MSI：Tauri 构建时会自动下载 WiX 3.14（本机通过 `ghproxy.net` 镜像）；如果网络失败则只出 NSIS。
- 没有 OV/EV 证书，因此**无法消除 SmartScreen 提示**。

## 购买与签名（外部动作）

1. 购买 Windows OV 代码签名证书（DigiCert/Sectigo/SSL.com 等，约 ¥1,000–2,000/年）；
2. 在 CI 或本机导入证书；
3. 用 `signtool sign /fd SHA256 /tr <timestamp> /td SHA256 /f cert.pfx /p <password> <exe>` 签名 `changzai.exe` 与安装包；
4. 用 `signtool verify /pa /v` 验证；
5. 向 Microsoft 提交 SmartScreen 误报/新发布者审核（可选，需要时间积累信誉）。

## Tauri 签名环境变量

Tauri 支持：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "C:\path\to\key.pem"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
```

本仓库目前没有启用 updater 签名；如果后续接自动更新，必须保管好私钥，不能提交到仓库。

## 发布检查

- [ ] 安装包和 exe 均签名
- [ ] `signtool verify /pa` 通过
- [ ] 干净 Win10/11 安装无 SmartScreen 警告
- [ ] Release 资产提供 SHA256
