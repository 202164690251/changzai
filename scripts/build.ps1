# 常在 · 构建 Windows 安装包
# 用法：powershell -ExecutionPolicy Bypass -File scripts\build.ps1
# 说明：直接调用 Tauri CLI，避免 pnpm run 在部分环境下丢失 cargo 的 PATH。

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'env.ps1') 6>$null
$ErrorActionPreference = 'Continue'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $repo 'apps\app')
$node = (Get-Command node).Source
$cli = Join-Path $repo 'apps\app\node_modules\@tauri-apps\cli\tauri.js'
if (-not (Test-Path $cli)) { throw '未找到 Tauri CLI，请先在仓库根目录运行 pnpm install。' }

# 本机直连 GitHub release 资产会超时；Tauri 打包工具（NSIS）走镜像下载
if (-not $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR) {
    $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR = 'https://ghproxy.net/https://github.com'
    Write-Host "[build] TAURI_BUNDLER_TOOLS_GITHUB_MIRROR=$env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR"
}

Write-Host "[build] node=$node"
& $node $cli build @args
$code = $LASTEXITCODE
Write-Host "[build] exit=$code"
exit $code
