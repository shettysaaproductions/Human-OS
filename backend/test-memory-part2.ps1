$baseUrl = "http://localhost:3000/chat/test"
$headers = @{ "Content-Type" = "application/json" }

function Test-Chat {
    param([string]$message)
    Write-Host "USER: $message" -ForegroundColor Cyan
    $body = @{ message = $message } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri $baseUrl -Method Post -Body $body -Headers $headers
    Write-Host "NOVA: $($response.reply)" -ForegroundColor Green
    Write-Host "META: $($response.meta | ConvertTo-Json -Compress)" -ForegroundColor DarkGray
    Write-Host ""
    
    # Wait 15 seconds to respect NVIDIA rate limits
    Start-Sleep -Seconds 15
}

Write-Host "================ TEST 4 ================"
Test-Chat "I hate coffee."
Test-Chat "Suggest a drink."

Write-Host "================ TEST 5 (Memory Correction) ================"
Test-Chat "I love rap."
Test-Chat "Actually I mostly listen to jazz now."
Test-Chat "Recommend music."

Write-Host "================ TEST 6 (Tired) ================"
Test-Chat "I'm tired today."

Write-Host "================ TEST 7 (Hungry) ================"
Test-Chat "I'm hungry."

Write-Host "================ TEST 8 (Diabetes) ================"
Test-Chat "I have diabetes."

Write-Host "================ TEST 9 (Meeting Unrelated) ================"
Test-Chat "I have a meeting tomorrow."

Write-Host "================ TEST 10 (Dog Name) ================"
Test-Chat "I have a dog named Bruno."
Test-Chat "Actually his name is Max."
Test-Chat "What's my dog's name?"

Write-Host "================ TEST 11 (No Pollution) ================"
Invoke-RestMethod -Uri "http://localhost:3000/memory/debug" -Method Delete | Out-Null
Start-Sleep -Seconds 2
Test-Chat "Good morning."
Test-Chat "How are you?"
Test-Chat "Haha"
Test-Chat "Thanks."

$finalStats = Invoke-RestMethod -Uri "http://localhost:3000/memory/debug/stats" -Method Get
Write-Host "FINAL MEMORY COUNT FOR TEST 11: $($finalStats.total_memories)" -ForegroundColor Yellow
