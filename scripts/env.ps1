# 常在 · 开发环境装载脚本
# 用法（必须 dot-source）：  . .\scripts\env.ps1
# 作用：把 Node/pnpm/Rust/MSVC(VC++ 工具链) 加入当前 PowerShell 会话的 PATH，
#       并设置国内镜像（Rust / npm 已在 .npmrc 内配置）。
# 不修改系统全局配置；新开终端需要重新 dot-source。

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# ---------- 1) Node 20+ ----------
$nodeOk = $false
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $verText = (& node -v) 2>$null
    if ($verText -match '^v(\d+)\.') { if ([int]$Matches[1] -ge 20) { $nodeOk = $true } }
}
if (-not $nodeOk) {
    $candidates = @()
    if ($env:CHANGZAI_NODE_BIN) { $candidates += (Join-Path $env:CHANGZAI_NODE_BIN 'node.exe') }
    $candidates += 'C:\Users\10242\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    $candidates = @($candidates | Where-Object { $_ -and (Test-Path $_) })
    if ($candidates.Count -gt 0) {
        $env:PATH = (Split-Path $candidates[0]) + ';' + $env:PATH
        $nodeOk = $true
    }
}
if (-not $nodeOk) { Write-Warning '未找到 Node 20+，请安装 Node 24 LTS 后重试。' }

# ---------- 2) pnpm（优先 bundled pnpm.mjs） ----------
$pnpmMjs = $env:CHANGZAI_PNPM_MJS
if (-not $pnpmMjs -or -not (Test-Path $pnpmMjs)) {
    $guess = @()
    $candidate = 'C:\Users\10242\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
    if (Test-Path $candidate) { $guess += $candidate }
    if ($guess.Count -gt 0) { $pnpmMjs = $guess[0] }
}
if ($pnpmMjs) {
    # 给子进程（tauri 的 beforeBuildCommand 等）用的 pnpm shim（本机路径，不入库）
    $shimDir = Join-Path $PSScriptRoot 'bin'
    New-Item -ItemType Directory -Force -Path $shimDir | Out-Null
    $nodeExe = (Get-Command node).Source
    $shimContent = "@echo off`r`n`"$nodeExe`" `"$pnpmMjs`" %*`r`n"
    [IO.File]::WriteAllText(
        (Join-Path $shimDir 'pnpm.cmd'),
        $shimContent,
        (New-Object System.Text.UTF8Encoding($false))
    )
    if (($env:PATH -split ';') -notcontains $shimDir) { $env:PATH = "$shimDir;$env:PATH" }
    function global:pnpm { & node $pnpmMjs @args }
    $env:CHANGZAI_PNPM_MJS = $pnpmMjs
}

# ---------- 3) Rust ----------
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path (Join-Path $cargoBin 'cargo.exe')) {
    if (($env:PATH -split ';') -notcontains $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }
}
$env:RUSTUP_DIST_SERVER = 'https://rsproxy.cn'
$env:RUSTUP_UPDATE_ROOT = 'https://rsproxy.cn/rustup'

# ---------- 4) MSVC（VC++ 工具链 + Windows SDK） ----------
$vcvars = $null
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path $vswhere) {
    $vsPath = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath) 2>$null
    if ($vsPath) {
        $candidate = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'
        if (Test-Path $candidate) { $vcvars = $candidate }
    }
}
if (-not $vcvars -and (Test-Path 'D:\Visual Studio 2022\VC\Auxiliary\Build\vcvars64.bat')) {
    $vcvars = 'D:\Visual Studio 2022\VC\Auxiliary\Build\vcvars64.bat'
}
if ($vcvars) {
    $lines = cmd /c "`"$vcvars`" >nul 2>&1 && set"
    foreach ($line in $lines) {
        if ($line -match '^(.*?)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
    $env:CHANGZAI_VCVARS = $vcvars
} else {
    Write-Warning '未找到 VC++ 工具链（vcvars64.bat），Rust/MSVC 构建会失败。'
}

Set-Location $repoRoot
if ($env:CHANGZAI_ENV_QUIET -ne '1') {
    $nodeVer = (& node -v) 2>$null
    $rustVer = (& rustc -V) 2>$null
    $clOk = [bool](Get-Command cl.exe -ErrorAction SilentlyContinue)
    Write-Host "[env] repo=$repoRoot"
    Write-Host "[env] node=$nodeVer rust=$rustVer msvc=$clOk"
}
