# Strategic Conquest - Cursor Project Launcher
# Launches Cursor with Claude Code extension interface

$ProjectPath = $PSScriptRoot
$SessionFile = Join-Path $ProjectPath ".vscode-session"

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "   Strategic Conquest - Cursor Launcher" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check if a prior session exists
$hasPriorSession = Test-Path $SessionFile
if ($hasPriorSession) {
    $sessionInfo = Get-Content $SessionFile | ConvertFrom-Json
    $sessionDate = $sessionInfo.lastOpened
    Write-Host "Prior session found: $sessionDate" -ForegroundColor Yellow
    Write-Host ""
    $response = Read-Host "Resume from prior session? (Y/n)"
    $resume = ($response -eq "" -or $response -match "^[Yy]")
} else {
    Write-Host "No prior session found. Starting fresh." -ForegroundColor Gray
    $resume = $false
}

# Update session file
$sessionData = @{
    lastOpened = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    resumed    = $resume
} | ConvertTo-Json
Set-Content -Path $SessionFile -Value $sessionData

# Resolve Cursor executable
$cursorPaths = @(
    "$env:LOCALAPPDATA\Programs\cursor\Cursor.exe",
    "$env:APPDATA\Local\Programs\cursor\Cursor.exe",
    "C:\Program Files\Cursor\Cursor.exe",
    "cursor"   # fallback if on PATH
)

$cursorExe = $null
foreach ($path in $cursorPaths) {
    if ($path -eq "cursor") {
        if (Get-Command cursor -ErrorAction SilentlyContinue) {
            $cursorExe = "cursor"
            break
        }
    } elseif (Test-Path $path) {
        $cursorExe = $path
        break
    }
}

if (-not $cursorExe) {
    Write-Host "ERROR: Cursor not found. Please ensure Cursor is installed." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
if ($resume) {
    Write-Host "Resuming session..." -ForegroundColor Green
} else {
    Write-Host "Opening project..." -ForegroundColor Green
}
Write-Host ""
Write-Host "Tip: Use the Claude Code panel (extension icon in sidebar) to chat." -ForegroundColor DarkGray
Write-Host ""

# Set Claude Code model
$env:ANTHROPIC_MODEL = "claude-opus-4-6"

# Launch Cursor
if ($cursorExe -eq "cursor") {
    Start-Process -FilePath "cursor" -ArgumentList "`"$ProjectPath`""
} else {
    Start-Process -FilePath $cursorExe -ArgumentList "`"$ProjectPath`""
}
