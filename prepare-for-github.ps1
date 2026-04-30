# PowerShell script to prepare AgroCloud project for GitHub upload
# Monorepo layout: frontend/ + backend/

Write-Host "Preparing AgroCloud project for GitHub..." -ForegroundColor Green

$cleanDir = "AgroCloud-GitHub-Ready"
if (Test-Path $cleanDir) {
    Remove-Item $cleanDir -Recurse -Force
}
New-Item -ItemType Directory -Path $cleanDir | Out-Null

Write-Host "Created clean directory: $cleanDir" -ForegroundColor Yellow

$filesToCopy = @(
    "frontend",
    "backend",
    ".github",
    ".vscode",
    "docs",
    "analysis_engine",
    "package.json",
    "package-lock.json",
    "README.md",
    ".gitignore",
    ".env.example",
    "docker-compose.yml",
    "Dockerfile",
    "agro.json",
    "layer.json",
    "db_migration.sql",
    "test_stac.js",
    "agro-structures-data-entry.html",
    "DataSource_Advanced_Layer_Technical_Docs.md"
)

foreach ($item in $filesToCopy) {
    if (Test-Path $item) {
        if (Test-Path $item -PathType Container) {
            Copy-Item $item -Destination $cleanDir -Recurse -Force
            Write-Host "Copied directory: $item" -ForegroundColor Cyan
        } else {
            Copy-Item $item -Destination $cleanDir -Force
            Write-Host "Copied file: $item" -ForegroundColor Cyan
        }
    } else {
        Write-Host "Skipped (not found): $item" -ForegroundColor Gray
    }
}

Write-Host "`nProject prepared successfully!" -ForegroundColor Green
Write-Host "Clean project is in: $cleanDir" -ForegroundColor Yellow
Write-Host "`nAfter clone: run npm install && npm run dev from repo root." -ForegroundColor White

$size = (Get-ChildItem $cleanDir -Recurse | Measure-Object -Property Length -Sum).Sum
$sizeMB = [math]::Round($size / 1MB, 2)
Write-Host "`nPrepared project size: $sizeMB MB" -ForegroundColor Green
