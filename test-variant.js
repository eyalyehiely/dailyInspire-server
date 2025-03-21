/**
 * Test script to check if a variant ID exists in Lemonsqueezy
 * 
 * Usage: node test-variant.js
 */

require('dotenv').config();
const axios = require('axios');

async function checkVariant() {
  console.log('===== CHECKING VARIANT ID IN LEMONSQUEEZY =====');
  
  const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID;
  console.log(`Testing variant ID: ${variantId}`);

  // Create Lemonsqueezy API client
  const lemonSqueezyApi = axios.create({
    baseURL: 'https://api.lemonsqueezy.com/v1',
    headers: {
      'Authorization': `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });

  try {
    // Try to get the variant directly
    console.log(`Attempting to fetch variant with ID: ${variantId}`);
    const variantResponse = await lemonSqueezyApi.get(`/variants/${variantId}`);
    
    if (variantResponse.data && variantResponse.data.data) {
      console.log('✅ Variant found!');
      console.log('Variant details:', JSON.stringify(variantResponse.data.data, null, 2));
      return true;
    }
  } catch (error) {
    console.error(`Error fetching variant: ${error.message}`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Response data:`, error.response.data);
    }
  }

  try {
    // List all variants as a fallback
    console.log('\nListing all variants to check if your variant exists:');
    const allVariantsResponse = await lemonSqueezyApi.get('/variants');
    
    if (allVariantsResponse.data && allVariantsResponse.data.data) {
      const variants = allVariantsResponse.data.data;
      console.log(`Found ${variants.length} variants in your store:`);
      
      variants.forEach(variant => {
        const isMatch = variant.id === variantId;
        console.log(`${isMatch ? '✅' : '❌'} ID: ${variant.id} - ${variant.attributes.name} - ${isMatch ? 'MATCH!' : ''}`);
      });
      
      return variants.some(v => v.id === variantId);
    }
  } catch (error) {
    console.error(`Error listing variants: ${error.message}`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Response data:`, error.response.data);
    }
  }

  console.log('\n===== RECOMMENDATIONS =====');
  console.log('1. Verify your LEMON_SQUEEZY_API_KEY is correct');
  console.log('2. Make sure the variant ID exists in your Lemonsqueezy account');
  console.log('3. Check if your store name is correct in the URL');
  console.log('4. Try creating a new test product in Lemonsqueezy and use its variant ID');

  return false;
}

// Run the check
checkVariant().catch(console.error); 