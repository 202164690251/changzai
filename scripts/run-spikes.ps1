# 常在 · 一键运行 Step 1 五项 spike
# 用法：powershell -ExecutionPolicy Bypass -File scripts\run-spikes.ps1
# 结果写入 spikes/results/*.json 与 spikes/results/summary.json

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
. (Join-Path $PSScriptRoot 'env.ps1') 6>$null

$results = Join-Path $repoRoot 'spikes\results'
New-Item -ItemType Directory -Force -Path $results | Out-Null
$py = $env:CHANGZAI_PYTHON
if (-not $py) {
    $pyCandidates = @(
        'C:\Users\10242\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe',
        'python'
    )
    foreach ($c in $pyCandidates) {
        try {
            $v = & $c --version 2>&1
            if ($v -match 'Python 3') { $py = $c; break }
        } catch { }
    }
}

$summary = [ordered]@{
    startedAt = (Get-Date).ToString('o')
    machine   = [ordered]@{ os = [Environment]::OSVersion.VersionString; arch = $env:PROCESSOR_ARCHITECTURE }
    spikes    = [ordered]@{}
}

function Add-SpikeResult($name, $file, $ok, $note) {
    $summary.spikes[$name] = [ordered]@{ ok = $ok; resultFile = $file; note = $note }
    $status = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Host ("[{0}] {1}  {2}" -f $status, $name, $note)
}

# 0) 环境探测
$envJson = Join-Path $results 'env.json'
& (Join-Path $PSScriptRoot '..\spikes\env.ps1') -OutFile $envJson | Out-Null
$envOk = Test-Path $envJson
Add-SpikeResult 'env' 'spikes/results/env.json' $envOk '工具链/WebView2 探测'

# 1) FTS5 中文检索（Python sqlite3）
try {
    & $py (Join-Path $repoRoot 'spikes\fts5_zh.py') --out (Join-Path $results 'fts5-zh.json') | Out-Null
    $fts = Get-Content (Join-Path $results 'fts5-zh.json') -Raw -Encoding utf8 | ConvertFrom-Json
    $ok = ($fts.trigram.recallAt5 -ge 0.9) -and ($fts.trigram.recallAt5 -gt $fts.unicode61.recallAt5)
    Add-SpikeResult 'fts5-zh' 'spikes/results/fts5-zh.json' $ok ("trigram recall@5={0:P0} vs unicode61={1:P0}" -f $fts.trigram.recallAt5, $fts.unicode61.recallAt5)
} catch {
    Add-SpikeResult 'fts5-zh' 'spikes/results/fts5-zh.json' $false $_.Exception.Message
}

# 2) HTTP 流式（Node 本地 SSE，模拟 OpenAI 兼容流）
try {
    $streamJson = Join-Path $results 'http-stream.json'
    & node (Join-Path $repoRoot 'spikes\http_stream.mjs') --out $streamJson | Out-Null
    $st = Get-Content $streamJson -Raw -Encoding utf8 | ConvertFrom-Json
    $ok = ($st.firstChunkMs -lt 500) -and ($st.chunks -ge 10) -and ($st.abortOk -eq $true)
    Add-SpikeResult 'http-stream' 'spikes/results/http-stream.json' $ok ("firstChunk={0}ms chunks={1} abort={2}" -f $st.firstChunkMs, $st.chunks, $st.abortOk)
} catch {
    Add-SpikeResult 'http-stream' 'spikes/results/http-stream.json' $false $_.Exception.Message
}

# 3) Windows 通知（WinRT Toast）
try {
    $toastJson = Join-Path $results 'toast.json'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'spikes\toast.ps1') -OutFile $toastJson | Out-Null
    $t = Get-Content $toastJson -Raw -Encoding utf8 | ConvertFrom-Json
    Add-SpikeResult 'toast' 'spikes/results/toast.json' ([bool]$t.ok) $t.message
} catch {
    Add-SpikeResult 'toast' 'spikes/results/toast.json' $false $_.Exception.Message
}

# 4) WebView2
try {
    $wvJson = Join-Path $results 'webview2.json'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'spikes\webview2.ps1') -OutFile $wvJson | Out-Null
    $wv = Get-Content $wvJson -Raw -Encoding utf8 | ConvertFrom-Json
    Add-SpikeResult 'webview2' 'spikes/results/webview2.json' ([bool]$wv.installed) ("version={0}" -f $wv.version)
} catch {
    Add-SpikeResult 'webview2' 'spikes/results/webview2.json' $false $_.Exception.Message
}

# 5) 核心逻辑单测（Node 24 原生跑 TS）
try {
    $testOut = & node --test (Join-Path $repoRoot 'packages\core\test') 2>&1
    $testOk = ($LASTEXITCODE -eq 0)
    Add-SpikeResult 'core-tests' '' $testOk ("node --test: {0}" -f ($(if ($testOk) { 'all pass' } else { 'FAILED' })))
} catch {
    Add-SpikeResult 'core-tests' '' $false $_.Exception.Message
}

$summary.finishedAt = (Get-Date).ToString('o')
$summary | ConvertTo-Json -Depth 6 | Out-File -LiteralPath (Join-Path $results 'summary.json') -Encoding utf8
Write-Host ''
Write-Host ("结果目录: {0}" -f $results)
Write-Host ("报告: docs\step1-spike-report.md（由本次结果整理）")
