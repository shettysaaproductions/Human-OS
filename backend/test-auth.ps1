$baseUrl = "http://localhost:3000"
$headers = @{ "Content-Type" = "application/json" }

function Create-User {
    param([string]$email, [string]$password)
    Write-Host "Signing up $email..."
    $body = @{ email = $email; password = $password } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$baseUrl/auth/signup" -Method Post -Body $body -Headers $headers -ErrorAction SilentlyContinue
    if ($null -eq $response) {
        # Might already exist, try login
        $response = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $body -Headers $headers
    }
    return $response.access_token
}

function Test-Chat {
    param([string]$token, [string]$message, [string]$userLabel)
    Write-Host "USER $($userLabel): $message" -ForegroundColor Cyan
    $authHeaders = @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $token"
    }
    $body = @{ message = $message } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$baseUrl/chat/test" -Method Post -Body $body -Headers $authHeaders
    Write-Host "NOVA: $($response.reply)" -ForegroundColor Green
    Write-Host "META: $($response.meta | ConvertTo-Json -Compress)" -ForegroundColor DarkGray
    Write-Host ""
    # Sleep to respect rate limits and background processing
    Start-Sleep -Seconds 15
}

function Clear-Memories {
    param([string]$token)
    $authHeaders = @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $token"
    }
    Invoke-RestMethod -Uri "$baseUrl/memory/debug" -Method Delete -Headers $authHeaders | Out-Null
    Start-Sleep -Seconds 2
}

# Setup users
$tokenA = Create-User "userA@humanos.app" "password123"
$tokenB = Create-User "userB@humanos.app" "password123"

Clear-Memories $tokenA
Clear-Memories $tokenB

Write-Host "================ TEST 1 & 2 ================"
Test-Chat $tokenA "I love rap." "A"
Test-Chat $tokenB "What should I listen to?" "B"
Test-Chat $tokenA "What should I listen to?" "A"

Write-Host "================ TEST 3 ================"
Test-Chat $tokenA "My wife is pregnant." "A"
Test-Chat $tokenB "I'm stressed." "B"

Write-Host "================ TEST 4 ================"
Write-Host "Testing Unauthorized Request..."
try {
    Invoke-RestMethod -Uri "$baseUrl/auth/me" -Method Get -Headers $headers
    Write-Host "FAIL: Expected 401 Unauthorized" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode -eq "Unauthorized") {
        Write-Host "PASS: Received 401 Unauthorized" -ForegroundColor Green
    } else {
        Write-Host "FAIL: Received unexpected error: $($_.Exception.Message)" -ForegroundColor Red
    }
}
Write-Host ""

Write-Host "================ TEST 5 ================"
Clear-Memories $tokenA
Clear-Memories $tokenB

Test-Chat $tokenA "I love rap." "A"
Test-Chat $tokenB "I hate rap." "B"
Test-Chat $tokenA "Recommend music." "A"
Test-Chat $tokenB "Recommend music." "B"
