$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\backend')
& ..\.venv\Scripts\python.exe -m alembic upgrade head
exit $LASTEXITCODE
