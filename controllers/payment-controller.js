const axios = require('axios');
const User = require('../models/User');

// Initialize LemonSqueezy API client (if needed)
const lemonSqueezyApi = axios.create({
  baseURL: 'https://api.lemonsqueezy.com/v1',
  headers: {
    'Authorization': `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

// Verify a webhook signature from LemonSqueezy
const verifyWebhookSignature = (signature, body) => {
  // Implement signature verification logic here based on LemonSqueezy docs
  // This is a placeholder - in production, you need to properly verify the signature
  
  // For example:
  // const hmac = crypto.createHmac('sha256', process.env.LEMON_SQUEEZY_WEBHOOK_SECRET);
  // const digest = hmac.update(JSON.stringify(body)).digest('hex');
  // return signature === digest;
  
  return true; // Placeholder for now
};

// Process a successful payment
const processSuccessfulPayment = async (userId) => {
  try {
    // Update user payment status
    const user = await User.findByIdAndUpdate(
      userId,
      { isPay: true },
      { new: true }
    );
    
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    
    console.log(`Payment processed successfully for user: ${userId}`);
    return user;
  } catch (error) {
    console.error('Error processing payment:', error);
    throw error;
  }
};

// Get user payment status
const getUserPaymentStatus = async (userId) => {
  try {
    const user = await User.findById(userId);
    return { isPaid: user.isPay };
  } catch (error) {
    console.error('Error getting payment status:', error);
    throw error;
  }
};

module.exports = {
  lemonSqueezyApi,
  verifyWebhookSignature,
  processSuccessfulPayment,
  getUserPaymentStatus
}; 