# Registers a Windows Task Scheduler task that runs daily-update.ps1 every day at 03:00.
# Run this once (as the current user) to set it up.
#
# To remove: Unregister-ScheduledTask -TaskName "DellCatalogDailyUpdate" -Confirm:$false

$taskName = "DellCatalogDailyUpdate"
$scriptPath = Join-Path $PSScriptRoot "daily-update.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At "03:00"

# WakeToRun: wakes the machine from sleep at 03:00 to run the task (does nothing if
# fully powered off). AllowStartIfOnBatteries/DontStopIfGoingOnBatteries so a laptop on
# battery still runs/finishes the update instead of Task Scheduler killing it mid-run,
# which is what caused the first scheduled run to die partway through.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -WakeToRun `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Automatic daily Dell catalog update (scrape + git push)" `
    -Force `
    -ErrorAction Stop

Write-Output "Task '$taskName' registered successfully - will run daily at 03:00."
