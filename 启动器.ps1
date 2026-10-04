#Requires -Version 5.1
# =============================================================================
# KERNEL 桌面启动器（PowerShell 5.1 + WPF 原生窗口）
# -----------------------------------------------------------------------------
# 替代旧版「网页套壳」HTA：加载系统原生 WPF 视觉树，无 OS 标题栏、圆角卡片、
# 柔影、自绘标题栏、状态脉冲与进度轨，125% DPI 下保持锐利。
# 行为与旧 HTA 启动器对齐（探测 / 启动 / 停止 / 状态机 / 快捷方式 / 自检）。
# 标识符英文，注释中文。本文件必须以 UTF-8 带 BOM 保存（PS 5.1 否则乱码）。
# =============================================================================
$ErrorActionPreference = 'Stop'

# ---- 基础：路径 / 环境 ----
$ROOT = $PSScriptRoot
if ([string]::IsNullOrEmpty($ROOT)) { $ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path }

$NODE_BUNDLED   = Join-Path $ROOT 'runtime\node.exe'
$OPENCODE_BUNDLED = Join-Path $ROOT 'runtime\opencode\opencode.exe'
$script:hasBundledOpencode = Test-Path -LiteralPath $OPENCODE_BUNDLED
$script:nodeExe = if (Test-Path -LiteralPath $NODE_BUNDLED) { $NODE_BUNDLED } else { 'node' }
$script:devMjs  = Join-Path $ROOT 'scripts\dev.mjs'
$script:cmdFile = Join-Path $ROOT '启动.cmd'
$script:vbsFile = Join-Path $ROOT '启动器.vbs'
$script:icoFile = Join-Path $ROOT 'kernel.ico'

$TEMP = $env:TEMP
if ([string]::IsNullOrEmpty($TEMP)) { $TEMP = $env:TMP }
$script:pidFile      = if ($TEMP) { Join-Path $TEMP 'kernel-launcher.pid' } else { '' }
$script:selftestFile = if ($TEMP) { Join-Path $TEMP 'kernel-launcher-selftest.txt' } else { '' }

# ---- 程序集 / DPI ----
$script:wpfOk = $false
try {
  Add-Type -AssemblyName PresentationFramework
  Add-Type -AssemblyName PresentationCore
  Add-Type -AssemblyName WindowsBase
  Add-Type -AssemblyName System.Net.Http
  $script:wpfOk = $true
} catch { $script:wpfOk = $false }

if ($script:wpfOk) {
  try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class KrDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
'@
    [void][KrDpi]::SetProcessDPIAware()
  } catch { }
}

# ---- 模式开关 ----
$smokeMs = 0
if ($env:KERNEL_LAUNCHER_SMOKE_MS) { [void][int]::TryParse($env:KERNEL_LAUNCHER_SMOKE_MS, [ref]$smokeMs) }
$isSmoke = $smokeMs -gt 0
$isShortcutTest = [bool]$env:KERNEL_LAUNCHER_SHORTCUTTEST
$isSelftest = [bool]$env:KERNEL_LAUNCHER_SELFTEST

# ---- 自检（无窗口）：写 %TEMP%\kernel-launcher-selftest.txt 后退出 ----
if ($isSelftest) {
  try {
    if ($script:selftestFile) {
      $lines = @(
        "ROOT=$ROOT",
        "NODE=$($script:nodeExe)",
        "BUNDLED_OPENCODE=$($script:hasBundledOpencode.ToString().ToLower())",
        "WPF=$(if ($script:wpfOk) { 'ok' } else { 'fail' })"
      )
      [System.IO.File]::WriteAllLines($script:selftestFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
    }
  } catch { }
  exit 0
}

# ---- 全局状态 ----
$script:PROBE_URL      = if ($env:KERNEL_LAUNCHER_PROBE_URL) { $env:KERNEL_LAUNCHER_PROBE_URL } else { 'http://127.0.0.1:5173/' }
$script:BROWSER_URL    = 'http://localhost:5173'
$script:POLL_MS        = 800
$script:START_TIMEOUT_MS = 90000
$script:STOP_TIMEOUT_MS  = 8000

$script:online = $false
$script:phase = 'idle'
$script:weStarted = $false
$script:servicePid = 0
$script:pendingAutoOpen = $false
$script:startAt = 0
$script:stopAt = 0
$script:animEnabled = $true
try { $script:animEnabled = [System.Windows.SystemParameters]::ClientAreaAnimation } catch { $script:animEnabled = $true }

# ---- PID 文件助手 ----
function Read-PidFile {
  if ([string]::IsNullOrEmpty($script:pidFile)) { return 0 }
  try {
    if (-not (Test-Path -LiteralPath $script:pidFile)) { return 0 }
    $s = [System.IO.File]::ReadAllText($script:pidFile).Trim()
    if ([string]::IsNullOrEmpty($s)) { return 0 }
    $n = 0
    if ([int]::TryParse($s, [ref]$n) -and $n -gt 0) { return $n }
    return 0
  } catch { return 0 }
}
function Write-PidFile([int]$procId) {
  if ([string]::IsNullOrEmpty($script:pidFile)) { return }
  try { [System.IO.File]::WriteAllText($script:pidFile, "$procId", (New-Object System.Text.UTF8Encoding($false))) } catch { }
}
function Remove-PidFile {
  if ([string]::IsNullOrEmpty($script:pidFile)) { return }
  try { if (Test-Path -LiteralPath $script:pidFile) { Remove-Item -LiteralPath $script:pidFile -Force } } catch { }
}

# ---- 快捷方式（同一代码路径供窗口与测试复用）----
function New-DesktopShortcut {
  try {
    $desk = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrEmpty($desk)) { $desk = Join-Path $env:USERPROFILE 'Desktop' }
    if (-not (Test-Path -LiteralPath $desk)) { return $false }
    $wsh = New-Object -ComObject WScript.Shell
    $lnkPath = Join-Path $desk 'KERNEL 启动器.lnk'
    $lnk = $wsh.CreateShortcut($lnkPath)
    $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $lnk.Arguments = '"' + $script:vbsFile + '"'
    $lnk.WorkingDirectory = $ROOT
    $lnk.IconLocation = $script:icoFile
    $lnk.Description = 'KERNEL 启动器'
    $lnk.Save()
    return $true
  } catch { return $false }
}

if ($isShortcutTest) {
  $scOk = New-DesktopShortcut
  Write-Output ("SHORTCUT_CREATED=" + $scOk)
  exit 0
}

# ---- 单实例（自检 / 冒烟 / 快捷方式测试跳过）----
$script:mutex = $null
if (-not $isSmoke -and -not $isShortcutTest) {
  try {
    $created = $false
    $script:mutex = [System.Threading.Mutex]::new($true, 'Local\KERNEL-Launcher', [ref]$created)
    if (-not $created) { exit 0 }
  } catch { $script:mutex = $null }
}

# =============================================================================
# 主流程（需 WPF）
# =============================================================================
if (-not $script:wpfOk) {
  try { [System.Windows.Forms.MessageBox]::Show('WPF 组件不可用，无法启动 KERNEL 启动器。', 'KERNEL 启动器') } catch { }
  exit 1
}

try {
  # ---- 视觉树（设计 token 硬编码自 docs/03-DESIGN-SYSTEM.md §2）----
  $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="KERNEL"
        WindowStyle="None"
        AllowsTransparency="True"
        ResizeMode="NoResize"
        ShowInTaskbar="True"
        Background="Transparent"
        SizeToContent="WidthAndHeight"
        WindowStartupLocation="CenterScreen"
        FontFamily="Segoe UI, Microsoft YaHei UI, Microsoft YaHei"
        TextOptions.TextFormattingMode="Display"
        UseLayoutRounding="True"
        SnapsToDevicePixels="True"
        Opacity="0">
  <Window.Resources>
    <Style x:Key="TitleButton" TargetType="Button">
      <Setter Property="Foreground" Value="#929298"/>
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Width" Value="28"/>
      <Setter Property="Height" Value="28"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bg" CornerRadius="8" Background="{TemplateBinding Background}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" RecognizesAccessKey="False"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bg" Property="Background" Value="#14FFFFFF"/>
                <Setter Property="Foreground" Value="#F4F4F5"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="SecondaryButton" TargetType="Button">
      <Setter Property="Foreground" Value="#A1A1AA"/>
      <Setter Property="Background" Value="#14FFFFFF"/>
      <Setter Property="BorderBrush" Value="#1FFFFFFF"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Height" Value="40"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="SnapsToDevicePixels" Value="True"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bg" CornerRadius="20" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" RecognizesAccessKey="False"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bg" Property="Background" Value="#232327"/>
                <Setter Property="Foreground" Value="#F4F4F5"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter Property="Opacity" Value="0.55"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="PrimaryButton" TargetType="Button">
      <Setter Property="Foreground" Value="#0F0F10"/>
      <Setter Property="Background" Value="#FF5A52"/>
      <Setter Property="BorderBrush" Value="#FF5A52"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Height" Value="40"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="SnapsToDevicePixels" Value="True"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bg" CornerRadius="20" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" RecognizesAccessKey="False"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bg" Property="Background" Value="#FF6D66"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter Property="Opacity" Value="0.5"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>
  <Grid Margin="20">
    <Border x:Name="card" Width="436" CornerRadius="16" Background="#1A1A1C" BorderBrush="#0FFFFFFF" BorderThickness="1">
      <Border.Effect>
        <DropShadowEffect Color="Black" BlurRadius="26" ShadowDepth="0" Direction="270" Opacity="0.55"/>
      </Border.Effect>
      <Grid>
        <Border CornerRadius="16" IsHitTestVisible="False">
          <Border.Background>
            <RadialGradientBrush Center="0.5,0.02" GradientOrigin="0.5,0.02" RadiusX="0.85" RadiusY="0.5">
              <GradientStop Color="#0DFF5A52" Offset="0"/>
              <GradientStop Color="#00FF5A52" Offset="1"/>
            </RadialGradientBrush>
          </Border.Background>
        </Border>
        <StackPanel Margin="24,22,24,22">
          <Grid>
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Left">
              <Border Width="34" Height="34" CornerRadius="10" Background="#212124" BorderBrush="#1FFFFFFF" BorderThickness="1">
                <Viewbox Width="18" Height="18" Stretch="Uniform" HorizontalAlignment="Center" VerticalAlignment="Center">
                  <Canvas Width="64" Height="64">
                    <Path Stroke="#F4F4F5" StrokeThickness="5" StrokeStartLineCap="Square" StrokeEndLineCap="Square" StrokeLineJoin="Miter" Data="M20,14 V50 M20,33 L44,14 M20,33 L44,50"/>
                  </Canvas>
                </Viewbox>
              </Border>
              <StackPanel Margin="12,0,0,0" VerticalAlignment="Center">
                <StackPanel Orientation="Horizontal">
                  <TextBlock Text="KERNEL" FontSize="17" FontWeight="SemiBold" Foreground="#F4F4F5"/>
                  <TextBlock Text="v0.5.0" FontSize="11" Foreground="#929298" Margin="8,0,0,2" VerticalAlignment="Bottom"/>
                </StackPanel>
              </StackPanel>
            </StackPanel>
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" VerticalAlignment="Top">
              <Button x:Name="minBtn" Style="{StaticResource TitleButton}" Content="−"/>
              <Button x:Name="closeBtn" Style="{StaticResource TitleButton}" Content="✕" Margin="2,0,0,0"/>
            </StackPanel>
          </Grid>
          <TextBlock x:Name="tagline" Text="个人事务内核 · 本地优先" FontSize="13" Foreground="#A1A1AA" Margin="0,12,0,0"/>
          <Grid x:Name="statusHead" Margin="0,22,0,0">
            <Grid.ColumnDefinitions>
              <ColumnDefinition Width="Auto"/>
              <ColumnDefinition Width="Auto"/>
              <ColumnDefinition Width="*"/>
            </Grid.ColumnDefinitions>
            <Canvas Grid.Column="0" Width="11" Height="11" VerticalAlignment="Center" Margin="1,0,0,0">
              <Ellipse x:Name="ring" Width="11" Height="11" Canvas.Left="0" Canvas.Top="0" Fill="#FF5A52" Opacity="0.5" RenderTransformOrigin="0.5,0.5">
                <Ellipse.RenderTransform>
                  <ScaleTransform ScaleX="1" ScaleY="1"/>
                </Ellipse.RenderTransform>
              </Ellipse>
              <Ellipse x:Name="core" Width="11" Height="11" Canvas.Left="0" Canvas.Top="0" Fill="#FF5A52"/>
            </Canvas>
            <TextBlock x:Name="statusText" Grid.Column="1" Margin="12,0,0,0" FontSize="14" Foreground="#F4F4F5" VerticalAlignment="Center"/>
            <TextBlock x:Name="dots" Grid.Column="2" Margin="2,0,0,0" FontSize="14" Foreground="#A1A1AA" VerticalAlignment="Center"/>
          </Grid>
          <TextBlock x:Name="statusHint" Margin="0,8,0,0" FontSize="12" Foreground="#929298" TextWrapping="Wrap" Visibility="Collapsed"/>
          <Border x:Name="track" Height="3" CornerRadius="1.5" Background="#0DFFFFFF" Margin="0,14,0,0">
            <Grid x:Name="trackClip" ClipToBounds="True">
              <Border x:Name="trackBar" Height="3" CornerRadius="1.5" HorizontalAlignment="Left" Background="#FF5A52" Width="131"/>
            </Grid>
          </Border>
          <StackPanel x:Name="actions" Margin="0,22,0,0">
            <Button x:Name="mainBtn" Style="{StaticResource PrimaryButton}" Content="启动 KERNEL"/>
            <Button x:Name="stopBtn" Style="{StaticResource SecondaryButton}" Content="停止服务" Margin="0,12,0,0" Visibility="Collapsed"/>
            <Button x:Name="logBtn" Style="{StaticResource SecondaryButton}" Content="用 启动.cmd 查看日志" Margin="0,12,0,0" Visibility="Collapsed"/>
          </StackPanel>
          <Grid x:Name="foot" Margin="0,18,0,0">
            <Border Height="1" VerticalAlignment="Top" Background="#0FFFFFFF"/>
            <Grid Margin="0,14,0,0">
              <TextBlock x:Name="footAddr" HorizontalAlignment="Left" FontSize="11.5" Foreground="#929298" FontFamily="Consolas, Microsoft YaHei" Text="127.0.0.1:5173"/>
              <TextBlock x:Name="deskLink" HorizontalAlignment="Right" FontSize="11.5" Foreground="#A1A1AA" Background="Transparent" Cursor="Hand" Text="创建桌面快捷方式">
                <TextBlock.Style>
                  <Style TargetType="TextBlock">
                    <Style.Triggers>
                      <Trigger Property="IsMouseOver" Value="True">
                        <Setter Property="TextDecorations" Value="Underline"/>
                        <Setter Property="Foreground" Value="#F4F4F5"/>
                      </Trigger>
                    </Style.Triggers>
                  </Style>
                </TextBlock.Style>
              </TextBlock>
            </Grid>
          </Grid>
        </StackPanel>
      </Grid>
    </Border>
  </Grid>
</Window>
'@

  $window = [System.Windows.Markup.XamlReader]::Parse($xaml)

  # 窗口图标：kernel.ico（取最大帧，任务栏 / Alt-Tab 更清晰）
  try {
    if (Test-Path -LiteralPath $script:icoFile) {
      $icoUri = New-Object System.Uri -ArgumentList $script:icoFile
      $dec = [System.Windows.Media.Imaging.IconBitmapDecoder]::new($icoUri, [System.Windows.Media.Imaging.BitmapCreateOptions]::None, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
      if ($dec.Frames.Count -gt 0) {
        $best = $dec.Frames[0]
        foreach ($f in $dec.Frames) { if ($f.PixelWidth -gt $best.PixelWidth) { $best = $f } }
        $window.Icon = $best
      }
    }
  } catch { }

  # 元素引用
  $card       = $window.FindName('card')
  $minBtn     = $window.FindName('minBtn')
  $closeBtn   = $window.FindName('closeBtn')
  $mainBtn    = $window.FindName('mainBtn')
  $stopBtn    = $window.FindName('stopBtn')
  $logBtn     = $window.FindName('logBtn')
  $statusText = $window.FindName('statusText')
  $statusHint = $window.FindName('statusHint')
  $dots       = $window.FindName('dots')
  $ring       = $window.FindName('ring')
  $core       = $window.FindName('core')
  $track      = $window.FindName('track')
  $trackClip  = $window.FindName('trackClip')
  $trackBar   = $window.FindName('trackBar')
  $deskLink   = $window.FindName('deskLink')

  # 轨道滑块变换
  $trackBar.RenderTransform = New-Object System.Windows.Media.TranslateTransform

  # ---- 颜色 / 动画助手 ----
  function New-Brush([string]$hex) {
    $col = [System.Windows.Media.ColorConverter]::ConvertFromString($hex)
    try { $col = [System.Windows.Media.Color]::FromArgb([byte]255, $col.R, $col.G, $col.B) } catch { }
    return New-Object System.Windows.Media.SolidColorBrush -ArgumentList $col
  }
  function New-Dur([int]$ms) {
    return (New-Object System.Windows.Duration -ArgumentList ([TimeSpan]::FromMilliseconds($ms)))
  }

  # ---- 脉冲点 ----
  function Set-Pulse([string]$hex, [bool]$animate) {
    $b = New-Brush $hex
    $core.Fill = $b
    $ring.Fill = $b
    $scale = $ring.RenderTransform
    if ($animate -and $script:animEnabled) {
      $sx = New-Object System.Windows.Media.Animation.DoubleAnimation
      $sx.From = 1.0; $sx.To = 2.6; $sx.Duration = (New-Dur 1900)
      $sx.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
      $sx.EasingFunction = New-Object System.Windows.Media.Animation.SineEase
      $sy = New-Object System.Windows.Media.Animation.DoubleAnimation
      $sy.From = 1.0; $sy.To = 2.6; $sy.Duration = (New-Dur 1900)
      $sy.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
      $sy.EasingFunction = New-Object System.Windows.Media.Animation.SineEase
      $op = New-Object System.Windows.Media.Animation.DoubleAnimation
      $op.From = 0.5; $op.To = 0.0; $op.Duration = (New-Dur 1900)
      $op.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
      $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleXProperty, $sx)
      $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, $sy)
      $ring.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $op)
    } else {
      $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleXProperty, $null)
      $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, $null)
      $ring.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $null)
      $scale.ScaleX = 1.0; $scale.ScaleY = 1.0
      $ring.Opacity = 0.0
    }
  }

  # ---- 进度轨 ----
  function Set-Track([string]$mode, [string]$hex) {
    $w = $trackClip.ActualWidth
    if ($w -le 0) { $w = 386 }
    $trackBar.Background = (New-Brush $hex)
    $tt = $trackBar.RenderTransform
    if ($null -eq $tt) { $tt = New-Object System.Windows.Media.TranslateTransform; $trackBar.RenderTransform = $tt }
    if ($script:animEnabled) { $tt.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $null) }
    $tt.X = 0.0
    switch ($mode) {
      'idle' {
        $trackBar.Width = [Math]::Round($w * 0.34)
        $trackBar.Opacity = 0.55
      }
      'starting' {
        $trackBar.Width = [Math]::Round($w * 0.4)
        $trackBar.Opacity = 1.0
        if ($script:animEnabled) {
          $slide = New-Object System.Windows.Media.Animation.DoubleAnimation
          $slide.From = (-1.2 * $trackBar.Width)
          $slide.To = $w
          $slide.Duration = (New-Dur 1600)
          $slide.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
          $slide.EasingFunction = New-Object System.Windows.Media.Animation.SineEase
          $tt.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $slide)
        }
      }
      'ready' {
        $trackBar.Width = $w
        $trackBar.Opacity = 1.0
      }
      'timeout' {
        $trackBar.Width = $w
        $trackBar.Opacity = 0.5
      }
    }
  }

  # ---- 省略号（450ms 循环）----
  $script:dotTimer = $null
  $script:dotCount = 0
  function Start-Dots {
    if (-not $script:animEnabled) { return }
    if ($null -eq $script:dotTimer) {
      $script:dotTimer = New-Object System.Windows.Threading.DispatcherTimer
      $script:dotTimer.Interval = [TimeSpan]::FromMilliseconds(450)
      $script:dotTimer.Add_Tick({
        $script:dotCount = ($script:dotCount + 1) % 4
        $dots.Text = ('.' * $script:dotCount)
      })
      $script:dotTimer.Start()
    }
  }
  function Stop-Dots {
    if ($null -ne $script:dotTimer) { $script:dotTimer.Stop(); $script:dotTimer = $null }
    $script:dotCount = 0
    $dots.Text = ''
  }

  # ---- 状态渲染 ----
  function Render {
    $online = $script:online
    $phase = $script:phase
    $statusHint.Visibility = 'Collapsed'
    $stopBtn.Visibility = 'Collapsed'
    $logBtn.Visibility = 'Collapsed'
    $mainBtn.IsEnabled = $true

    if ($phase -eq 'starting' -and -not $online) {
      $statusText.Text = '正在启动…首次约 10–30 秒'
      $mainBtn.Content = '启动中…'
      $mainBtn.IsEnabled = $false
      Start-Dots
      Set-Pulse '#FF5A52' $true
      Set-Track 'starting' '#FF5A52'
    } elseif ($phase -eq 'stopping' -and $online) {
      $statusText.Text = '停止中…'
      $mainBtn.Content = '打开 KERNEL'
      $mainBtn.IsEnabled = $false
      Start-Dots
      Set-Pulse '#FF5A52' $true
      Set-Track 'starting' '#FF5A52'
    } elseif ($online) {
      $statusText.Text = '已就绪'
      $mainBtn.Content = '打开 KERNEL'
      Stop-Dots
      Set-Pulse '#4CAF7D' $false
      Set-Track 'ready' '#4CAF7D'
      if ($script:weStarted) {
        $stopBtn.Visibility = 'Visible'
        $stopBtn.Content = '停止服务'
      } else {
        $statusHint.Visibility = 'Visible'
        $statusHint.Text = '服务由其他窗口启动，关闭那个窗口即可停止'
      }
    } elseif ($phase -eq 'timeout') {
      $statusText.Text = '启动超时'
      $mainBtn.Content = '重试'
      $logBtn.Visibility = 'Visible'
      $logBtn.Content = '用 启动.cmd 查看日志'
      Stop-Dots
      Set-Pulse '#D08A2B' $false
      Set-Track 'timeout' '#D08A2B'
    } else {
      $statusText.Text = '未启动'
      $mainBtn.Content = '启动 KERNEL'
      Stop-Dots
      Set-Pulse '#FF5A52' $true
      Set-Track 'idle' '#FF5A52'
    }
  }

  # ---- 动作 ----
  function Open-Browser {
    try { Start-Process -FilePath $script:BROWSER_URL } catch { }
  }
  function Open-Log {
    try { Start-Process -FilePath $script:cmdFile } catch { }
  }
  function Kill-Tree([int]$procId) {
    try {
      $tk = Join-Path $env:SystemRoot 'System32\taskkill.exe'
      Start-Process -FilePath $tk -ArgumentList @('/F', '/T', '/PID', "$procId") -WindowStyle Hidden -Wait | Out-Null
    } catch { }
  }
  function Resolve-PidCim {
    if ($script:servicePid -gt 0) { return }
    try {
      $p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*dev.mjs*' } | Select-Object -First 1
      if ($null -ne $p -and $p.ProcessId -gt 0) {
        $script:servicePid = $p.ProcessId
        Write-PidFile $p.ProcessId
      }
    } catch { }
  }
  function Schedule-ResolvePid([int]$afterMs) {
    $t = New-Object System.Windows.Threading.DispatcherTimer
    $t.Interval = [TimeSpan]::FromMilliseconds($afterMs)
    $t.Add_Tick({ param($s, $e) $s.Stop(); Resolve-PidCim })
    $t.Start()
    [void]$script:pidTimers.Add($t)
  }

  function Start-Service {
    try {
      $proc = Start-Process -FilePath $script:nodeExe -ArgumentList ('"' + $script:devMjs + '"') -WindowStyle Hidden -WorkingDirectory $ROOT -PassThru
    } catch {
      $statusText.Text = '启动失败'
      $statusHint.Visibility = 'Visible'
      $statusHint.Text = '无法启动服务，请用 启动.cmd 查看日志'
      $logBtn.Visibility = 'Visible'
      $logBtn.Content = '用 启动.cmd 查看日志'
      return
    }
    if ($null -ne $proc -and $proc.Id -gt 0) {
      $script:servicePid = $proc.Id
      Write-PidFile $proc.Id
    } else {
      $script:servicePid = 0
      Remove-PidFile
      # 只有拿不到 PID 时才回退到 CIM 查询（保持旧 HTA 行为，避免常态卡顿）
      Schedule-ResolvePid 1500
      Schedule-ResolvePid 4000
      Schedule-ResolvePid 8000
    }
    $script:weStarted = $true
    $script:pendingAutoOpen = $true
    $script:startAt = [DateTime]::UtcNow.Ticks
    $script:stopAt = 0
    $script:phase = 'starting'
    Render
  }

  function Stop-Service {
    $target = $script:servicePid
    if (-not $target -or $target -le 0) { $target = Read-PidFile }
    if (-not $target -or $target -le 0) {
      $script:weStarted = $false
      $script:phase = 'idle'
      $statusHint.Visibility = 'Visible'
      $statusHint.Text = '未找到服务进程号，请手动关闭启动窗口'
      Render
      return
    }
    $script:servicePid = $target
    $script:phase = 'stopping'
    $script:stopAt = [DateTime]::UtcNow.Ticks
    Render
    Kill-Tree $target
    Remove-PidFile
  }

  # ---- 探测（HttpClient 轮询，不阻塞 UI）----
  $script:probeClient = New-Object System.Net.Http.HttpClient
  $script:probeClient.Timeout = [TimeSpan]::FromSeconds(5)
  $script:probeTask = $null
  $script:probeInFlight = $false
  $script:probeStarted = 0

  function Start-Probe {
    if ($script:probeInFlight) { return }
    $script:probeInFlight = $true
    $script:probeStarted = [DateTime]::UtcNow.Ticks
    try {
      $script:probeTask = $script:probeClient.GetAsync($script:PROBE_URL)
    } catch {
      $script:probeInFlight = $false
      $script:probeTask = $null
      Handle-Probe $false
    }
  }
  function Poll-Probe {
    if (-not $script:probeInFlight) { return }
    $t = $script:probeTask
    $done = $false
    $res = $false
    if ($null -ne $t -and $t.IsCompleted) {
      $done = $true
      try {
        $resp = $t.Result
        $code = [int]$resp.StatusCode
        $res = ($code -ge 200 -and $code -lt 500)
        $resp.Dispose()
      } catch { $res = $false }
    } elseif (([DateTime]::UtcNow.Ticks - $script:probeStarted) -gt (5300 * [TimeSpan]::TicksPerMillisecond)) {
      $done = $true
      $res = $false
      try { if ($null -ne $t) { [void]$t.Dispose() } } catch { }
    }
    if ($done) {
      $script:probeInFlight = $false
      $script:probeTask = $null
      Handle-Probe $res
    }
  }
  function Handle-Probe([bool]$ok) {
    $script:online = $ok
    if ($script:phase -eq 'starting') {
      if ($ok) {
        $script:phase = 'ready'
        if ($script:pendingAutoOpen) { $script:pendingAutoOpen = $false; Open-Browser }
      } elseif ($script:startAt -gt 0 -and (([DateTime]::UtcNow.Ticks - $script:startAt) -ge ($script:START_TIMEOUT_MS * [TimeSpan]::TicksPerMillisecond))) {
        $script:phase = 'timeout'
      }
    } elseif ($script:phase -eq 'stopping') {
      if (-not $ok) {
        $script:weStarted = $false; $script:servicePid = 0; $script:pendingAutoOpen = $false
        Remove-PidFile; $script:phase = 'idle'
      } elseif ($script:stopAt -gt 0 -and (([DateTime]::UtcNow.Ticks - $script:stopAt) -ge ($script:STOP_TIMEOUT_MS * [TimeSpan]::TicksPerMillisecond))) {
        $script:weStarted = $false; $script:servicePid = 0; $script:phase = 'idle'
      }
    } elseif ($ok) {
      if ($script:phase -ne 'ready') { $script:phase = 'ready' }
    } elseif ($script:phase -eq 'ready') {
      $script:weStarted = $false; $script:servicePid = 0; $script:pendingAutoOpen = $false; $script:phase = 'idle'
    }
    if ($script:weStarted -and $script:servicePid -le 0) {
      $rp = Read-PidFile
      if ($rp -gt 0) { $script:servicePid = $rp }
    }
    Render
  }
  function Tick {
    Poll-Probe
    if (-not $script:probeInFlight) { Start-Probe }
  }

  # ---- 事件接线 ----
  $script:pidTimers = New-Object System.Collections.ArrayList

  $mainBtn.Add_Click({ if ($script:online) { Open-Browser } else { Start-Service } })
  $stopBtn.Add_Click({ Stop-Service })
  $logBtn.Add_Click({ Open-Log })
  $minBtn.Add_Click({ $window.WindowState = [System.Windows.WindowState]::Minimized })
  $closeBtn.Add_Click({ $window.Close() })
  $deskLink.Add_MouseLeftButtonUp({
    if (New-DesktopShortcut) {
      $statusHint.Visibility = 'Visible'
      $statusHint.Text = '已创建到桌面'
    } else {
      $statusHint.Visibility = 'Visible'
      $statusHint.Text = '创建快捷方式失败'
    }
  })
  $card.Add_MouseLeftButtonDown({
    param($s, $e)
    $node = $e.OriginalSource
    while ($null -ne $node) {
      if ($node -is [System.Windows.Controls.Button]) { return }
      if ($node -eq $card) { break }
      try { $node = [System.Windows.Media.VisualTreeHelper]::GetParent($node) } catch { $node = $null }
    }
    try { $window.DragMove() } catch { }
  })

  # ---- 入场 / 居中 ----
  $window.Add_Loaded({
    try {
      $wa = [System.Windows.SystemParameters]::WorkArea
      $window.Left = $wa.Left + (($wa.Width - $window.ActualWidth) / 2)
      $window.Top  = $wa.Top + (($wa.Height - $window.ActualHeight) / 2)
    } catch { }
    if ($script:animEnabled) {
      $tt = New-Object System.Windows.Media.TranslateTransform
      $tt.Y = 6
      $card.RenderTransform = $tt
      $fy = New-Object System.Windows.Media.Animation.DoubleAnimation
      $fy.From = 6; $fy.To = 0; $fy.Duration = (New-Dur 220)
      $fy.EasingFunction = New-Object System.Windows.Media.Animation.CubicEase
      $tt.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, $fy)
      $fo = New-Object System.Windows.Media.Animation.DoubleAnimation
      $fo.From = 0; $fo.To = 1; $fo.Duration = (New-Dur 220)
      $window.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fo)
    } else {
      $window.Opacity = 1
    }
    Tick
  })

  # ---- 主计时器（800ms）----
  $script:mainTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:mainTimer.Interval = [TimeSpan]::FromMilliseconds($script:POLL_MS)
  $script:mainTimer.Add_Tick({ Tick })
  $script:mainTimer.Start()

  # ---- 冒烟：定时自动关闭（绝不启动任何东西）----
  if ($isSmoke) {
    $script:smokeTimer = New-Object System.Windows.Threading.DispatcherTimer
    $script:smokeTimer.Interval = [TimeSpan]::FromMilliseconds($smokeMs)
    $script:smokeTimer.Add_Tick({ param($s, $e) $s.Stop(); $window.Close() })
    $script:smokeTimer.Start()
  }

  Render
  [void]$window.ShowDialog()

  $script:mainTimer.Stop()
  if ($null -ne $script:dotTimer) { $script:dotTimer.Stop() }
  try { $script:probeClient.Dispose() } catch { }
  exit 0
} catch {
  try { [System.Windows.MessageBox]::Show($_.Exception.Message, 'KERNEL 启动器') } catch { }
  exit 1
}
