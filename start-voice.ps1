param([ValidateRange(1, 1800)][int]$TimeoutSeconds = 600)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '.runtime'
$logs = Join-Path $runtime 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$existing = Get-NetTCPConnection -State Listen -LocalPort 5010 -ErrorAction SilentlyContinue
if ($existing) {
    $health = Invoke-RestMethod 'http://127.0.0.1:5010/health' -TimeoutSec 3
    if ($health.service -ne 'yisheng-voice') { throw 'Port 5010 belongs to another service.' }
    if ($health.asrReady -ne $true) { throw 'Voice worker is listening but ASR is not ready.' }
    Write-Output 'Voice worker already running.'
    return
}
$pythonExe = Join-Path $runtime 'voice-venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $pythonExe)) {
    & python -m venv (Join-Path $runtime 'voice-venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.10+ is required for voice setup.' }
}
$marker = Join-Path $runtime 'voice-dependencies-v2'
if (!(Test-Path -LiteralPath $marker)) {
    & $pythonExe -m pip install --no-cache-dir -r (Join-Path $PSScriptRoot 'voice-service/requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Voice dependencies could not be installed.' }
    Set-Content -LiteralPath $marker -Value 'installed'
}
$worker = Start-Process -FilePath $pythonExe -ArgumentList @('"' + (Join-Path $PSScriptRoot 'voice-service/app.py') + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'voice.out.log') -RedirectStandardError (Join-Path $logs 'voice.err.log')
$pidPath = Join-Path $runtime 'voice-pid.txt'
Set-Content -LiteralPath $pidPath -Value $worker.Id
Write-Output 'Waiting for the voice worker and ASR model. First startup can download the model.'
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
    if ($worker.HasExited) { throw 'Voice worker exited. See .runtime/logs/voice.err.log.' }
    $health = $null
    try { $health = Invoke-RestMethod 'http://127.0.0.1:5010/health' -TimeoutSec 2 } catch { }
    if ($health) {
        if ($health.service -ne 'yisheng-voice') { throw 'Port 5010 belongs to another service.' }
        if ($health.asrReady -eq $true) {
            # Windows venv can launch a child interpreter that owns the socket.
            $listener = Get-NetTCPConnection -State Listen -LocalPort 5010 | Select-Object -First 1
            Set-Content -LiteralPath $pidPath -Value $listener.OwningProcess
            Write-Output 'Voice worker ready: http://127.0.0.1:5010'
            return
        }
    }
    Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)
throw 'Voice worker did not become ready. See .runtime/logs/voice.err.log.'
