# 常在 · Step 1 spike：环境探测（工具链 / WebView2 / 镜像可用性）
param([string]$OutFile = "")
$ErrorActionPreference = 'SilentlyContinue'

function Try-Cmd($exe, $argList) {
    try { (& $exe @argList) 2>$null | Select-Object -First 1 } catch { $null }
}
function Test-Url($url) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri $url -TimeoutSec 5 -UseBasicParsing -Method Head
        return [ordered]@{ url = $url; ok = $true; status = $r.StatusCode; ms = [math]::Round($sw.Elapsed.TotalMilliseconds) }
    } catch {
        return [ordered]@{ url = $url; ok = $false; status = $null; ms = [math]::Round($sw.Elapsed.TotalMilliseconds) }
    }
}

$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$wv = $null
$roots = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\*',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\*',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\*'
)
foreach ($r in $roots) {
    $items = Get-ItemProperty $r 2>$null | Where-Object { $_.name -like '*WebView*' }
    if ($items) { $wv = $items | Select-Object -First 1; break }
}

$result = [ordered]@{
    generatedAt = (Get-Date).ToString('o')
    os = [ordered]@{
        caption = $os.Caption
        version = $os.Version
        build   = $os.BuildNumber
        arch    = $env:PROCESSOR_ARCHITECTURE
    }
    hardware = [ordered]@{
        cpu   = $cs.Name
        cores = $cs.NumberOfLogicalProcessors
        ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
    }
    tools = [ordered]@{
        node    = (Try-Cmd 'node' @('-v'))
        npm     = (Try-Cmd 'npm' @('-v'))
        git     = (Try-Cmd 'git' @('--version'))
        rustc   = (Try-Cmd "$env:USERPROFILE\.cargo\bin\rustc.exe" @('-V'))
        cargo   = (Try-Cmd "$env:USERPROFILE\.cargo\bin\cargo.exe" @('-V'))
        python  = (Try-Cmd 'python' @('--version'))
        cl      = (Try-Cmd 'cl.exe' @(''))
        link    = (Try-Cmd 'where.exe' @('link.exe'))
    }
    msvc = [ordered]@{
        vswhere  = Test-Path 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
        vcvars64 = (Test-Path 'D:\Visual Studio 2022\VC\Auxiliary\Build\vcvars64.bat') -or (Test-Path 'C:\Program Files\Microsoft Visual Studio\2022\*\VC\Auxiliary\Build\vcvars64.bat')
    }
    webview2 = [ordered]@{
        installed = [bool]$wv
        version   = if ($wv) { $wv.pv } else { $null }
        name      = if ($wv) { $wv.name } else { $null }
        source    = 'registry:EdgeUpdate\Clients'
    }
    network = @(
        (Test-Url 'https://registry.npmmirror.com/react'),
        (Test-Url 'https://rsproxy.cn/index/config.json'),
        (Test-Url 'https://static.rust-lang.org/'),
        (Test-Url 'https://github.com/')
    )
    disk = [ordered]@{
        drive  = 'D:'
        freeGB = [math]::Round((Get-PSDrive D).Free / 1GB, 1)
    }
}
$json = $result | ConvertTo-Json -Depth 8
if ($OutFile) { $json | Out-File -LiteralPath $OutFile -Encoding utf8 }
Write-Output $json
