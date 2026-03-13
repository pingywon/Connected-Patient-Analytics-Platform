param(
  [string]$OutputDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "marketing")
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$indexPath = Join-Path $repoRoot "index.html"

if (!(Test-Path $indexPath)) {
  throw "Could not find index.html at $indexPath"
}

$edgePath = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (!$edgePath) {
  throw "No supported browser executable found for headless screenshots."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$indexUri = ([System.Uri](Get-Item $indexPath).FullName).AbsoluteUri

$shots = @(
  @{ Name = "calmcpap-overview.png"; Tab = "overview" },
  @{ Name = "calmcpap-leaks.png"; Tab = "leaks" },
  @{ Name = "calmcpap-pressure.png"; Tab = "pressure" },
  @{ Name = "calmcpap-events.png"; Tab = "events" }
)

foreach ($shot in $shots) {
  $url = "$indexUri#demo=1&tab=$($shot.Tab)"
  $outputPath = Join-Path $OutputDir $shot.Name
  $profileDir = Join-Path $env:TEMP ("calmcpap-headless-" + [guid]::NewGuid().ToString())

  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

  try {
    & $edgePath `
      --headless `
      --disable-gpu `
      --hide-scrollbars `
      --allow-file-access-from-files `
      --no-first-run `
      --no-default-browser-check `
      "--user-data-dir=$profileDir" `
      --window-size=1600,1200 `
      --virtual-time-budget=12000 `
      "--screenshot=$outputPath" `
      $url | Out-Null

    if (!(Test-Path $outputPath)) {
      throw "Screenshot was not created: $outputPath"
    }

    Get-Item $outputPath | Select-Object Name, Length, FullName
  }
  finally {
    if (Test-Path $profileDir) {
      Remove-Item -Recurse -Force $profileDir
    }
  }
}
