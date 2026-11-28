$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$voicePid = Join-Path $projectRoot '.runtime/voice-pid.txt'
if (Test-Path -LiteralPath $voicePid) {
    $voiceId = [int](Get-Content -LiteralPath $voicePid)
    $voiceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$voiceId" -ErrorAction SilentlyContinue
    if ($voiceProcess -and $voiceProcess.CommandLine -and $voiceProcess.CommandLine.Contains($projectRoot) -and $voiceProcess.CommandLine.Contains('voice-service')) { Stop-Process -Id $voiceId }
}
$pidPath = Join-Path $projectRoot '.runtime/local-pids.json'
if (!(Test-Path -LiteralPath $pidPath)) { Write-Output 'No managed local processes.'; exit 0 }
$ids = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
$redisRoot = (Join-Path $projectRoot '.runtime\native-tools\redis') + '\'
foreach ($managedId in @($ids.backend,$ids.redis)) {
    if (!$managedId) { continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$managedId)" -ErrorAction SilentlyContinue
    if (!$process) { continue }
    $managedBackend = $managedId -eq $ids.backend -and $process.CommandLine -and
        $process.CommandLine.Contains((Join-Path $projectRoot '.runtime\backend-local.jar'))
    $managedRedis = $managedId -eq $ids.redis -and $process.ExecutablePath -and
        $process.ExecutablePath.StartsWith($redisRoot, [StringComparison]::OrdinalIgnoreCase) -and
        $process.Name -eq 'redis-server.exe'
    if ($managedBackend -or $managedRedis) {
        Stop-Process -Id ([int]$managedId)
        Write-Output "Stopped local process $managedId"
    }
}
