/**
 * Test script to send a simulated webhook to our local server
 * 
 * Usage: 
 * 1. Make sure your server is running
 * 2. Run: node test-webhook.js [user-id] [event-type]
 * 
 * Event types:
 * - subscription_created (default)
 * - subscription_payment_success
 * - subscription_cancelled
 * - subscription_expired
 * - subscription_payment_failed
 */

const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

// Sample webhook data similar to what LemonSqueezy would send
const createSampleWebhook = (userId, eventType = 'subscription_created') => {
  const orderId = `test-order-${Date.now()}`;
  const subscriptionId = `test-subscription-${Date.now()}`;
  
  // Validate event type
  const validEvents = [
    'subscription_created',
    'subscription_payment_success',
    'subscription_cancelled',
    'subscription_expired',
    'subscription_payment_failed',
    'subscription_paused',
    'subscription_unpaused'
  ];
  
  if (!validEvents.includes(eventType)) {
    console.warn(`Warning: '${eventType}' is not a recognized event type. Using 'subscription_created' instead.`);
    eventType = 'subscription_created';
  }
  
  return {
    meta: {
      event_name: eventType,
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
        status: eventType === 'subscription_cancelled' ? 'cancelled' : 
                eventType === 'subscription_expired' ? 'expired' : 
                eventType === 'subscription_payment_failed' ? 'failed' : 'active',
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
    webhookUrl = 'http://localhost:5000/api/payments/webhook';
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
    const eventType = process.argv[3] || 'subscription_created';
    
    console.log(`🔍 Using user ID: ${userId}`);
    console.log(`🔔 Event type: ${eventType}`);
    
    // Create webhook payload
    const webhookPayload = createSampleWebhook(userId, eventType);
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
    
    /* Uncomment to automatically send the webhook
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