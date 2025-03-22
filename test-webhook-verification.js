/**
 * Script to test webhook signature verification with the current webhook body
 * 
 * This script takes the webhook body from the log and tests signature verification
 * with both the original signature and our calculated one.
 */

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function testWithWebhookBody() {
  console.log('=== WEBHOOK SIGNATURE VERIFICATION TEST ===');
  
  // Get the webhook secret from environment variables
  const configuredSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!configuredSecret) {
    console.error('LEMON_SQUEEZY_WEBHOOK_SECRET is not set in .env file');
    return;
  }
  
  console.log(`Current webhook secret (length: ${configuredSecret.length}): ${configuredSecret}`);
  
  // Get webhook body from the first message
  const webhookBody = '{"meta":{"test_mode":true,"event_name":"subscription_created","custom_data":{"user_id":"67df132e3836d964749a6496"},"webhook_id":"690a11c4-f2fc-41f6-a7f1-07eb9791ece9"},"data":{"type":"subscriptions","id":"1067566","attributes":{"store_id":162352,"customer_id":5336438,"order_id":5118562,"order_item_id":5059043,"product_id":471688,"variant_id":730358,"product_name":"Pro","variant_name":"Default","user_name":"eyal yehiely","user_email":"eyalwork0@gmail.com","status":"active","status_formatted":"Active","card_brand":"visa","card_last_four":"4242","pause":null,"cancelled":false,"trial_ends_at":null,"billing_anchor":22,"first_subscription_item":{"id":1321281,"subscription_id":1067566,"price_id":1125820,"quantity":1,"is_usage_based":false,"created_at":"2025-03-22T21:16:14.000000Z","updated_at":"2025-03-22T21:16:14.000000Z"},"urls":{"update_payment_method":"https://dailyinspire.lemonsqueezy.com/subscription/1067566/payment-details?expires=1742699774&signature=e975ec68ef422f527e96cbacbc28b98319ce0d020c982537ca42f169e60f718a","customer_portal":"https://dailyinspire.lemonsqueezy.com/billing?expires=1742699774&test_mode=1&user=2669975&signature=c73dc647c6bddbfd93a8135966b67b960315cce938bc419a33e711b27c03bf9a","customer_portal_update_subscription":"https://dailyinspire.lemonsqueezy.com/billing/1067566/update?expires=1742699774&user=2669975&signature=190cf75113477ca68c535aad9fa410798732e99a690d79a226c6748a7f7a6dce"},"renews_at":"2025-04-22T21:16:07.000000Z","ends_at":null,"created_at":"2025-03-22T21:16:09.000000Z","updated_at":"2025-03-22T21:16:13.000000Z","test_mode":true},"relationships":{"store":{"links":{"related":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/store","self":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/relationships/store"}},"customer":{"links":{"related":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/customer","self":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/relationships/customer"}},"order":{"links":{"related":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/order","self":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/relationships/order"}},"order-item":{"links":{"related":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/order-item","self":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/relationships/order-item"}},"product":{"links":{"related":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/product","self":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/relationships/product"}},"variant":{"links":{"related":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/variant","self":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/relationships/variant"}},"subscription-items":{"links":{"related":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/subscription-items","self":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/relationships/subscription-items"}},"subscription-invoices":{"links":{"related":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/subscription-invoices","self":"https://api.lemonsqueezy.com/v1/subscriptions/1067566/relationships/subscription-invoices"}}}},"links":{"self":"https://api.lemonsqueezy.com/v1/subscriptions/1067566"}}}';
  
  // Expected signature from logs
  const expectedSignature = "49e2fd403ce0612f0b5724b225fba1330dc648bb0b4382549869ac6d7aca6994";
  console.log(`Expected signature from webhook: ${expectedSignature}`);
  
  // Try with the configured secret
  const hmac = crypto.createHmac('sha256', configuredSecret);
  const calculatedSignature = hmac.update(webhookBody).digest('hex');
  
  console.log(`\nCalculated signature with current secret: ${calculatedSignature}`);
  console.log(`Matches expected: ${calculatedSignature === expectedSignature}`);
  
  // Try with different formatting of the same secret
  console.log('\nTrying different secret formats:');
  
  // 1. Try with trimmed secret
  const trimmedSecret = configuredSecret.trim();
  if (trimmedSecret !== configuredSecret) {
    const hmacTrimmed = crypto.createHmac('sha256', trimmedSecret);
    const trimmedSignature = hmacTrimmed.update(webhookBody).digest('hex');
    console.log(`With trimmed secret: ${trimmedSignature}`);
    console.log(`Matches expected: ${trimmedSignature === expectedSignature}`);
  } else {
    console.log('Secret has no leading/trailing whitespace');
  }
  
  // 2. Try with a different JSON stringification
  try {
    // Parse and re-stringify to potentially get different format
    const parsedBody = JSON.parse(webhookBody);
    const restringifiedBody = JSON.stringify(parsedBody);
    
    if (restringifiedBody !== webhookBody) {
      const hmacRestring = crypto.createHmac('sha256', configuredSecret);
      const restringSignature = hmacRestring.update(restringifiedBody).digest('hex');
      console.log(`\nWith re-stringified body: ${restringSignature}`);
      console.log(`Matches expected: ${restringSignature === expectedSignature}`);
      console.log(`\nOriginal body length: ${webhookBody.length}`);
      console.log(`Re-stringified body length: ${restringifiedBody.length}`);
      
      // Show differences if they exist
      if (webhookBody.length !== restringifiedBody.length) {
        console.log('\nPossible format differences:');
        console.log(`Original body sample: ${webhookBody.substring(0, 50)}...`);
        console.log(`Restringified body sample: ${restringifiedBody.substring(0, 50)}...`);
      }
    } else {
      console.log('Re-stringified body is identical to original');
    }
  } catch (e) {
    console.error('Error parsing webhook body:', e);
  }
  
  // Suggest next steps
  console.log('\n=== RECOMMENDATIONS ===');
  if (calculatedSignature === expectedSignature) {
    console.log('✅ Your webhook signature calculation is working correctly!');
    console.log('Make sure the webhook-logger middleware runs BEFORE express.json() parsing.');
  } else {
    console.log('❌ Your webhook signature still does not match what LemonSqueezy is sending.');
    console.log('Possible solutions:');
    console.log('1. Ensure you are using the exact raw body received in the request');
    console.log('2. Check if the webhook secret in the .env file matches exactly what is in LemonSqueezy');
    console.log('3. Generate a new webhook secret in LemonSqueezy dashboard and update your .env file');
  }
}

testWithWebhookBody(); 