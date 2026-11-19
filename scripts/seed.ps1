$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\backend')
& ..\.venv\Scripts\python.exe -m app.seed
exit $LASTEXITCODE
