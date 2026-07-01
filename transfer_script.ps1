$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$desktop = "C:\Users\HP-3\Desktop\HumanOS_Transfer"
$report = "$desktop\MIGRATION_REPORT.txt"
$excludes = @("cache", "logs", "history", "node_modules", "sessions", "backups", "archives", "cache*", "logs*")

if (Test-Path $desktop) {
    Remove-Item -Path $desktop -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $desktop | Out-Null
Set-Content -Path $report -Value "Human OS Transfer Report`n======================`n"

# 1. Simple files & folders
$simpleItems = @(
    [PSCustomObject]@{ Path = "C:\Users\HP-3\Documents\Human Os\backend\.env"; Dest = "backend\.env" },
    [PSCustomObject]@{ Path = "C:\Users\HP-3\Documents\Human Os\mobile\.env"; Dest = "mobile\.env" },
    [PSCustomObject]@{ Path = "C:\Users\HP-3\.gitconfig"; Dest = ".gitconfig" },
    [PSCustomObject]@{ Path = "C:\Users\HP-3\.ssh"; Dest = ".ssh" },
    [PSCustomObject]@{ Path = "C:\Users\HP-3\.supabase"; Dest = ".supabase" }
)

foreach ($item in $simpleItems) {
    if (Test-Path $item.Path) {
        Add-Content -Path $report -Value "FOUND: $($item.Path)"
        $destPath = Join-Path $desktop $item.Dest
        
        $destDir = Split-Path $destPath -Parent
        if ($destDir -and -not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        }

        if (Test-Path -PathType Container $item.Path) {
            # Use robocopy with exclusions
            $roboArgs = @($item.Path, $destPath, "/E", "/njh", "/njs", "/ndl", "/nc", "/ns", "/XD") + $excludes
            & robocopy $roboArgs
        } else {
            Copy-Item -Path $item.Path -Destination $destPath -Force
        }
    } else {
        Add-Content -Path $report -Value "MISSING: $($item.Path)"
    }
}

# 2. Gemini specifically requested items
$geminiPath = "C:\Users\HP-3\.gemini"
if (Test-Path $geminiPath) {
    $patterns = @("settings*", "config*", "mcp*", "prompts*")
    foreach ($pattern in $patterns) {
        $matches = Get-ChildItem -Path $geminiPath -Filter $pattern -ErrorAction SilentlyContinue
        foreach ($match in $matches) {
            Add-Content -Path $report -Value "FOUND GEMINI ITEM: $($match.FullName)"
            $destPath = Join-Path $desktop ".gemini\$($match.Name)"
            
            $destDir = Split-Path $destPath -Parent
            if (-not (Test-Path $destDir)) {
                New-Item -ItemType Directory -Force -Path $destDir | Out-Null
            }

            if ($match.PSIsContainer) {
                $roboArgs = @($match.FullName, $destPath, "/E", "/njh", "/njs", "/ndl", "/nc", "/ns", "/XD") + $excludes
                & robocopy $roboArgs
            } else {
                Copy-Item -Path $match.FullName -Destination $destPath -Force
            }
        }
    }
} else {
    Add-Content -Path $report -Value "MISSING: $geminiPath directory"
}

$zipPath = "C:\Users\HP-3\Desktop\HumanOS_Transfer.zip"
if (Test-Path $zipPath) {
    Remove-Item -Path $zipPath -Force
}

Write-Output "Compressing transfer archive..."
[System.IO.Compression.ZipFile]::CreateFromDirectory($desktop, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Write-Output "Transfer package created successfully at: $zipPath"
