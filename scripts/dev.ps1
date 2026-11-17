# 常在 · 桌面开发模式（Tauri dev）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\dev.ps1

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'env.ps1') 6>$null
$ErrorActionPreference = 'Continue'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $repo 'apps\app')
$node = (Get-Command node).Source
$cli = Join-Path $repo 'apps\app\node_modules\@tauri-apps\cli\tauri.js'
if (-not (Test-Path $cli)) { throw '未找到 Tauri CLI，请先在仓库根目录运行 pnpm install。' }

& $node $cli dev @args
exit $LASTEXITCODE
