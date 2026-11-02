$ErrorActionPreference = "Stop"
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($node) {
  $node = $node.Source
} else {
  $node = Join-Path $env:LOCALAPPDATA "Programs\@opencode-aidesktop\OpenCode.exe"
  if (-not (Test-Path $node)) { throw "Node >= 24 not found: install Node.js or OpenCode Desktop." }
  $env:ELECTRON_RUN_AS_NODE = "1"
}
# crashpad in Electron-as-Node writes noise to stderr; do not let it throw
$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $node (Join-Path $PSScriptRoot "install-win.mjs") 2>&1 | Where-Object { $_ -notmatch "crashpad" }
$code = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($code -ne 0) { throw "install-win.mjs failed with exit code $code" }
