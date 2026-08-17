# dsh-hindsight-local: 隐藏 uv.exe 守护进程的终端窗口（Windows 11 用 WindowsTerminal 当默认终端）
# 由宿主半边 hideDaemonWindows() 在启动 daemon 后 spawn 执行（不阻塞）。
# 延迟 10 秒等窗口出现，之后每 5 秒隐藏一次，持续 2 分钟（覆盖冷启动窗口期）。
Start-Sleep -Seconds 10

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WEnum {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  public static List<IntPtr> Find(string sub) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      if (sb.ToString().Contains(sub)) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@

for ($i = 0; $i -lt 24; $i++) {
  [WEnum]::Find('uv.exe') | ForEach-Object { [WEnum]::ShowWindow($_, 0) | Out-Null }
  Start-Sleep -Seconds 5
}
