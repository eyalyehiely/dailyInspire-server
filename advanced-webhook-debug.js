/**
 * Advanced webhook verification debugging tool
 * 
 * This script tries multiple webhook secret formats and encoding methods
 * to find what might be causing the signature verification failure
 */

require('dotenv').config();
const crypto = require('crypto');

// Latest webhook data from logs
const WEBHOOK_DATA = {
  payload: {
    meta: {
      test_mode: true,
      event_name: "subscription_payment_success",
      custom_data: {
        user_id: "67df132e3836d964749a6496"
      },
      webhook_id: "49546b2e-525e-47ae-8426-36cc6154349c"
    },
    data: {
      type: "subscription-invoices",
      id: "2903833",
      attributes: {
        store_id: 162352,
        subscription_id: 1067478,
        customer_id: 5336438,
        user_name: "eyal yehiely",
        user_email: "eyalwork0@gmail.com",
        billing_reason: "initial"
      }
    }
  },
  signature: "ce7a619340c4a549936566bc92f75cc673b1486ffed5c1d4b3da8295f69d5933"
};

function advancedWebhookDebug() {
  console.log('=== ADVANCED WEBHOOK VERIFICATION DEBUG ===');
  
  // Get the webhook secret from environment variables
  const configuredSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!configuredSecret) {
    console.error('LEMON_SQUEEZY_WEBHOOK_SECRET is not set in .env file');
    return;
  }
  
  console.log(`Current webhook secret: ${configuredSecret}`);
  console.log(`Secret length: ${configuredSecret.length}`);
  
  // Convert payload to string
  const payloadString = JSON.stringify(WEBHOOK_DATA.payload);
  console.log(`\nPayload string length: ${payloadString.length}`);
  
  // Expected signature
  const expectedSignature = WEBHOOK_DATA.signature;
  console.log(`Expected signature: ${expectedSignature}`);
  
  // Create an array of different formats to try
  const secretFormats = [
    { name: "Original", secret: configuredSecret },
    { name: "Trimmed", secret: configuredSecret.trim() },
    { name: "Lowercase", secret: configuredSecret.toLowerCase() },
    { name: "Uppercase", secret: configuredSecret.toUpperCase() },
    { name: "No whitespace", secret: configuredSecret.replace(/\s+/g, '') },
    { name: "Base64 encoded", secret: Buffer.from(configuredSecret).toString('base64') },
    { name: "Base64 decoded", secret: Buffer.from(configuredSecret, 'base64').toString('utf-8') },
    // Try without any special characters
    { name: "Alphanumeric only", secret: configuredSecret.replace(/[^a-zA-Z0-9]/g, '') },
    // Try URL encoding/decoding
    { name: "URL encoded", secret: encodeURIComponent(configuredSecret) },
    { name: "URL decoded", secret: decodeURIComponent(encodeURIComponent(configuredSecret)) }
  ];
  
  console.log('\n=== TRYING DIFFERENT SECRET FORMATS ===');
  let foundMatch = false;
  
  secretFormats.forEach(format => {
    try {
      const hmac = crypto.createHmac('sha256', format.secret);
      const calculatedSignature = hmac.update(payloadString).digest('hex');
      const matches = calculatedSignature === expectedSignature;
      
      console.log(`\n${format.name}:`);
      console.log(`Secret: ${format.secret}`);
      console.log(`Secret length: ${format.secret.length}`);
      console.log(`Calculated signature: ${calculatedSignature}`);
      console.log(`MATCH: ${matches ? 'YES! ✓' : 'No'}`);
      
      if (matches) {
        foundMatch = true;
        console.log('\n🎉 FOUND A MATCHING SECRET FORMAT! 🎉');
        console.log(`Use this format: ${format.name}`);
      }
    } catch (error) {
      console.log(`\n${format.name}:`);
      console.log(`Error: ${error.message}`);
    }
  });
  
  // Try an approach that considers the raw request body
  console.log('\n=== TRYING WITH RAW REQUEST BODY ===');
  
  // Raw webhook body formatting (mimicking what middleware might see)
  const rawBody = JSON.stringify(WEBHOOK_DATA.payload);
  
  try {
    const hmac = crypto.createHmac('sha256', configuredSecret);
    const calculatedSignature = hmac.update(rawBody).digest('hex');
    const matches = calculatedSignature === expectedSignature;
    
    console.log(`Using raw body string:`);
    console.log(`Calculated signature: ${calculatedSignature}`);
    console.log(`MATCH: ${matches ? 'YES! ✓' : 'No'}`);
    
    if (matches) {
      foundMatch = true;
    }
  } catch (error) {
    console.log(`Error with raw body: ${error.message}`);
  }
  
  if (!foundMatch) {
    console.log('\n❌ No matching secret format found');
    console.log('\n=== RECOMMENDATIONS ===');
    console.log('1. Generate a completely new webhook secret in LemonSqueezy dashboard');
    console.log('2. Update your LEMON_SQUEEZY_WEBHOOK_SECRET environment variable with the exact value');
    console.log('3. Update your verification code to exactly match LemonSqueezy\'s HMAC-SHA256 implementation');
    console.log('\nAlternative approach:');
    console.log('- Consider temporarily disabling signature verification and processing webhooks directly');
    console.log('- Create a manual update script to process payments for users until the issue is resolved');
  }
}

advancedWebhookDebug(); 