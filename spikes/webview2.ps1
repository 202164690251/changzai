# 常在 · Step 1 spike：WebView2 Runtime 探测
param([string]$OutFile = "")
$ErrorActionPreference = 'SilentlyContinue'

$found = $null
$source = $null
$roots = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\*',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\*',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\*'
)
foreach ($r in $roots) {
    $items = Get-ItemProperty $r 2>$null | Where-Object { $_.name -like '*WebView*' }
    if ($items) { $found = $items | Select-Object -First 1; $source = $r; break }
}

$appDirs = @(
    'C:\Program Files (x86)\Microsoft\EdgeWebView\Application',
    'C:\Program Files\Microsoft\EdgeWebView\Application',
    "$env:LOCALAPPDATA\Microsoft\EdgeWebView\Application"
) | Where-Object { Test-Path $_ }
$appVersion = $null
if ($appDirs.Count -gt 0) {
    $appVersion = Get-ChildItem $appDirs[0] -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty Name
}

$result = [ordered]@{
    installed = [bool]($found -or $appVersion)
    version   = if ($found) { $found.pv } elseif ($appVersion) { $appVersion } else { $null }
    name      = if ($found) { $found.name } else { $null }
    source    = if ($found) { $source } else { 'filesystem' }
    appDirs   = $appDirs
    note      = 'Windows 11 一般预装；老 Win10 需安装包内置 Evergreen Bootstrapper'
}
$json = $result | ConvertTo-Json -Depth 5
if ($OutFile) { $json | Out-File -LiteralPath $OutFile -Encoding utf8 }
Write-Output $json
