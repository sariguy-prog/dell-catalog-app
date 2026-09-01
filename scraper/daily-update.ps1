# Daily automated catalog update: runs npm run scrape and pushes to GitHub if it succeeded.
# Runs from Windows Task Scheduler (see scraper/register-daily-task.ps1 to set it up).
# Logs to a file so a failed run can be diagnosed later.

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectDir "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}
$logFile = Join-Path $logDir ("daily-update-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))

function Write-Log($message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $message
    Write-Output $line
    Add-Content -Path $logFile -Value $line
}

Set-Location $projectDir
Write-Log "Starting daily update"

try {
    npm run scrape 2>&1 | ForEach-Object { Write-Log $_ }
    $scrapeExitCode = $LASTEXITCODE

    if ($scrapeExitCode -ne 0) {
        Write-Log "Scraper exited with error (code $scrapeExitCode) - skipping commit"
        exit 1
    }

    git add site/data/products.json 2>&1 | ForEach-Object { Write-Log $_ }
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Log "No catalog changes - nothing to commit"
    } else {
        git commit -m "Automatic daily catalog update" 2>&1 | ForEach-Object { Write-Log $_ }
        git push 2>&1 | ForEach-Object { Write-Log $_ }
        Write-Log "Catalog updated and pushed successfully"
    }
} catch {
    Write-Log "Error: $_"
    exit 1
}

Write-Log "Done"
