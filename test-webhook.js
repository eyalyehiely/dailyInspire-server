/**
 * Test script to send a simulated webhook to our local server
 * This is useful for testing webhook handling without having to use LemonSqueezy
 * 
 * Usage: 
 * 1. Make sure your server is running
 * 2. Run: node test-webhook.js
 */

const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

// Sample webhook data similar to what LemonSqueezy would send
const createSampleWebhook = (userId) => {
  const orderId = `test-order-${Date.now()}`;
  const subscriptionId = `test-subscription-${Date.now()}`;
  
  return {
    meta: {
      event_name: 'subscription_created',
      custom_data: {
        user_id: userId
      }
    },
    data: {
      id: subscriptionId,
      type: 'subscriptions',
      attributes: {
        order_id: orderId,
        user_name: 'Test User',
        user_email: 'test@example.com',
        status: 'active',
        custom_data: {
          user_id: userId
        },
        first_order_item: {
          custom_data: {
            user_id: userId
          }
        }
      }
    }
  };
};

// Get the webhook URL from .env or use a default
const getWebhookUrl = () => {
  let webhookUrl = process.env.LEMON_SQUEEZY_WEBHOOK_URL;
  
  // If we're using a placeholder URL, use localhost
  if (!webhookUrl || webhookUrl.includes('YOUR_SERVER_URL')) {
    webhookUrl = 'http://localhost:5000/api/payments/simulate-webhook';
    console.log('Using default local webhook URL:', webhookUrl);
  }
  
  return webhookUrl;
};

// Create a webhook signature
const createSignature = (payload) => {
  const webhookSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || 'test-secret';
  const payloadString = JSON.stringify(payload);
  
  return crypto
    .createHmac('sha256', webhookSecret)
    .update(payloadString)
    .digest('hex');
};

// Send a test webhook
const sendTestWebhook = async () => {
  try {
    // Get user ID from command line or use a test ID
    const userId = process.argv[2] || '650c9ebcbbd15d7d31c1a7b4';
    
    console.log(`🔍 Using user ID: ${userId}`);
    
    // Create webhook payload
    const webhookPayload = createSampleWebhook(userId);
    console.log('📦 Webhook payload:', JSON.stringify(webhookPayload, null, 2));
    
    // Create signature
    const signature = createSignature(webhookPayload);
    console.log('🔏 Generated signature:', signature);
    
    // Get webhook URL
    const webhookUrl = getWebhookUrl();
    console.log(`🚀 Would send test webhook to: ${webhookUrl}`);
    
    // Print out curl command for manual testing
    const payloadStr = JSON.stringify(webhookPayload).replace(/"/g, '\\"');
    console.log('\n🧪 Test command for manual use:');
    console.log(`curl -X POST ${webhookUrl} \\
  -H "Content-Type: application/json" \\
  -H "X-Signature: ${signature}" \\
  -d "${payloadStr}"`);
    
    console.log('\nInstructions:');
    console.log('1. Make sure your server is running');
    console.log('2. Copy and run the curl command above');
    console.log('3. Check server logs for webhook processing details');
    
    /* Commented out actual request
    // Send the request
    const response = await axios.post(webhookUrl, webhookPayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature
      }
    });
    
    console.log('✅ Webhook sent successfully!');
    console.log('📊 Server response:', JSON.stringify(response.data, null, 2));
    */
  } catch (error) {
    console.error('❌ Error preparing test webhook:');
    console.error(error.message);
  }
};

// Run the test
sendTestWebhook(); 