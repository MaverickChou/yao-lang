# Yao launcher for PowerShell.
#   .\yao.ps1 cast
#   .\yao.ps1 eval "互(既济)"
# If blocked by execution policy:
#   powershell -ExecutionPolicy Bypass -File .\yao.ps1 cast
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 in the system ANSI
# codepage, so non-ASCII text here would break parsing.

$ErrorActionPreference = 'Stop'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$candidates = @(
  (Join-Path $PSScriptRoot 'runtime\node.exe'),
  (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
) | Where-Object { $_ -and (Test-Path $_) }

$node = $candidates | Select-Object -First 1
if (-not $node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source }
}

if (-not $node) {
  Write-Host '[yao] Node.js not found. Install https://nodejs.org/' -ForegroundColor Yellow
  exit 1
}

& $node (Join-Path $PSScriptRoot 'bin\yao.js') @args
exit $LASTEXITCODE
