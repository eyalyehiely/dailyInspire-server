/**
 * Script to test webhook signature verification
 * 
 * This script helps diagnose and fix the webhook signature verification issue
 * by calculating the signature with a sample payload using different secrets.
 */

require('dotenv').config();
const crypto = require('crypto');

function testWebhookSignature() {
  console.log('=== WEBHOOK SIGNATURE TEST ===');
  
  // Get the webhook secret from environment variables
  const configuredSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!configuredSecret) {
    console.error('LEMON_SQUEEZY_WEBHOOK_SECRET is not set in .env file');
    return;
  }
  
  console.log(`Current webhook secret: ${configuredSecret}`);
  console.log(`Secret length: ${configuredSecret.length}`);
  
  // Sample webhook payload from actual logs
  const samplePayload = {
    "meta": {
      "test_mode": true,
      "event_name": "subscription_payment_success",
      "custom_data": {
        "user_id": "67df12120374fcf1760e393b"
      },
      "webhook_id": "3ef79bf0-8865-4f0b-a745-c4900c54690a"
    },
    "data": {
      "type": "subscription-invoices",
      "id": "2903591",
      "attributes": {
        "store_id": 162352,
        "subscription_id": 1067414,
        "customer_id": 5336438,
        "user_name": "eyal yehiely",
        "user_email": "eyalwork0@gmail.com"
      }
    }
  };
  
  // Expected signature from logs
  const expectedSignature = "36e99ee3ac85a8ca92ba15c3a21a1d8f6eb3d2d608ae909956ebfcdd540df24d";
  console.log(`Expected signature from webhook: ${expectedSignature}`);
  
  // Try with the configured secret
  const payloadString = JSON.stringify(samplePayload);
  const hmac = crypto.createHmac('sha256', configuredSecret);
  const calculatedSignature = hmac.update(payloadString).digest('hex');
  
  console.log(`Calculated signature with configured secret: ${calculatedSignature}`);
  console.log(`Matches expected: ${calculatedSignature === expectedSignature}`);
  
  // Try with different formatting of the same secret
  console.log('\nTrying different secret formats:');
  
  // 1. Try with trimmed secret
  const trimmedSecret = configuredSecret.trim();
  const hmacTrimmed = crypto.createHmac('sha256', trimmedSecret);
  const trimmedSignature = hmacTrimmed.update(payloadString).digest('hex');
  console.log(`With trimmed secret: ${trimmedSignature}`);
  console.log(`Matches expected: ${trimmedSignature === expectedSignature}`);
  
  // 2. Try with lowercase secret
  const lowercaseSecret = configuredSecret.toLowerCase();
  const hmacLower = crypto.createHmac('sha256', lowercaseSecret);
  const lowercaseSignature = hmacLower.update(payloadString).digest('hex');
  console.log(`With lowercase secret: ${lowercaseSignature}`);
  console.log(`Matches expected: ${lowercaseSignature === expectedSignature}`);
  
  // 3. Check for common encoding issues
  const secretWithoutWhitespace = configuredSecret.replace(/\s+/g, '');
  const hmacNoWhitespace = crypto.createHmac('sha256', secretWithoutWhitespace);
  const noWhitespaceSignature = hmacNoWhitespace.update(payloadString).digest('hex');
  console.log(`With whitespace removed: ${noWhitespaceSignature}`);
  console.log(`Matches expected: ${noWhitespaceSignature === expectedSignature}`);
  
  // Suggest next steps
  console.log('\n=== RECOMMENDATIONS ===');
  if (calculatedSignature === expectedSignature) {
    console.log('✅ Your webhook secret is correctly configured!');
  } else {
    console.log('❌ Your webhook secret does not match what LemonSqueezy is using.');
    console.log('Possible solutions:');
    console.log('1. Generate a new webhook secret in LemonSqueezy dashboard');
    console.log('2. Update your LEMON_SQUEEZY_WEBHOOK_SECRET environment variable');
    console.log('3. Try calculating the correct secret by brute force if needed');
  }
}

testWebhookSignature(); 