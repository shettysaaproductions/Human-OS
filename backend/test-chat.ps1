$baseUrl = "https://human-os-zitw.onrender.com"
$headers = @{ "Content-Type" = "application/json" }

$email = "chat_test_$(Get-Random -Maximum 99999)@humanos.app"
$body = @{ email = $email; password = "TestPassword123!" } | ConvertTo-Json
$signup = Invoke-RestMethod -Uri "$baseUrl/auth/signup" -Method Post -Body $body -Headers $headers
$token = $signup.access_token

$authHeaders = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer $token" }

# Finish Onboarding
$onboardBody = @{ preferred_name="Tester"; passions="Testing"; goals="To test"; family="None"; important_facts="I am a bot" } | ConvertTo-Json
Invoke-RestMethod -Uri "$baseUrl/onboarding" -Method Post -Body $onboardBody -Headers $authHeaders | Out-Null

Write-Host "--- TEST CHAT PIPELINE ---"

# Message 1
$msg1Body = @{ message = "My son's name is Aarav." } | ConvertTo-Json
Write-Host "User: My son's name is Aarav."
$resp1 = Invoke-RestMethod -Uri "$baseUrl/chat" -Method Post -Body $msg1Body -Headers $authHeaders
Write-Host "Nova: $($resp1.reply)" -ForegroundColor Cyan
$convId = $resp1.conversation_id

Start-Sleep -Seconds 10 # Wait for background extraction

# Message 2
$msg2Body = @{ message = "He is 5 months old."; conversation_id = $convId } | ConvertTo-Json
Write-Host "User: He is 5 months old."
$resp2 = Invoke-RestMethod -Uri "$baseUrl/chat" -Method Post -Body $msg2Body -Headers $authHeaders
Write-Host "Nova: $($resp2.reply)" -ForegroundColor Cyan

Start-Sleep -Seconds 10

# Message 3
$msg3Body = @{ message = "What did I tell you?"; conversation_id = $convId } | ConvertTo-Json
Write-Host "User: What did I tell you?"
$resp3 = Invoke-RestMethod -Uri "$baseUrl/chat" -Method Post -Body $msg3Body -Headers $authHeaders
Write-Host "Nova: $($resp3.reply)" -ForegroundColor Cyan

Write-Host "`n--- GET HISTORY ---"
$history = Invoke-RestMethod -Uri "$baseUrl/chat?conversation_id=$convId" -Method Get -Headers $authHeaders
Write-Host "Returned $($history.Length) messages from history." -ForegroundColor Green
