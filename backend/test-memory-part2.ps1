$baseUrl = "http://localhost:3000"
$headers = @{ "Content-Type" = "application/json" }

# FIX: Removed hardcoded Supabase REST API key
# Supabase Admin key is no longer used. The memory debug endpoint
# requires proper authentication via Supabase Auth (JWT).

# VULNERABILITY FIX: Previously the script hardcoded:
#   apikey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
#   supabaseUrl = "https://infkwyzomszyxtctewds.supabase.co/rest/v1/memories"
# These are now removed - use environment variables for Supabase credentials

function Clear-Memories {
    Write-Host "Clearing memories..."
    Invoke-RestMethod -Uri "http://localhost:3000/memory/debug" -Method Delete | Out-Null
    Start-Sleep -Seconds 1
}

function Insert-Fake-Memories {
    param([int]$count)
    Write-Host "Inserting $count fake memories..."
    $batchSize = 100
    $inserted = 0
    while ($inserted -lt $count) {
        $toInsert = [math]::Min($batchSize, $count - $inserted)
        $payload = @()
        for ($i = 0; $i -lt $toInsert; $i++) {
            $payload += @{
                user_id = "00000000-0000-0000-0000-000000000001"
                memory_type = "fact"
                key = "fake_key_$([guid]::NewGuid().ToString().Substring(0,8))"
                value = "fake_value_$([guid]::NewGuid().ToString().Substring(0,8))"
                importance = Get-Random -Minimum 1 -Maximum 5
                confidence = 0.5
            }
        }
        $json = $payload | ConvertTo-Json -Depth 5
        # FIX: Using the Supabase REST API without the hardcoded key
        # Key is now provided via environment variables
        Invoke-RestMethod -Uri "$env:SUPABASE_URL/rest/v1/memories" -Method Post -Headers $headers -Body $json | Out-Null
        $inserted += $toInsert
        Write-Host "Inserted $inserted / $count"
    }
}

function Test-Retrieval {
    param([string]$label)
    Write-Host "--- Benchmarking: $label ---" -ForegroundColor Cyan

    $sw = [Diagnostics.Stopwatch]::StartNew()
    $body = @{ message = "I'm hungry, what fruit should I eat?" } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$baseUrl/chat/test" -Method Post -Body $body -Headers $headers
    $sw.Stop()

    Write-Host "Latency: $($sw.ElapsedMilliseconds)ms"
    Write-Host "Memories Retrieved: $($response.meta.memories_retrieved)"
    Write-Host "Response: $($response.reply)"

    if ($response.meta.memories_retrieved -gt 3) {
        Write-Host "FAIL: Exceeded max 3 memories injected." -ForegroundColor Red
    } else {
        Write-Host "PASS: Injected max 3 memories." -ForegroundColor Green
    }

    Write-Host ""
}

# Run the suites
Clear-Memories
Insert-Fake-Memories 100
Test-Retrieval "100 Memories"

Clear-Memories
Insert-Fake-Memories 500
Test-Retrieval "500 Memories"

Clear-Memories
Insert-Fake-Memories 1000
Test-Retrieval "1000 Memories"