/**
 * Script to generate a new webhook secret and update the .env file
 * 
 * This script:
 * 1. Generates a new random webhook secret
 * 2. Updates the .env file with the new secret
 * 3. Provides instructions on how to update the secret in LemonSqueezy
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Function to generate a secure random string of specified length
function generateSecureSecret(length = 32) {
  // Generate a secure random string using crypto
  const randomBytes = crypto.randomBytes(Math.ceil(length * 3 / 4))
    .toString('base64')
    .slice(0, length);
  
  return randomBytes;
}

// Function to update the .env file with the new secret
function updateEnvFile(newSecret) {
  try {
    // Path to the .env file
    const envPath = path.join(__dirname, '.env');
    
    // Check if .env file exists
    if (!fs.existsSync(envPath)) {
      console.error('Error: .env file not found at', envPath);
      return false;
    }
    
    // Read the current .env file
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envLines = envContent.split('\n');
    
    // Update the webhook secret in the .env file
    let secretFound = false;
    const updatedLines = envLines.map(line => {
      if (line.startsWith('LEMON_SQUEEZY_WEBHOOK_SECRET=')) {
        secretFound = true;
        return `LEMON_SQUEEZY_WEBHOOK_SECRET=${newSecret}`;
      }
      return line;
    });
    
    // If the secret was not found, add it to the end
    if (!secretFound) {
      updatedLines.push(`LEMON_SQUEEZY_WEBHOOK_SECRET=${newSecret}`);
    }
    
    // Write the updated content back to the .env file
    fs.writeFileSync(envPath, updatedLines.join('\n'));
    
    return true;
  } catch (error) {
    console.error('Error updating .env file:', error);
    return false;
  }
}

// Main function to regenerate webhook secret
function regenerateWebhookSecret() {
  console.log('=== WEBHOOK SECRET REGENERATION ===');
  
  // Generate a new secret
  const newSecret = generateSecureSecret();
  console.log(`Generated new webhook secret (length: ${newSecret.length}):`);
  console.log(newSecret);
  
  // Update the .env file
  const updated = updateEnvFile(newSecret);
  
  if (updated) {
    console.log('\n✅ Successfully updated .env file with new webhook secret');
    
    console.log('\n=== NEXT STEPS ===');
    console.log('1. Log in to your LemonSqueezy account');
    console.log('2. Go to Settings > Webhooks');
    console.log('3. Find your webhook for DailyInspire and click Edit');
    console.log('4. Update the "Signing Secret" field with this new secret:');
    console.log(`   ${newSecret}`);
    console.log('5. Click Save');
    console.log('6. Restart your server application for the changes to take effect');
  } else {
    console.error('\n❌ Failed to update the .env file');
  }
}

// Run the function
regenerateWebhookSecret(); 