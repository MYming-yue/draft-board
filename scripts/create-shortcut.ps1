param(
  [Parameter(Mandatory=$true)][string]$Target,
  [Parameter(Mandatory=$true)][string]$Link
)
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($Link)
$sc.TargetPath = $Target
$sc.WorkingDirectory = Split-Path $Target
$sc.WindowStyle = 7
$sc.Description = "Digital Draft Board"
$sc.Save()
Write-Output "shortcut created: $Link"
