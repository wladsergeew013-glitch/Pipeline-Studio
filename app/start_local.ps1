param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$studioScript = Join-Path $PSScriptRoot 'local.py'
$studioCandidates = @()
$studioBundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path -LiteralPath $studioBundled) { $studioCandidates += @{Path=$studioBundled; Prefix=@()} }
$studioPy = Get-Command py.exe -ErrorAction SilentlyContinue
if ($studioPy) { $studioCandidates += @{Path=$studioPy.Source; Prefix=@('-3')} }
$studioPython = Get-Command python.exe -ErrorAction SilentlyContinue
if ($studioPython) { $studioCandidates += @{Path=$studioPython.Source; Prefix=@()} }
foreach ($studioCandidate in $studioCandidates) {
    try {
        $studioVersionArgs = @($studioCandidate.Prefix) + @('-c','import sys;sys.exit(0 if sys.version_info >= (3,10) else 1)')
        & $studioCandidate.Path @studioVersionArgs 2>$null
        if ($LASTEXITCODE -ne 0) { continue }
        $studioArgs = @($studioCandidate.Prefix) + @(('"' + $studioScript + '"'))
        if (-not $NoBrowser) { $studioArgs += '--open' }
        Start-Process -FilePath $studioCandidate.Path -ArgumentList $studioArgs -WorkingDirectory $studioRoot -WindowStyle Hidden
        exit 0
    } catch {}
}
throw 'Pipeline Studio local mode requires Python 3.10 or newer.'
