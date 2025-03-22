/**
 * Script to update the webhook secret in the .env file
 * 
 * This script updates the LEMON_SQUEEZY_WEBHOOK_SECRET in the .env file
 * to fix the webhook signature verification issue.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function updateWebhookSecret() {
  try {
    console.log('=== WEBHOOK SECRET UPDATE ===');
    
    // Path to the .env file
    const envPath = path.join(__dirname, '.env');
    
    // Check if .env file exists
    if (!fs.existsSync(envPath)) {
      console.error('Error: .env file not found at', envPath);
      return;
    }
    
    // Read the current .env file
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envLines = envContent.split('\n');
    
    // Ask for the new webhook secret
    const newSecret = await new Promise(resolve => {
      rl.question('Enter the new webhook secret from LemonSqueezy: ', answer => {
        resolve(answer.trim());
      });
    });
    
    if (!newSecret) {
      console.error('Error: Webhook secret cannot be empty');
      return;
    }
    
    console.log(`New webhook secret entered (length: ${newSecret.length})`);
    
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
    
    console.log('✅ Webhook secret updated successfully!');
    console.log(`Updated .env file at: ${envPath}`);
    
    // Test the new secret
    console.log('\nTo verify the new secret works correctly:');
    console.log('1. Run: node fix-webhook-verification.js');
    console.log('2. Deploy your application with the updated .env file');
    console.log('3. Make a test payment to verify webhooks work correctly');
    
  } catch (error) {
    console.error('Error updating webhook secret:', error);
  } finally {
    rl.close();
  }
}

updateWebhookSecret(); 