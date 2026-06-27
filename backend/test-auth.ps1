$baseUrl = "https://human-os-zitw.onrender.com"
$headers = @{ "Content-Type" = "application/json" }

Write-Host "--- TEST AUTH ---"

$email = "auth_test_$(Get-Random -Maximum 99999)@humanos.app"
$body = @{ email = $email; password = "TestPassword123!" } | ConvertTo-Json

Write-Host "1. Signup..."
$signup = Invoke-RestMethod -Uri "$baseUrl/auth/signup" -Method Post -Body $body -Headers $headers
if ($signup.access_token) { Write-Host "PASS: Signup" -ForegroundColor Green } else { Write-Host "FAIL: Signup" -ForegroundColor Red }

Write-Host "2. Login..."
$login = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $body -Headers $headers
if ($login.access_token) { Write-Host "PASS: Login" -ForegroundColor Green } else { Write-Host "FAIL: Login" -ForegroundColor Red }

Write-Host "3. Refresh Token..."
$refreshBody = @{ refresh_token = $login.refresh_token } | ConvertTo-Json
$refresh = Invoke-RestMethod -Uri "$baseUrl/auth/refresh" -Method Post -Body $refreshBody -Headers $headers
if ($refresh.access_token) { Write-Host "PASS: Refresh" -ForegroundColor Green } else { Write-Host "FAIL: Refresh" -ForegroundColor Red }
