$baseUrl = "http://localhost:3000"
$headers = @{ "Content-Type" = "application/json" }

function Create-User {
    param([string]$email, [string]$password)
    Write-Host "Signing up $email..."
    $body = @{ email = $email; password = $password } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$baseUrl/auth/signup" -Method Post -Body $body -Headers $headers -ErrorAction SilentlyContinue
    if ($null -eq $response) {
        $response = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $body -Headers $headers
    }
    return $response.access_token
}

function Test-Onboarding {
    param([string]$token)
    Write-Host "Starting Onboarding..." -ForegroundColor Cyan
    $authHeaders = @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $token"
    }
    
    $body = @{
        preferred_name = "Alex"
        passions = "I love woodworking and reading sci-fi novels."
        goals = "I want to be a better father."
        family = "I am a single dad with a 4-year-old daughter."
        important_facts = "I am allergic to peanuts."
        companion_personality = "A great listener who is highly empathetic and warm."
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$baseUrl/onboarding" -Method Post -Body $body -Headers $authHeaders
    Write-Host "Onboarding Response: $($response | ConvertTo-Json -Compress)" -ForegroundColor Green
    
    # Check status
    $status = Invoke-RestMethod -Uri "$baseUrl/onboarding/status" -Method Get -Headers $authHeaders
    Write-Host "Status: completed=$($status.onboarding_completed), name=$($status.preferred_name), personality=$($status.companion_personality)" -ForegroundColor Green
    Write-Host ""
}

function Test-Chat {
    param([string]$token, [string]$message)
    Write-Host "USER: $message" -ForegroundColor Cyan
    $authHeaders = @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $token"
    }
    $body = @{ message = $message } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$baseUrl/chat/test" -Method Post -Body $body -Headers $authHeaders
    Write-Host "NOVA: $($response.reply)" -ForegroundColor Green
    Write-Host "META: $($response.meta | ConvertTo-Json -Compress)" -ForegroundColor DarkGray
    Write-Host ""
}

# Setup user
$randomNum = Get-Random -Maximum 9999
$email = "onboarding_test_$randomNum@humanos.app"
$token = Create-User $email "password123"

if ($null -eq $token) {
    Write-Host "Failed to create user. Probably hit Supabase email rate limits." -ForegroundColor Red
    exit 1
}

Write-Host "================ ONBOARDING TEST ================"
Test-Onboarding $token

Write-Host "================ CHAT TEST ================"
Test-Chat $token "I'm overwhelmed."
