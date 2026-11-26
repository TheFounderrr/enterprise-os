param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('Start','Stop')]
    [string] $Action
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$local = Join-Path $root '.local'
$statePath = Join-Path $local 'enterprise-os-processes.json'
$pgctl = Join-Path $local 'package\native\bin\pg_ctl.exe'
$pgdata = Join-Path $local 'pgdata'
$frontend = Join-Path $root 'frontend'
$backend = Join-Path $root 'backend'
$python = Join-Path $root '.venv\Scripts\python.exe'
$frontendUrl = 'http://localhost:3000'
$webHealthBase = 'http://127.0.0.1:3000'
$apiHealth = 'http://127.0.0.1:8000/api/health/ready'

function ProcessRecord($process) {
    @{ id = $process.Id; started = [string]$process.StartTime.ToUniversalTime().Ticks }
}
function OwnedProcess($entry) {
    if ($null -eq $entry) { return }
    $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if ($process -and [string]$process.StartTime.ToUniversalTime().Ticks -eq $entry.started) {
        return $process
    }
}
function SaveState {
    [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json -Compress))
}
function PgStatus {
    & $pgctl -D $pgdata status *> $null
    return $LASTEXITCODE
}
function StopOwned {
    foreach ($key in @('frontend','backend')) {
        $process = OwnedProcess $state[$key]
        if ($process) {
            # Next.js may have spawned a worker. Match the recorded parent before stopping its tree.
            # Hidden Windows console processes do not have a window to close.
            # Terminate the recorded tree so neither the venv redirector nor Next leaves a listener.
            try { & taskkill.exe /PID $process.Id /T /F *> $null } catch {
                if (OwnedProcess $state[$key]) { throw }
            }
            if (!$process.WaitForExit(5000)) { throw "Could not stop Enterprise OS $key." }
        }
        $state[$key] = $null
        SaveState
    }
    $postgres = OwnedProcess $state.pg
    $pidFile = Join-Path $pgdata 'postmaster.pid'
    if ($postgres -and (Test-Path -LiteralPath $pidFile) -and
        (Get-Content -LiteralPath $pidFile -TotalCount 1) -eq [string]$postgres.Id) {
        & $pgctl -D $pgdata -m fast -w stop
        if ($LASTEXITCODE) { throw "Could not stop Enterprise OS PostgreSQL." }
    }
    $state.pg = $null
    SaveState
}
function HttpReady([string]$url) {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch { return $false }
}
function WaitForHttp([string]$url, $entry, [string]$label) {
    $deadline = (Get-Date).AddSeconds(90)
    do {
        if (!(OwnedProcess $entry)) { throw "$label exited. Check .local\logs\$label.err.log." }
        if (HttpReady $url) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "$label timed out. Check .local\logs\$label.err.log."
}
function PortInUse([int]$port) {
    $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    return [bool]($listeners | Where-Object { $_.Port -eq $port } | Select-Object -First 1)
}
function OpenApp {
    Write-Host "Enterprise OS is ready at $frontendUrl"
    if ($env:ENTERPRISE_OS_NO_BROWSER -ne '1') { Start-Process $frontendUrl }
}

New-Item -ItemType Directory -Force $local | Out-Null
$lock = $null
$state = @{ backend = $null; frontend = $null; pg = $null }
$ownsAttempt = $false
try {
    try {
        $lock = [IO.File]::Open((Join-Path $local 'enterprise-os.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch { throw 'Another Enterprise OS start or stop is in progress.' }

    if (Test-Path -LiteralPath $statePath) {
        $existing = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
        foreach ($key in @('backend','frontend','pg')) { $state[$key] = $existing.$key }
    }
    if ($Action -eq 'Stop') {
        StopOwned
        Write-Host 'Enterprise OS processes stopped. Independently started services were preserved.'
        exit 0
    }
    if ((OwnedProcess $state.frontend) -and (OwnedProcess $state.backend) -and
        (HttpReady "$webHealthBase/api/health") -and (HttpReady $webHealthBase)) {
        OpenApp
        exit 0
    }

    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $next = Join-Path $frontend 'node_modules\next\dist\bin\next'
    foreach ($dependency in @($python,$next,$pgctl,$pgdata,(Join-Path $root '.env'))) {
        if (!(Test-Path -LiteralPath $dependency)) { throw "Required file or directory missing: $dependency. See README.md." }
    }
    & $python --version
    if ($LASTEXITCODE) { throw 'The project Python environment could not start.' }
    & $node --version
    if ($LASTEXITCODE) { throw 'Node.js could not start.' }

    if (($state.frontend -or $state.backend) -and ((OwnedProcess $state.frontend) -or (OwnedProcess $state.backend))) {
        throw 'A recorded Enterprise OS process is unhealthy. Run stop_enterprise_os.bat before retrying.'
    }
    foreach ($port in @(3000,8000)) {
        if (PortInUse $port) { throw "Port $port is used by another process. Free that port and try again." }
    }

    Push-Location $backend
    try {
        & $python -m app.startup_check --config
        if ($LASTEXITCODE) { throw 'Database settings are invalid. See the preceding error.' }
    } finally { Pop-Location }

    $pgStatus = PgStatus
    if ($pgStatus -eq 3) {
        $ownsAttempt = $true
        & $pgctl -D $pgdata -l (Join-Path $local 'postgres.log') -o '-h 127.0.0.1 -p 55432' -w start
        if ($LASTEXITCODE) { throw 'PostgreSQL failed to start. Check .local\postgres.log.' }
        $pgId = Get-Content -LiteralPath (Join-Path $pgdata 'postmaster.pid') -TotalCount 1
        $state.pg = ProcessRecord (Get-Process -Id ([int]$pgId))
        SaveState
    } elseif ($pgStatus -ne 0) {
        throw 'Could not determine the local PostgreSQL status. Check .local\pgdata.'
    }

    Push-Location $backend
    try {
        & $python -m app.startup_check
        if ($LASTEXITCODE) { throw 'PostgreSQL or schema check failed. See the preceding error.' }
    } finally { Pop-Location }

    $ownsAttempt = $true
    $logs = Join-Path $local 'logs'
    New-Item -ItemType Directory -Force $logs | Out-Null
    $env:BACKEND_URL = 'http://127.0.0.1:8000'
    $api = Start-Process -FilePath $python -ArgumentList '-m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log' -WorkingDirectory $backend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'backend.out.log') -RedirectStandardError (Join-Path $logs 'backend.err.log') -PassThru
    $state.backend = ProcessRecord $api
    SaveState
    WaitForHttp $apiHealth $state.backend 'backend'
    $nextCommand = if (Test-Path -LiteralPath (Join-Path $frontend '.next\BUILD_ID')) { 'start' } else { 'dev' }
    $web = Start-Process -FilePath $node -ArgumentList ('"{0}" {1} --hostname 127.0.0.1 --port 3000' -f $next,$nextCommand) -WorkingDirectory $frontend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'frontend.out.log') -RedirectStandardError (Join-Path $logs 'frontend.err.log') -PassThru
    $state.frontend = ProcessRecord $web
    SaveState
    WaitForHttp $webHealthBase $state.frontend 'frontend'
    WaitForHttp "$webHealthBase/api/health" $state.frontend 'frontend'
    OpenApp
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    if ($ownsAttempt) {
        try { StopOwned } catch { [Console]::Error.WriteLine($_.Exception.Message) }
    }
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
}
