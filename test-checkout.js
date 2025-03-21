/**
 * Test script to verify checkout URL
 * 
 * Usage: node test-checkout.js
 */

require('dotenv').config();
const axios = require('axios');

async function testCheckoutUrl() {
  console.log('===== TESTING CHECKOUT URLs =====');

  // IDs to test
  const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID || '730358';
  const variantSlug = '9e44dcc7-edab-43f0-b9a2-9d663d4af336';
  const testUserId = 'test-user-123';
  const storeName = process.env.LEMON_SQUEEZY_STORE_NAME || 'dailyinspire';

  console.log(`Using store name: ${storeName}`);
  console.log(`Using variant ID: ${variantId}`);
  console.log(`Using variant slug: ${variantSlug}`);

  // Testing 4 different URL formats
  const urls = [
    // Format 1: Using variant ID
    `https://${storeName}.lemonsqueezy.com/buy/${variantId}`,
    
    // Format 2: Using variant slug
    `https://${storeName}.lemonsqueezy.com/buy/${variantSlug}`,
    
    // Format 3: With checkout domain using ID
    `https://checkout.lemonsqueezy.com/buy/${variantId}`,
    
    // Format 4: With checkout domain using slug
    `https://checkout.lemonsqueezy.com/buy/${variantSlug}`
  ];

  for (const url of urls) {
    console.log(`\nTesting URL: ${url}`);
    try {
      const response = await axios.head(url);
      console.log(`✅ Success! Status: ${response.status}`);
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      if (error.response) {
        console.error(`Status: ${error.response.status}`);
      }
    }
  }

  // Now test with parameters
  console.log('\n===== TESTING CHECKOUT URLs WITH PARAMETERS =====');

  // Parameters to add
  const params = new URLSearchParams();
  params.append('checkout[custom][user_id]', testUserId);
  params.append('discount', '0');

  const workingUrl = `https://${storeName}.lemonsqueezy.com/buy/${variantSlug}?${params.toString()}`;
  
  console.log(`Testing complete URL: ${workingUrl}`);
  try {
    const response = await axios.head(workingUrl);
    console.log(`✅ Success! Status: ${response.status}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
    }
  }

  console.log('\n===== RECOMMENDATIONS =====');
  console.log('1. Use the URL format that returns a 200 status code');
  console.log('2. Make sure the variant slug is being used correctly');
  console.log('3. Confirm the store name is correct in your Lemonsqueezy account');
}

// Run the test
testCheckoutUrl().catch(console.error); 