$baseUrl = "http://localhost:3000/chat/test"
$headers = @{ "Content-Type" = "application/json" }
$supabaseUrl = "https://infkwyzomszyxtctewds.supabase.co/rest/v1/memories"
$apiKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluZmt3eXpvbXN6eXh0Y3Rld2RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NjY5ODUsImV4cCI6MjA5ODA0Mjk4NX0.St8FKy28EnxG3DdCnbNxnK1RW3hsByd_C9ZyXDMsagk"
$dbHeaders = @{
    "apikey" = $apiKey
    "Authorization" = "Bearer $apiKey"
    "Content-Type" = "application/json"
    "Prefer" = "return=minimal"
}
$userId = "00000000-0000-0000-0000-000000000001"

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
                user_id = $userId
                memory_type = "fact"
                key = "fake_key_$([guid]::NewGuid().ToString().Substring(0,8))"
                value = "fake_value_$([guid]::NewGuid().ToString().Substring(0,8))"
                importance = Get-Random -Minimum 1 -Maximum 5
                confidence = 0.5
            }
        }
        $json = $payload | ConvertTo-Json -Depth 5
        Invoke-RestMethod -Uri $supabaseUrl -Method Post -Headers $dbHeaders -Body $json | Out-Null
        $inserted += $toInsert
        Write-Host "Inserted $inserted / $count"
    }
}

function Test-Retrieval {
    param([string]$label)
    Write-Host "--- Benchmarking: $label ---" -ForegroundColor Cyan
    
    # We will test retrieval with a very specific memory inserted
    $targetMemory = @{
        user_id = $userId
        memory_type = "preference"
        key = "favorite_fruit"
        value = "mango"
        importance = 10
        confidence = 1.0
    }
    Invoke-RestMethod -Uri $supabaseUrl -Method Post -Headers $dbHeaders -Body ($targetMemory | ConvertTo-Json) | Out-Null
    Start-Sleep -Seconds 1

    $sw = [Diagnostics.Stopwatch]::StartNew()
    $body = @{ message = "I'm hungry, what fruit should I eat?" } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri $baseUrl -Method Post -Body $body -Headers $headers
    $sw.Stop()
    
    Write-Host "Latency: $($sw.ElapsedMilliseconds)ms"
    Write-Host "Memories Retrieved: $($response.meta.memories_retrieved)"
    Write-Host "Response: $($response.reply)"
    
    if ($response.meta.memories_retrieved -gt 3) {
        Write-Host "FAIL: Exceeded max 3 memories injected." -ForegroundColor Red
    } else {
        Write-Host "PASS: Injected max 3 memories." -ForegroundColor Green
    }
    
    if ($response.reply -match "mango") {
        Write-Host "PASS: Successfully retrieved and used the target memory (mango)." -ForegroundColor Green
    } else {
        Write-Host "FAIL: Did not use target memory." -ForegroundColor Red
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
