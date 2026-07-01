$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$desktop = "C:\Users\HP-3\Desktop\HumanOS_Migration"
$report = "$desktop\MIGRATION_REPORT.txt"

if (Test-Path $desktop) {
    Remove-Item -Path $desktop -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $desktop | Out-Null
Set-Content -Path $report -Value "Human OS Migration Report`n=======================`n"

$items = @(
    "C:\Users\HP-3\Documents\Human Os\backend\.env",
    "C:\Users\HP-3\Documents\Human Os\mobile\.env",
    "C:\Users\HP-3\.gemini",
    "C:\Users\HP-3\.gitconfig",
    "C:\Users\HP-3\.ssh",
    "C:\Users\HP-3\.supabase"
)

foreach ($item in $items) {
    if (Test-Path $item) {
        Add-Content -Path $report -Value "FOUND: $item"
        $itemName = Split-Path $item -Leaf
        $destPath = Join-Path $desktop $itemName
        
        if ($item -match "backend\\\.env") {
            $destDir = Join-Path $desktop "backend"
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
            Copy-Item -Path $item -Destination "$destDir\.env" -Force
        } elseif ($item -match "mobile\\\.env") {
            $destDir = Join-Path $desktop "mobile"
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
            Copy-Item -Path $item -Destination "$destDir\.env" -Force
        } else {
            if (Test-Path -PathType Container $item) {
                # Use robocopy for fast directory copying
                robocopy $item $destPath /E /njh /njs /ndl /nc /ns
            } else {
                Copy-Item -Path $item -Destination $destPath -Force
            }
        }
    } else {
        Add-Content -Path $report -Value "MISSING: $item"
    }
}

# Explicitly search for debug.keystore in .android instead of copying the whole thing
$androidPath = "C:\Users\HP-3\.android"
$keystoreFound = $false
if (Test-Path $androidPath) {
    $keystores = Get-ChildItem -Path $androidPath -Filter "debug.keystore" -Recurse -ErrorAction SilentlyContinue
    foreach ($ks in $keystores) {
        $keystoreFound = $true
        Add-Content -Path $report -Value "FOUND KEYSTORE: $($ks.FullName)"
        $destDir = Join-Path $desktop ".android"
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
        Copy-Item -Path $ks.FullName -Destination $destDir -Force
    }
}
if (-not $keystoreFound) {
    Add-Content -Path $report -Value "MISSING: Android debug.keystore in $androidPath"
}

$zipPath = "C:\Users\HP-3\Desktop\HumanOS_Migration.zip"
if (Test-Path $zipPath) {
    Remove-Item -Path $zipPath -Force
}

Write-Output "Compressing archive (using Fastest compression)..."
[System.IO.Compression.ZipFile]::CreateFromDirectory($desktop, $zipPath, [System.IO.Compression.CompressionLevel]::Fastest, $false)
Write-Output "Migration package created successfully at: $zipPath"
