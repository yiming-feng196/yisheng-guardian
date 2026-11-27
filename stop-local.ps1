$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$voicePid = Join-Path $projectRoot '.runtime/voice-pid.txt'
if (Test-Path -LiteralPath $voicePid) {
    $voiceId = [int](Get-Content -LiteralPath $voicePid)
    $voiceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$voiceId" -ErrorAction SilentlyContinue
    if ($voiceProcess -and $voiceProcess.CommandLine.Contains($projectRoot) -and $voiceProcess.CommandLine.Contains('voice-service')) { Stop-Process -Id $voiceId }
}
$pidPath = Join-Path $projectRoot '.runtime/local-pids.json'
if (!(Test-Path -LiteralPath $pidPath)) { Write-Output 'No managed local processes.'; exit 0 }
$ids = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
foreach ($managedId in @($ids.backend,$ids.redis)) {
    if (!$managedId) { continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$managedId)" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains($projectRoot)) {
        Stop-Process -Id ([int]$managedId)
        Write-Output "Stopped local process $managedId"
    }
}
