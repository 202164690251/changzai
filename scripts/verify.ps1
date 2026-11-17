# 常在 · 一键验收（Step 1 可自动化部分）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\verify.ps1

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'env.ps1') 6>$null
$ErrorActionPreference = 'Continue'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$node = (Get-Command node).Source
$pnpm = $env:CHANGZAI_PNPM_MJS
$fail = 0

function Section($name) { Write-Host ''; Write-Host "===== $name =====" }

Section '1/4 TypeScript 类型检查'
& $node $pnpm --filter @changzai/app exec tsc --noEmit
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '[FAIL] app typecheck' } else { Write-Host '[PASS] app typecheck' }
& $node $pnpm exec tsc -p packages/core/tsconfig.json --noEmit
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '[FAIL] core typecheck' } else { Write-Host '[PASS] core typecheck' }

Section '2/4 core 单测（Node 24 原生 TS）'
& $node --test (Join-Path $repo 'packages\core\test\*.test.ts')
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '[FAIL] core tests' } else { Write-Host '[PASS] core tests' }

Section '3/4 Rust 数据层 / 流式 HTTP 探针'
Push-Location (Join-Path $repo 'apps\app\src-tauri')
& cargo test --lib
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '[FAIL] cargo test' } else { Write-Host '[PASS] cargo test' }
Pop-Location

Section '4/4 Step 1 Spike 套件'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\run-spikes.ps1')
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '[FAIL] spikes' } else { Write-Host '[PASS] spikes' }

Write-Host ''
if ($fail -eq 0) { Write-Host '全部验收项通过 ✅' } else { Write-Host "有 $fail 项失败 ❌" }
exit $fail
