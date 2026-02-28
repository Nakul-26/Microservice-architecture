Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
  [string]$GatewayBaseUrl = "http://localhost:3000",
  [int]$FailureThreshold = 5,
  [int]$OpenMs = 30000,
  [string]$LoginEmail = "demo@example.com",
  [string]$LoginPassword = "demo-password"
)

function Invoke-LoginRequest {
  param(
    [string]$BaseUrl,
    [string]$Email,
    [string]$Password
  )

  $uri = "$BaseUrl/users/login"
  $body = @{
    email = $Email
    password = $Password
  } | ConvertTo-Json

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $uri -ContentType "application/json" -Body $body -TimeoutSec 8
    return [PSCustomObject]@{
      StatusCode = [int]$response.StatusCode
      Body = $response.Content
    }
  } catch {
    $statusCode = 0
    $errorBody = $_.Exception.Message

    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $errorBody = $_.ErrorDetails.Message
    }

    return [PSCustomObject]@{
      StatusCode = $statusCode
      Body = $errorBody
    }
  }
}

Write-Host "Step 1/4: Stopping user_service..."
docker compose stop user_service | Out-Host

Write-Host "Step 2/4: Sending requests through gateway until circuit opens..."
$attempts = $FailureThreshold + 3
$opened = $false

for ($i = 1; $i -le $attempts; $i++) {
  $result = Invoke-LoginRequest -BaseUrl $GatewayBaseUrl -Email $LoginEmail -Password $LoginPassword
  Write-Host ("  Attempt {0}: status={1}" -f $i, $result.StatusCode)

  if ($result.StatusCode -eq 503 -and $result.Body -like "*CIRCUIT_OPEN*") {
    Write-Host "  Circuit breaker is OPEN."
    $opened = $true
    break
  }

  Start-Sleep -Milliseconds 300
}

if (-not $opened) {
  Write-Warning "Circuit breaker did not open in expected attempts. Check gateway env values."
}

Write-Host "Step 3/4: Starting user_service..."
docker compose start user_service | Out-Host

$waitMs = $OpenMs + 2000
Write-Host ("Waiting {0}ms for open window to pass..." -f $waitMs)
Start-Sleep -Milliseconds $waitMs

Write-Host "Step 4/4: Sending recovery probe request..."
$recovery = Invoke-LoginRequest -BaseUrl $GatewayBaseUrl -Email $LoginEmail -Password $LoginPassword
Write-Host ("Recovery status={0}" -f $recovery.StatusCode)
Write-Host "Expected: 401 (invalid credentials) if service is reachable and circuit closed."
Write-Host "If still 503 CIRCUIT_OPEN, wait a little longer and retry."
