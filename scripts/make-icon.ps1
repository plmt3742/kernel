# KERNEL - kernel.ico generator (ASCII only; reproducible).
#
# Renders the KERNEL brand mark (geometry from public/favicon.svg: a 64x64 viewBox
# with three strokes M20,14 V50 / M20,33 L44,14 / M20,33 L44,50, stroke width 5,
# square caps) as a rounded-square app icon at several sizes, then packs them into a
# multi-size PNG-compressed ICO container (256/128/64/48/32/24/16, 256 dims byte = 0).
#
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icon.ps1 [-Out <path>]
param(
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if ([string]::IsNullOrEmpty($Out)) {
  $repoRoot = Split-Path -Parent $PSScriptRoot
  $Out = Join-Path $repoRoot 'kernel.ico'
}

# Palette (from docs/03-DESIGN-SYSTEM.md soft dark night).
$bgColor = [System.Drawing.Color]::FromArgb(255, 15, 15, 16)      # #0F0F10
$borderColor = [System.Drawing.Color]::FromArgb(26, 255, 255, 255) # rgba(255,255,255,0.10)
$markColor = [System.Drawing.Color]::FromArgb(255, 244, 244, 245)  # #F4F4F5

function New-KernelBitmap {
  param([int]$Size)
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  # Rounded square: corner radius = 22% of size.
  $radius = 0.22 * $Size
  $d = 2.0 * $radius
  $rectPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $rectPath.AddArc(0.0, 0.0, $d, $d, 180.0, 90.0)
  $rectPath.AddArc($Size - $d, 0.0, $d, $d, 270.0, 90.0)
  $rectPath.AddArc($Size - $d, $Size - $d, $d, $d, 0.0, 90.0)
  $rectPath.AddArc(0.0, $Size - $d, $d, $d, 90.0, 90.0)
  $rectPath.CloseFigure()

  $fill = New-Object System.Drawing.SolidBrush $bgColor
  $g.FillPath($fill, $rectPath)

  # 1px border kept inside the rounded square.
  $penBorder = New-Object System.Drawing.Pen $borderColor, 1.0
  $penBorder.Alignment = [System.Drawing.Drawing2D.PenAlignment]::Inset
  $g.DrawPath($penBorder, $rectPath)

  # K strokes: scale 64 -> Size.
  $s = $Size / 64.0
  $penK = New-Object System.Drawing.Pen $markColor, (5.0 * $s)
  $penK.StartCap = [System.Drawing.Drawing2D.LineCap]::Square
  $penK.EndCap = [System.Drawing.Drawing2D.LineCap]::Square
  $penK.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
  $g.DrawLine($penK, (20.0 * $s), (14.0 * $s), (20.0 * $s), (50.0 * $s))
  $g.DrawLine($penK, (20.0 * $s), (33.0 * $s), (44.0 * $s), (14.0 * $s))
  $g.DrawLine($penK, (20.0 * $s), (33.0 * $s), (44.0 * $s), (50.0 * $s))

  $penBorder.Dispose()
  $penK.Dispose()
  $fill.Dispose()
  $rectPath.Dispose()
  $g.Dispose()
  return $bmp
}

function Get-PngBytes {
  param([System.Drawing.Bitmap]$Bmp)
  $ms = New-Object System.IO.MemoryStream
  $Bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $ms.Dispose()
  return $bytes
}

$sizes = @(256, 128, 64, 48, 32, 24, 16)
$entries = @()
foreach ($sz in $sizes) {
  $bmp = New-KernelBitmap -Size $sz
  $png = Get-PngBytes -Bmp $bmp
  $bmp.Dispose()
  $entries += [pscustomobject]@{ Size = $sz; Bytes = $png }
}

# ICO container: ICONDIR (6) + ICONDIRENTRY (16 each) + image blobs.
$outMs = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($outMs)
$bw.Write([UInt16]0)                 # reserved
$bw.Write([UInt16]1)                 # type = icon
$bw.Write([UInt16]$entries.Count)    # image count

$offset = 6 + (16 * $entries.Count)
foreach ($e in $entries) {
  $dim = if ($e.Size -ge 256) { 0 } else { $e.Size }
  $bw.Write([Byte]$dim)              # width (0 => 256)
  $bw.Write([Byte]$dim)              # height (0 => 256)
  $bw.Write([Byte]0)                 # color count (0 for 32bpp)
  $bw.Write([Byte]0)                 # reserved
  $bw.Write([UInt16]1)               # planes
  $bw.Write([UInt16]32)              # bit count
  $bw.Write([UInt32]$e.Bytes.Length) # bytes in resource
  $bw.Write([UInt32]$offset)         # image offset
  $offset += $e.Bytes.Length
}
foreach ($e in $entries) { $bw.Write([byte[]]$e.Bytes, 0, $e.Bytes.Length) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($Out, $outMs.ToArray())
$bw.Dispose()
$outMs.Dispose()

$info = Get-Item -LiteralPath $Out
Write-Output ("ICON_WRITTEN=" + $info.FullName + " bytes=" + $info.Length + " sizes=" + ($sizes -join ','))
