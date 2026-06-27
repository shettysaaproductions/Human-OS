$baseUrl = "https://human-os-zitw.onrender.com"
$headers = @{ "Content-Type" = "application/json" }

$email = "mem_test_$(Get-Random -Maximum 99999)@humanos.app"
$body = @{ email = $email; password = "TestPassword123!" } | ConvertTo-Json
$signup = Invoke-RestMethod -Uri "$baseUrl/auth/signup" -Method Post -Body $body -Headers $headers
$token = $signup.access_token
$authHeaders = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer $token" }

# Finish Onboarding
$onboardBody = @{ preferred_name="Tester"; passions="Testing"; goals="To test"; family="None"; important_facts="I am a bot" } | ConvertTo-Json
Invoke-RestMethod -Uri "$baseUrl/onboarding" -Method Post -Body $onboardBody -Headers $authHeaders | Out-Null

Write-Host "--- TEST LONG-TERM MEMORY ---"

# Message 1
$msg1Body = @{ message = "I am a rapper." } | ConvertTo-Json
Write-Host "User: I am a rapper."
$resp1 = Invoke-RestMethod -Uri "$baseUrl/chat" -Method Post -Body $msg1Body -Headers $authHeaders
$convId = $resp1.conversation_id
Start-Sleep -Seconds 15 # Wait for DB upsert

# Message 2
$msg2Body = @{ message = "I own Shetty Productions."; conversation_id = $convId } | ConvertTo-Json
Write-Host "User: I own Shetty Productions."
Invoke-RestMethod -Uri "$baseUrl/chat" -Method Post -Body $msg2Body -Headers $authHeaders | Out-Null
Start-Sleep -Seconds 15

# Message 3
$msg3Body = @{ message = "What do you know about me?"; conversation_id = $convId } | ConvertTo-Json
Write-Host "User: What do you know about me?"
$resp3 = Invoke-RestMethod -Uri "$baseUrl/chat" -Method Post -Body $msg3Body -Headers $authHeaders
Write-Host "Nova: $($resp3.reply)" -ForegroundColor Cyan
Write-Host "Meta: $($resp3.meta | ConvertTo-Json -Compress)" -ForegroundColor Green
