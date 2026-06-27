$baseUrl = "https://human-os-zitw.onrender.com"
$headers = @{ "Content-Type" = "application/json" }

$email = "diag_test_$(Get-Random -Maximum 99999)@humanos.app"
$body = @{ email = $email; password = "TestPassword123!" } | ConvertTo-Json
$signup = Invoke-RestMethod -Uri "$baseUrl/auth/signup" -Method Post -Body $body -Headers $headers
$token = $signup.access_token
$authHeaders = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer $token" }

Write-Host "--- TEST DIAGNOSTICS ROUTE ---"

try {
    $diag = Invoke-RestMethod -Uri "$baseUrl/admin/diagnostics" -Method Get -Headers $authHeaders
    Write-Host "PASS: Diagnostics fetched successfully" -ForegroundColor Green
    Write-Output $diag | ConvertTo-Json
} catch {
    Write-Host "FAIL: Failed to fetch diagnostics: $_" -ForegroundColor Red
}

Write-Host "--- TEST DIAGNOSTICS AUTHENTICATION ---"
try {
    Invoke-RestMethod -Uri "$baseUrl/admin/diagnostics" -Method Get -Headers $headers
    Write-Host "FAIL: Expected 401 Unauthorized but succeeded." -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode -eq "Unauthorized") {
        Write-Host "PASS: Diagnostics route is properly secured (401 Unauthorized)." -ForegroundColor Green
    } else {
        Write-Host "FAIL: Unexpected error: $_" -ForegroundColor Red
    }
}
