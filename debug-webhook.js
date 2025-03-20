/**
 * Script to debug webhook issues and verify webhook configuration
 * 
 * Usage:
 * 1. Make sure MongoDB connection is configured in .env
 * 2. Run: node debug-webhook.js
 */

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

function checkWebhookConfiguration() {
  console.log('\n===== CHECKING WEBHOOK CONFIGURATION =====');
  
  const webhookUrl = process.env.LEMON_SQUEEZY_WEBHOOK_URL;
  const webhookSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
  
  if (!webhookUrl) {
    console.error('⚠️ LEMON_SQUEEZY_WEBHOOK_URL is not set in environment variables');
    console.error('Payment webhooks will not work correctly without this!');
  } else if (webhookUrl.includes('YOUR_SERVER_URL')) {
    console.error('⚠️ LEMON_SQUEEZY_WEBHOOK_URL contains placeholder value:', webhookUrl);
    console.error('Please update this to your actual server URL');
  } else {
    console.log('✅ LEMON_SQUEEZY_WEBHOOK_URL is set to:', webhookUrl);
  }
  
  if (!webhookSecret) {
    console.error('⚠️ LEMON_SQUEEZY_WEBHOOK_SECRET is not set in environment variables');
    console.error('Payment webhook verification will not work without this!');
  } else {
    console.log('✅ LEMON_SQUEEZY_WEBHOOK_SECRET is set with length:', webhookSecret.length);
  }
  
  if (!apiKey) {
    console.error('⚠️ LEMON_SQUEEZY_API_KEY is not set in environment variables');
    console.error('LemonSqueezy API calls will not work without this!');
  } else {
    console.log('✅ LEMON_SQUEEZY_API_KEY is set with length:', apiKey.length);
  }
  
  console.log('\n===== WEBHOOK TEST =====');
  console.log('Testing webhook signature verification functionality:');
  
  // Create a test payload and signature
  const testPayload = { test: 'data', user_id: 'test-user-id' };
  const testPayloadStr = JSON.stringify(testPayload);
  
  if (!webhookSecret) {
    console.error('❌ Cannot test signature verification without webhook secret');
  } else {
    // Create a signature with the configured secret
    const hmac = crypto.createHmac('sha256', webhookSecret);
    const calculatedSignature = hmac.update(testPayloadStr).digest('hex');
    
    console.log('Test payload:', testPayloadStr);
    console.log('Generated signature:', calculatedSignature);
    
    // Test if validation would pass
    console.log('Simulating signature verification...');
    
    const isValid = (signature) => {
      const hmac = crypto.createHmac('sha256', webhookSecret);
      const expectedSignature = hmac.update(testPayloadStr).digest('hex');
      return expectedSignature === signature;
    };
    
    console.log('Correct signature verification result:', isValid(calculatedSignature));
    console.log('Incorrect signature verification result:', isValid('wrong-signature'));
  }
  
  console.log('\n===== RECOMMENDATIONS =====');
  console.log('1. Make sure your server is publicly accessible (use ngrok for local testing)');
  console.log('2. Verify webhook URL in LemonSqueezy dashboard matches:', webhookUrl);
  console.log('3. Check server logs when payments are made for webhook events');
  console.log('4. Use the "test-webhook.js" script to simulate webhook events');
  console.log('5. Make sure checkout URLs include the correct user_id parameter');
}

// Execute checks
checkWebhookConfiguration(); 