param(
  [string]$OutputDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "assets")
)

Add-Type -AssemblyName System.Drawing

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

function Trim-WhiteBorder {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255).ToArgb()
    $left = 0
    $right = $bitmap.Width - 1
    $top = 0
    $bottom = $bitmap.Height - 1

    while ($left -le $right) {
      $found = $false
      for ($y = 0; $y -lt $bitmap.Height; $y++) {
        if ($bitmap.GetPixel($left, $y).ToArgb() -ne $white) {
          $found = $true
          break
        }
      }
      if ($found) { break }
      $left++
    }

    while ($right -ge $left) {
      $found = $false
      for ($y = 0; $y -lt $bitmap.Height; $y++) {
        if ($bitmap.GetPixel($right, $y).ToArgb() -ne $white) {
          $found = $true
          break
        }
      }
      if ($found) { break }
      $right--
    }

    while ($top -le $bottom) {
      $found = $false
      for ($x = $left; $x -le $right; $x++) {
        if ($bitmap.GetPixel($x, $top).ToArgb() -ne $white) {
          $found = $true
          break
        }
      }
      if ($found) { break }
      $top++
    }

    while ($bottom -ge $top) {
      $found = $false
      for ($x = $left; $x -le $right; $x++) {
        if ($bitmap.GetPixel($x, $bottom).ToArgb() -ne $white) {
          $found = $true
          break
        }
      }
      if ($found) { break }
      $bottom--
    }

    $cropWidth = $right - $left + 1
    $cropHeight = $bottom - $top + 1
    if ($cropWidth -le 0 -or $cropHeight -le 0) {
      throw "Could not detect screenshot content bounds for $Path"
    }

    if ($cropWidth -eq $bitmap.Width -and $cropHeight -eq $bitmap.Height) {
      return
    }

    $tempPath = [System.IO.Path]::Combine(
      [System.IO.Path]::GetDirectoryName($Path),
      ([System.IO.Path]::GetFileNameWithoutExtension($Path) + ".trimmed" + [System.IO.Path]::GetExtension($Path))
    )
    $target = New-Object System.Drawing.Bitmap($cropWidth, $cropHeight)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($target)
      try {
        $graphics.DrawImage(
          $bitmap,
          (New-Object System.Drawing.Rectangle(0, 0, $cropWidth, $cropHeight)),
          (New-Object System.Drawing.Rectangle($left, $top, $cropWidth, $cropHeight)),
          [System.Drawing.GraphicsUnit]::Pixel
        )
      }
      finally {
        $graphics.Dispose()
      }

      $target.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
      $target.Dispose()
    }
  }
  finally {
    $bitmap.Dispose()
  }

  Move-Item -Force $tempPath $Path
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$indexUri = ([System.Uri](Get-Item $indexPath).FullName).AbsoluteUri

$shots = @(
  @{ Name = "calmcpap-overview.png"; Tab = "overview" },
  @{ Name = "calmcpap-pressure.png"; Tab = "pressure" },
  @{ Name = "calmcpap-compare.png"; Tab = "compare" },
  @{ Name = "calmcpap-events.png"; Tab = "events" }
)

foreach ($shot in $shots) {
  $url = "$indexUri#demo=1&skipOnboarding=1&tab=$($shot.Tab)"
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

    Trim-WhiteBorder -Path $outputPath
    Get-Item $outputPath | Select-Object Name, Length, FullName
  }
  finally {
    if (Test-Path $profileDir) {
      Remove-Item -Recurse -Force $profileDir
    }
  }
}
