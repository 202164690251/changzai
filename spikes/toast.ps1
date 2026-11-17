# 常在 · Step 1 spike：Windows 原生 Toast 通知
# 说明：这里用未注册 AppId 做能力验证；Tauri 应用安装后使用自身 AUMID，Toast 才会稳定归属。
param([string]$OutFile = "")
$ErrorActionPreference = 'Stop'

$result = [ordered]@{
    ok = $false
    api = 'Windows.UI.Notifications.ToastNotificationManager'
    appId = '常在 Still Here (Spike)'
    message = ''
    error = ''
}

try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    $xmlText = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>常在 · 技术自检</text>
      <text>如果你看到这条通知，说明 Windows 通知链路可用。</text>
      <text>这条不是她发的。</text>
    </binding>
  </visual>
</toast>
"@
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($xmlText)
    $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($result.appId).Show($toast)
    $result.ok = $true
    $result.message = 'Toast 已提交给系统（若未弹出，检查专注助手/通知权限）'
} catch {
    $result.ok = $false
    $result.message = 'Toast 提交失败'
    $result.error = $_.Exception.Message
}

$json = $result | ConvertTo-Json -Depth 4
if ($OutFile) { $json | Out-File -LiteralPath $OutFile -Encoding utf8 }
Write-Output $json
