# build-python-release.ps1
# Packages a built python-embed/ into the GitHub-release assets that the app's
# first-run downloader (electron/python-setup.ts) expects:
#   - python-deps-hash.txt              (deps fingerprint; the app bundles the SAME file
#                                        and refuses a download whose hash doesn't match)
#   - python-embed-win32.manifest.json  ({ parts:[{name,size}], totalSize })
#   - python-embed-win32.tar.gz.partNN  (the tarball split into <2GB GitHub-safe parts)
#
# Workflow for a release:
#   1) scripts\prepare-python.ps1              # builds python-embed/ (~5GB, downloads torch+cu128)
#   2) scripts\build-python-release.ps1        # -> python-release/ assets + writes python-deps-hash.txt
#   3) build the app (local-build) so it bundles the freshly written python-deps-hash.txt
#   4) gh release create v<version> --repo MichaelRicks/LTX-Desktop-Mike (python-release\*)
#
# The hash is computed the SAME way for the bundled file and the release asset, so they
# always agree — it does not need to match Lightricks' original algorithm.

param(
  [string]$PythonEmbedDir = "python-embed",
  [string]$OutputDir = "python-release",
  [long]$PartSizeBytes = 1900MB   # under GitHub's 2GB per-asset limit
)

$ErrorActionPreference = "Stop"
$root  = Split-Path -Parent $PSScriptRoot
$embed = Join-Path $root $PythonEmbedDir
$out   = Join-Path $root $OutputDir
$prefix = "python-embed-win32"

if (-not (Test-Path $embed)) {
  throw "python-embed not found at '$embed'. Run scripts\prepare-python.ps1 first."
}
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null

# ── 1. deps hash: sha256 of the frozen dependency export (changes iff deps change) ──
Write-Host "Computing deps hash..." -ForegroundColor Yellow
Push-Location (Join-Path $root "backend")
$export = & uv export --frozen --no-hashes --no-editable --no-emit-project
Pop-Location
if ($LASTEXITCODE -ne 0) { throw "uv export failed" }
$bytes = [System.Text.Encoding]::UTF8.GetBytes(($export -join "`n"))
$sha   = [System.Security.Cryptography.SHA256]::Create()
$hash  = ([System.BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-','').ToLower()
# Written at repo root for the app build (electron-builder copies it), and into the
# release output so the downloader can verify a match before pulling the archive.
Set-Content -Path (Join-Path $root "python-deps-hash.txt") -Value $hash -NoNewline -Encoding ascii
Copy-Item   (Join-Path $root "python-deps-hash.txt") (Join-Path $out "python-deps-hash.txt")
Write-Host "  deps hash: $hash" -ForegroundColor Green

# ── 1b. verify the embed actually matches the lockfile ──
# The hash above is derived from the lockfile, NOT from what's installed — so a
# stale embed (e.g. a leftover ltx_core 1.1.1 build while the lock is on 1.2.0)
# would ship with a "correct" hash and crash the backend on first launch. Run the
# embed's own python to compare every locked dependency (pinned versions AND git
# commits) against what's really installed, and refuse to package on any drift.
Write-Host "Verifying embed matches the lockfile..." -ForegroundColor Yellow
$embedPy  = Join-Path $embed "python.exe"
$verifier = Join-Path $PSScriptRoot "verify_python_embed.py"
if (-not (Test-Path $embedPy)) { throw "embed python not found at '$embedPy'" }
$reqFile = Join-Path ([System.IO.Path]::GetTempPath()) "rix-embed-verify-req.txt"
Set-Content -Path $reqFile -Value ($export -join "`n") -Encoding utf8
try {
  & $embedPy $verifier $reqFile
  if ($LASTEXITCODE -ne 0) {
    throw "python-embed does not match the lockfile (drift listed above). Rebuild it with scripts\prepare-python.ps1, then re-run this script."
  }
} finally {
  Remove-Item $reqFile -Force -ErrorAction SilentlyContinue
}

# ── 2. tar the embed dir (keep a top-level python-embed/ inside, as the extractor expects) ──
Write-Host "Creating tarball (this can take a while for a ~5GB env)..." -ForegroundColor Yellow
$tar = Join-Path $out "$prefix.tar.gz"
Push-Location $root
& tar -czf $tar $PythonEmbedDir
Pop-Location
if ($LASTEXITCODE -ne 0) { throw "tar failed" }
Write-Host ("  tarball: {0:N0} MB" -f ((Get-Item $tar).Length / 1MB)) -ForegroundColor Green

# ── 3. split into <2GB parts (streamed, so a 5GB file never loads into memory) ──
Write-Host "Splitting into parts..." -ForegroundColor Yellow
$parts = @()
$fs = [System.IO.File]::OpenRead($tar)
try {
  $buf = New-Object byte[] (8MB)
  $idx = 0
  while ($fs.Position -lt $fs.Length) {
    $partName = "{0}.tar.gz.part{1:D2}" -f $prefix, $idx
    $partPath = Join-Path $out $partName
    $pfs = [System.IO.File]::Create($partPath)
    $written = 0L
    try {
      while ($written -lt $PartSizeBytes -and $fs.Position -lt $fs.Length) {
        $toRead = [int][Math]::Min([long]$buf.Length, $PartSizeBytes - $written)
        $read = $fs.Read($buf, 0, $toRead)
        if ($read -le 0) { break }
        $pfs.Write($buf, 0, $read)
        $written += $read
      }
    } finally { $pfs.Dispose() }
    $parts += [ordered]@{ name = $partName; size = $written }
    Write-Host ("  {0}  ({1:N0} MB)" -f $partName, ($written / 1MB))
    $idx++
  }
} finally { $fs.Dispose() }
Remove-Item $tar -Force   # keep only the parts

# ── 4. manifest ──
$totalSize = ($parts | ForEach-Object { $_.size } | Measure-Object -Sum).Sum
$manifest = [ordered]@{ parts = @($parts); totalSize = $totalSize }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $out "$prefix.manifest.json") -Encoding ascii

Write-Host "`nRelease assets ready in $out :" -ForegroundColor Cyan
Get-ChildItem $out | Format-Table Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB) } } -AutoSize
Write-Host "Next: build the app (so it bundles python-deps-hash.txt), then upload, e.g.:" -ForegroundColor Cyan
Write-Host "  gh release create v1.2.7 --repo MichaelRicks/LTX-Desktop-Mike --title `"v1.2.7`" (Get-ChildItem `"$out`" | % FullName)"
