# 常在 · Step 1 运行时自检（自动点击「全部运行」并截图）
# 仅用于本机验收：把窗口置顶、点击按钮、截屏、取消置顶。
param(
    [string]$OutDir = 'D:\ai聊天\changzai\docs\assets',
    [int]$WaitSeconds = 10
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ChangzaiWin {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
}
"@
Add-Type -AssemblyName System.Drawing

$proc = Get-Process changzai -ErrorAction Stop | Select-Object -First 1
$hwnd = $proc.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw '找不到常 window handle' }

$hwndTopmost = [IntPtr]::new(-1)
$hwndNotTopmost = [IntPtr]::new(-2)
# SW_RESTORE = 9, SW_SHOW = 5
[ChangzaiWin]::ShowWindow($hwnd, 9) | Out-Null
[ChangzaiWin]::SetWindowPos($hwnd, $hwndTopmost, 100, 100, 1296, 839, 0x0040) | Out-Null
[ChangzaiWin]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 900

# 点「全部运行」：窗口外框 (100,100)，按钮相对外框约 (429,132)
$clickX = 100 + 429
$clickY = 100 + 132
[ChangzaiWin]::SetCursorPos($clickX, $clickY) | Out-Null
Start-Sleep -Milliseconds 150
[ChangzaiWin]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[ChangzaiWin]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Seconds $WaitSeconds

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$bmp = New-Object System.Drawing.Bitmap 1296, 839
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(100, 100, 0, 0, $bmp.Size)
$path = Join-Path $OutDir 'step1-spikes-run.png'
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

[ChangzaiWin]::SetWindowPos($hwnd, $hwndNotTopmost, 350, 105, 1296, 839, 0x0040) | Out-Null
Write-Output "saved: $path"
