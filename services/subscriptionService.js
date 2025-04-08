const axios = require('axios');
const Subscription = require('../models/Subscription');
const User = require('../models/User');

// Initialize Paddle API client
const paddleApi = axios.create({
  baseURL: process.env.PADDLE_API_URL || 'https://api.paddle.com',
  headers: {
    'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

/**
 * Get a subscription by Paddle ID
 * @param {string} paddleId - Paddle subscription ID
 * @returns {Promise<Object>} - Subscription object
 */
const getSubscription = async (paddleId) => {
  try {
    // Use the subscription ID as is, without adding any prefix
    console.log(`Using subscription ID: ${paddleId}`);
    
    const response = await paddleApi.get(`/subscriptions/${paddleId}`);
    
    // Log payment information specifically
    if (response.data && response.data.data) {
      console.log('Paddle subscription response structure:', Object.keys(response.data.data));
      
      if (response.data.data.payment_information) {
        console.log('Payment information keys:', Object.keys(response.data.data.payment_information));
        console.log('Card brand:', response.data.data.payment_information.card_brand);
        console.log('Last four:', response.data.data.payment_information.last_four);
      } else {
        console.log('No payment_information found in Paddle response');
      }
    }
    
    return response.data;
  } catch (error) {
    console.error(`Error fetching subscription ${paddleId}:`, error.message);
    throw error;
  }
};

/**
 * Update next payment date for active subscriptions
 * @returns {Promise<void>}
 */
const updateNextPaymentDates = async () => {
  try {
    console.log('Starting next payment date update process...');
    
    // Get current date in Israel timezone
    const now = new Date();
    const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    
    // Find all users with active subscriptions
    const users = await User.find({
      subscriptionStatus: 'active',
      'lastCheckoutAttempt.nextPaymentDate': { $lt: israelTime }
    });
    
    console.log(`Found ${users.length} users to update next payment date`);
    
    for (const user of users) {
      try {
        // Calculate new next payment date (same date next month)
        const newNextPaymentDate = new Date(user.lastCheckoutAttempt.nextPaymentDate);
        newNextPaymentDate.setMonth(newNextPaymentDate.getMonth() + 1);
        
        // Update user's next payment date
        await User.findByIdAndUpdate(user._id, {
          'lastCheckoutAttempt.nextPaymentDate': newNextPaymentDate,
          'lastCheckoutAttempt.timestamp': new Date()
        });
        
        console.log(`Updated next payment date for user ${user.email} to ${newNextPaymentDate}`);
      } catch (error) {
        console.error(`Error updating next payment date for user ${user.email}:`, error);
      }
    }
    
    console.log('Next payment date update process completed');
  } catch (error) {
    console.error('Error in updateNextPaymentDates:', error);
    throw error;
  }
};


module.exports = {
  getSubscription,
  updateNextPaymentDates
}; 