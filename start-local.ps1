param([switch]$Build)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.runtime'
$toolsRoot = Join-Path $runtimeRoot 'native-tools'
$logRoot = Join-Path $runtimeRoot 'logs'
New-Item -ItemType Directory -Force -Path $runtimeRoot,$logRoot | Out-Null

$envPath = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envPath) {
    foreach ($line in Get-Content -LiteralPath $envPath) {
        if ($line -match '^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"').Trim("'"), 'Process')
        }
    }
}
if ($env:DEEPSEEK_API_KEY -and !$env:DEEPSEEK_ENABLED) { $env:DEEPSEEK_ENABLED = 'true' }

# Per-machine mini-program configuration; no model credential is sent to the client.
$ipConfigs = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address })
$wifiConfig = $ipConfigs | Where-Object { $_.InterfaceAlias -match 'WLAN|Wi-Fi|无线' } | Select-Object -First 1
if (!$wifiConfig) { $wifiConfig = $ipConfigs | Select-Object -First 1 }
$deviceIp = if ($wifiConfig) { @($wifiConfig.IPv4Address.IPAddress)[0] } else { '' }
$deviceBase = if ($deviceIp) { "http://${deviceIp}:8080" } else { '' }
$deployment = @{ enabled=$true; forceLocal=$true; revision="native-local:$deviceIp"; devtoolsBaseUrl='http://127.0.0.1:8080'; deviceBaseUrl=$deviceBase }
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $projectRoot 'miniprogram/config/deployment.js'), ('// Generated local development endpoints; no API credentials.' + [Environment]::NewLine + 'module.exports = ' + ($deployment | ConvertTo-Json) + ';' + [Environment]::NewLine), $utf8)
$privatePath = Join-Path $projectRoot 'miniprogram/project.private.config.json'
$private = if (Test-Path -LiteralPath $privatePath) { Get-Content -LiteralPath $privatePath -Raw | ConvertFrom-Json } else { [PSCustomObject]@{ setting=[PSCustomObject]@{} } }
if (!$private.setting) { $private | Add-Member -MemberType NoteProperty -Name setting -Value ([PSCustomObject]@{}) -Force }
$private.setting | Add-Member -MemberType NoteProperty -Name urlCheck -Value $false -Force
[IO.File]::WriteAllText($privatePath, ($private | ConvertTo-Json -Depth 20), $utf8)

$javaExe = Get-ChildItem -LiteralPath (Join-Path $toolsRoot 'java') -Filter java.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Directory.Name -eq 'bin' } | Select-Object -First 1
$redisExe = Get-ChildItem -LiteralPath (Join-Path $toolsRoot 'redis') -Filter redis-server.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (!$javaExe -or !$redisExe) {
    & python (Join-Path $projectRoot 'scripts/bootstrap-local-tools.py')
    if ($LASTEXITCODE -ne 0) { throw 'Local runtime installation failed.' }
    $javaExe = Get-ChildItem -LiteralPath (Join-Path $toolsRoot 'java') -Filter java.exe -Recurse | Where-Object { $_.Directory.Name -eq 'bin' } | Select-Object -First 1
    $redisExe = Get-ChildItem -LiteralPath (Join-Path $toolsRoot 'redis') -Filter redis-server.exe -Recurse | Select-Object -First 1
}

$secretPath = Join-Path $runtimeRoot 'local-secrets.json'
if (!(Test-Path -LiteralPath $secretPath)) {
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 24
    $random.GetBytes($bytes)
    $secrets = @{ databasePassword=[Convert]::ToBase64String($bytes); redisPassword=[Guid]::NewGuid().ToString('N') }
    $secrets | ConvertTo-Json | Set-Content -LiteralPath $secretPath -Encoding UTF8
    $random.Dispose()
}
$secrets = Get-Content -LiteralPath $secretPath -Raw | ConvertFrom-Json
$env:LOCAL_DB_PASSWORD = $secrets.databasePassword
$env:LOCAL_REDIS_PASSWORD = $secrets.redisPassword
$env:LOCAL_REDIS_PORT = '6380'
$env:JAVA_HOME = $javaExe.Directory.Parent.FullName
$jarPath = Join-Path $runtimeRoot 'backend-local.jar'
if ($Build -and (Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue)) {
    throw 'Stop the running local backend with stop-local.ps1 before rebuilding.'
}

if ($Build -or !(Test-Path -LiteralPath $jarPath)) {
    $mavenExe = Get-ChildItem -LiteralPath (Join-Path $toolsRoot 'maven') -Filter mvn.cmd -Recurse | Select-Object -First 1
    $settings = Join-Path $runtimeRoot 'maven-settings.xml'
    if (!(Test-Path -LiteralPath $settings)) { $settings = Join-Path $projectRoot 'backend/settings-docker.xml' }
    & $mavenExe.FullName -s $settings "-Dmaven.repo.local=$runtimeRoot/m2" -f (Join-Path $projectRoot 'backend/pom.xml') -Plocal-native -DskipTests package -B --no-transfer-progress
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'backend/target/alzheimers-voice-assistant-backend-0.0.1-SNAPSHOT.jar') -Destination $jarPath -Force
}

$existingBackend = Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue
if ($existingBackend) {
    try {
        $status = Invoke-RestMethod 'http://127.0.0.1:8080/assistant/status' -TimeoutSec 3
        $existingHealth = Invoke-RestMethod 'http://127.0.0.1:8080/actuator/health' -TimeoutSec 3
        if ($status.service -eq 'yisheng-backend' -and $existingHealth.status -eq 'UP') { Write-Output 'Backend is already running: http://127.0.0.1:8080'; exit 0 }
    } catch { }
    throw 'Port 8080 is in use. The existing process was not stopped.'
}

$redisPort = Get-NetTCPConnection -State Listen -LocalPort 6380 -ErrorAction SilentlyContinue
$pidPath = Join-Path $runtimeRoot 'local-pids.json'
$redisId = $null
if (!$redisPort) {
    # The MSYS2 binary expects POSIX or relative paths, not Windows drive paths.
    $redisData = Join-Path $redisExe.Directory.FullName 'data'
    New-Item -ItemType Directory -Force -Path $redisData | Out-Null
    $redisConfig = Join-Path $redisExe.Directory.FullName 'redis-local.conf'
    @("bind 127.0.0.1", "port 6380", "protected-mode yes", "maxclients 1024", "requirepass $($secrets.redisPassword)", "dir ./data", "appendonly yes", "save 300 10", "loglevel notice") | Set-Content -LiteralPath $redisConfig -Encoding ASCII
    $redis = Start-Process -FilePath $redisExe.FullName -ArgumentList @('redis-local.conf') -WorkingDirectory $redisExe.Directory.FullName -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'redis.out.log') -RedirectStandardError (Join-Path $logRoot 'redis.err.log')
    $redisId = $redis.Id
} elseif (Test-Path -LiteralPath $pidPath) {
    $redisId = (Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json).redis
} else {
    throw 'Port 6380 is already occupied by an unmanaged service.'
}

$java = Start-Process -FilePath $javaExe.FullName -ArgumentList @('-Dfile.encoding=UTF-8','-jar',"`"$jarPath`"",'--spring.profiles.active=local-native') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'backend.out.log') -RedirectStandardError (Join-Path $logRoot 'backend.err.log')
@{ backend=$java.Id; redis=$redisId } | ConvertTo-Json | Set-Content -LiteralPath $pidPath -Encoding UTF8
for ($attempt=0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    if ($java.HasExited) { throw 'Backend exited during startup. See .runtime/logs/backend.out.log and backend.err.log.' }
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8080/actuator/health' -TimeoutSec 2
        if ($health.status -eq 'UP') { Write-Output 'Backend ready: http://127.0.0.1:8080'; exit 0 }
    } catch { }
}
throw 'Backend did not become healthy. See .runtime/logs.'
