$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) "public"

function New-DraftBoardIcon([int]$size, [string]$path) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(91, 108, 255))

  $scale = $size / 512.0
  $cardBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(246, 247, 255))
  $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(194, 202, 255), (16 * $scale))
  $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $nodeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 202, 82))

  $graphics.DrawLine($linePen, 186 * $scale, 192 * $scale, 332 * $scale, 150 * $scale)
  $graphics.DrawLine($linePen, 186 * $scale, 192 * $scale, 332 * $scale, 292 * $scale)
  $graphics.FillRectangle($cardBrush, 76 * $scale, 126 * $scale, 154 * $scale, 132 * $scale)
  $graphics.FillRectangle($cardBrush, 302 * $scale, 82 * $scale, 134 * $scale, 112 * $scale)
  $graphics.FillRectangle($cardBrush, 302 * $scale, 248 * $scale, 134 * $scale, 112 * $scale)
  $graphics.FillEllipse($nodeBrush, 213 * $scale, 175 * $scale, 34 * $scale, 34 * $scale)

  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $nodeBrush.Dispose()
  $linePen.Dispose()
  $cardBrush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-DraftBoardIcon 192 (Join-Path $outDir "icon-192.png")
New-DraftBoardIcon 512 (Join-Path $outDir "icon-512.png")
Write-Output "PWA icons generated in $outDir"
