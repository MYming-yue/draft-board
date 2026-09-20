param(
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$installUrl = "http://127.0.0.1:4188/"
$previewProcess = $null

function Resolve-NodeExecutable {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  throw "Node.js was not found. Please install Node.js or run the installer from Codex."
}

function Test-PreviewReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $installUrl -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

try {
  Set-Location -LiteralPath $projectRoot
  $nodeExe = Resolve-NodeExecutable

  Write-Host "[1/3] Checking and building Draft Board..." -ForegroundColor Cyan
  & $nodeExe "node_modules\typescript\bin\tsc" "--noEmit" "-p" "tsconfig.json"
  if ($LASTEXITCODE -ne 0) { throw "TypeScript check failed (exit code $LASTEXITCODE)." }
  & $nodeExe "node_modules\vite\bin\vite.js" "build"
  if ($LASTEXITCODE -ne 0) { throw "Vite build failed (exit code $LASTEXITCODE)." }

  Write-Host "[2/3] Starting the local installation page..." -ForegroundColor Cyan
  if (-not (Test-PreviewReady)) {
    $previewProcess = Start-Process `
      -FilePath $nodeExe `
      -ArgumentList @("node_modules\vite\bin\vite.js", "preview", "--host", "127.0.0.1", "--port", "4188", "--strictPort") `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -PassThru

    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-PreviewReady)) {
      if ($previewProcess.HasExited) { throw "The preview service exited unexpectedly (exit code $($previewProcess.ExitCode))." }
      if ((Get-Date) -gt $deadline) { throw "The preview service did not become ready within 20 seconds." }
      Start-Sleep -Milliseconds 300
    }
  }

  Write-Host "[3/3] The installation page is ready: $installUrl" -ForegroundColor Green
  if (-not $NoOpen) {
    $chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
    $edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    if (Test-Path -LiteralPath $chrome) {
      Start-Process -FilePath $chrome -ArgumentList $installUrl
    } elseif (Test-Path -LiteralPath $edge) {
      Start-Process -FilePath $edge -ArgumentList $installUrl
    } else {
      Start-Process $installUrl
    }

    Write-Host ""
    Write-Host "In the opened page, click 'Install Desktop App' or the install icon in the address bar." -ForegroundColor Yellow
    Write-Host "After installation, double-click a .draft file and select Digital Draft Board." -ForegroundColor Yellow
    Write-Host "This window will stay open so errors cannot disappear." -ForegroundColor DarkGray
    [void](Read-Host "Press Enter after installation is complete")
  }
} catch {
  Write-Host ""
  Write-Host "Installation preparation failed:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  if (-not $NoOpen) { [void](Read-Host "Press Enter to close") }
  exit 1
} finally {
  if ($previewProcess -and -not $previewProcess.HasExited) {
    Stop-Process -Id $previewProcess.Id -Force -ErrorAction SilentlyContinue
  }
}

exit 0
