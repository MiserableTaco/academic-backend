#!/usr/bin/env zsh

echo "🔐 AcadCert Security Test Suite"
echo "================================"

# Test 1: Rate Limiting
echo ""
echo "Test 1: Rate Limiting (sending 6 OTP requests)..."
for i in {1..6}; do
  response=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/auth/request-otp \
    -H "Content-Type: application/json" \
    -d '{"email":"student.test@dummy.edu"}')
  http_status=$(echo "$response" | tail -n 1)
  if [[ "$i" -eq 6 && "$http_status" -eq 429 ]]; then
    echo "✅ Rate limiting works (got 429 on request 6)"
  elif [[ "$i" -lt 6 && "$http_status" -eq 200 ]]; then
    echo "✅ Request $i passed"
  else
    echo "❌ Unexpected status: $http_status on request $i"
  fi
  sleep 2
done

# Test 2: CSRF Token endpoint
echo ""
echo "Test 2: CSRF Token Endpoint..."
csrf_response=$(curl -s -b cookie.txt -c cookie.txt http://localhost:3000/api/csrf-token)
if echo "$csrf_response" | grep -q "csrfToken"; then
  echo "✅ CSRF token endpoint works"
else
  echo "❌ CSRF token endpoint failed"
fi

# Test 3: Health Check
echo ""
echo "Test 3: Health Check..."
health=$(curl -s http://localhost:3000/health)
if echo "$health" | grep -q "ok"; then
  echo "✅ Health check works"
else
  echo "❌ Health check failed"
fi

echo ""
echo "🎯 Automated tests complete!"
echo "⚠️  Manual tests still needed: Frontend flows, PDF upload, document verification"
