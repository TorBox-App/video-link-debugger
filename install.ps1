# Installs the latest video-link-debugger release for Windows.
#
#   powershell -c "irm https://raw.githubusercontent.com/TorBox-App/video-link-debugger/main/install.ps1 | iex"
#
# Environment overrides:
#   $env:VERSION      release tag to install, e.g. v1.1.0 (default: latest stable release)
#   $env:INSTALL_DIR  where to put the exe (default: %LOCALAPPDATA%\video-link-debugger)

$ErrorActionPreference = 'Stop'

$Repo = 'TorBox-App/video-link-debugger'
$Name = 'video-link-debugger'
$Version = if ($env:VERSION) { $env:VERSION } else { 'latest' }
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA $Name }

$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$asset = switch ($arch) {
  'AMD64' { "$Name-windows-x64.exe" }
  'ARM64' { "$Name-windows-arm64.exe" }
  default { throw "Unsupported architecture: $arch" }
}

$url = if ($Version -eq 'latest') {
  "https://github.com/$Repo/releases/latest/download/$asset"
} else {
  "https://github.com/$Repo/releases/download/$Version/$asset"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Exe = Join-Path $InstallDir "$Name.exe"

Write-Host "Downloading $asset ($Version)..."
Invoke-WebRequest -Uri $url -OutFile $Exe -UseBasicParsing

# Clear the mark-of-the-web so SmartScreen doesn't block the unsigned exe.
Unblock-File -Path $Exe -ErrorAction SilentlyContinue

$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($UserPath -split ';') -notcontains $InstallDir) {
  [Environment]::SetEnvironmentVariable('Path', "$UserPath;$InstallDir", 'User')
  $env:Path = "$env:Path;$InstallDir"
  Write-Host "Added $InstallDir to your user PATH (open a new terminal to pick it up)."
}

Write-Host "Installed $Exe"
Write-Host ''
Write-Host 'Run it with:'
Write-Host "  $Name test https://example.com/video.mp4"
