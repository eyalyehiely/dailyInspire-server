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
 * Create or update a subscription in our database from Paddle data
 * @param {Object} paddleSubscription - Subscription data from Paddle
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Updated or created subscription
 */
const syncSubscription = async (paddleSubscription, userId) => {
  try {
    // Extract customer ID from the subscription
    const paddleCustomerId = paddleSubscription.customer_id;
    
    // Find existing subscription or create new one
    let subscription = await Subscription.findOne({ 
      paddleSubscriptionId: paddleSubscription.id 
    });
    
    console.log('Syncing subscription data:', {
      id: paddleSubscription.id,
      status: paddleSubscription.status,
      paymentInfo: paddleSubscription.payment_information
    });
    
    // Log specific payment fields 
    if (paddleSubscription.payment_information) {
      console.log('Payment information details:');
      console.log('- Card brand:', paddleSubscription.payment_information.card_brand);
      console.log('- Last four:', paddleSubscription.payment_information.last_four);
      console.log('- Expiry month:', paddleSubscription.payment_information.expiry_month);
      console.log('- Expiry year:', paddleSubscription.payment_information.expiry_year);
    } else {
      console.log('No payment information available in subscription data');
    }
    
    const subscriptionData = {
      paddleSubscriptionId: paddleSubscription.id,
      userId,
      paddleCustomerId,
      status: paddleSubscription.status,
      billingCycle: {
        interval: paddleSubscription.billing_cycle.interval,
        frequency: paddleSubscription.billing_cycle.frequency
      },
      currentBillingPeriod: paddleSubscription.current_billing_period ? {
        startsAt: new Date(paddleSubscription.current_billing_period.starts_at),
        endsAt: new Date(paddleSubscription.current_billing_period.ends_at)
      } : null,
      trial: paddleSubscription.trial ? {
        startsAt: new Date(paddleSubscription.trial.starts_at),
        endsAt: new Date(paddleSubscription.trial.ends_at)
      } : null,
      paymentInformation: paddleSubscription.payment_information ? {
        cardBrand: paddleSubscription.payment_information.card_brand || "",
        lastFour: paddleSubscription.payment_information.last_four || "",
        expiryMonth: paddleSubscription.payment_information.expiry_month,
        expiryYear: paddleSubscription.payment_information.expiry_year
      } : null,
      items: paddleSubscription.items.map(item => ({
        priceId: item.price.id,
        quantity: item.quantity,
        status: item.status,
        recurring: item.recurring,
        previouslyBilledAt: item.previously_billed_at ? new Date(item.previously_billed_at) : null,
        nextBilledAt: item.next_billed_at ? new Date(item.next_billed_at) : null
      })),
      managementUrls: {
        updatePaymentMethod: paddleSubscription.management_urls?.update_payment_method,
        cancel: paddleSubscription.management_urls?.cancel
      },
      customData: paddleSubscription.custom_data || {},
      canceledAt: paddleSubscription.canceled_at ? new Date(paddleSubscription.canceled_at) : null,
      pausedAt: paddleSubscription.paused_at ? new Date(paddleSubscription.paused_at) : null,
      firstBilledAt: paddleSubscription.first_billed_at ? new Date(paddleSubscription.first_billed_at) : null,
      nextBilledAt: paddleSubscription.next_billed_at ? new Date(paddleSubscription.next_billed_at) : null
    };
    
    if (subscription) {
      // Update existing subscription
      console.log('Updating existing subscription with payment info:', subscriptionData.paymentInformation);
      subscription = await Subscription.findOneAndUpdate(
        { paddleSubscriptionId: paddleSubscription.id },
        { $set: subscriptionData },
        { new: true, runValidators: true }
      );
    } else {
      // Create new subscription
      console.log('Creating new subscription with payment info:', subscriptionData.paymentInformation);
      subscription = new Subscription(subscriptionData);
      await subscription.save();
    }
    
    // Update user's subscription status
    const userUpdateData = {
      subscriptionId: paddleSubscription.id,
      subscriptionStatus: paddleSubscription.status,
      isPay: ['active', 'trialing'].includes(paddleSubscription.status),
      paymentUpdatedAt: new Date(),
      ...(paddleSubscription.payment_information?.card_brand && {
        cardBrand: paddleSubscription.payment_information.card_brand
      }),
      ...(paddleSubscription.payment_information?.last_four && {
        cardLastFour: paddleSubscription.payment_information.last_four
      })
    };
    
    console.log('Updating user with card details:', {
      userId,
      subscriptionId: paddleSubscription.id,
      cardBrand: userUpdateData.cardBrand,
      cardLastFour: userUpdateData.cardLastFour
    });
    
    await User.findByIdAndUpdate(userId, userUpdateData);
    
    // Verify the user was updated properly
    const updatedUser = await User.findById(userId);
    console.log('User after update:', {
      userId: updatedUser._id,
      cardBrand: updatedUser.cardBrand,
      cardLastFour: updatedUser.cardLastFour,
      subscriptionStatus: updatedUser.subscriptionStatus
    });
    
    return subscription;
  } catch (error) {
    console.error('Error syncing subscription:', error);
    throw error;
  }
};

/**
 * Cancel a subscription
 * @param {string} paddleId - Paddle subscription ID
 * @returns {Promise<Object>} - Updated subscription
 */
const cancelSubscription = async (paddleId) => {
  try {
    // Cancel in Paddle
    await paddleApi.post(`/subscriptions/${paddleId}/cancel`);
    
    // Get updated subscription data
    const paddleSubscription = await getSubscription(paddleId);
    
    // Find our subscription record
    const subscription = await Subscription.findOne({ paddleSubscriptionId: paddleId });
    if (!subscription) {
      throw new Error(`Subscription ${paddleId} not found in our database`);
    }
    
    // Sync the updated subscription data
    return await syncSubscription(paddleSubscription, subscription.userId);
  } catch (error) {
    console.error(`Error canceling subscription ${paddleId}:`, error.message);
    throw error;
  }
};

/**
 * Pause a subscription
 * @param {string} paddleId - Paddle subscription ID
 * @returns {Promise<Object>} - Updated subscription
 */
const pauseSubscription = async (paddleId) => {
  try {
    // Pause in Paddle
    await paddleApi.post(`/subscriptions/${paddleId}/pause`);
    
    // Get updated subscription data
    const paddleSubscription = await getSubscription(paddleId);
    
    // Find our subscription record
    const subscription = await Subscription.findOne({ paddleSubscriptionId: paddleId });
    if (!subscription) {
      throw new Error(`Subscription ${paddleId} not found in our database`);
    }
    
    // Sync the updated subscription data
    return await syncSubscription(paddleSubscription, subscription.userId);
  } catch (error) {
    console.error(`Error pausing subscription ${paddleId}:`, error.message);
    throw error;
  }
};

/**
 * Resume a paused subscription
 * @param {string} paddleId - Paddle subscription ID
 * @returns {Promise<Object>} - Updated subscription
 */
const resumeSubscription = async (paddleId) => {
  try {
    // Resume in Paddle
    await paddleApi.post(`/subscriptions/${paddleId}/resume`);
    
    // Get updated subscription data
    const paddleSubscription = await getSubscription(paddleId);
    
    // Find our subscription record
    const subscription = await Subscription.findOne({ paddleSubscriptionId: paddleId });
    if (!subscription) {
      throw new Error(`Subscription ${paddleId} not found in our database`);
    }
    
    // Sync the updated subscription data
    return await syncSubscription(paddleSubscription, subscription.userId);
  } catch (error) {
    console.error(`Error resuming subscription ${paddleId}:`, error.message);
    throw error;
  }
};

/**
 * Update a subscription's payment method
 * @param {string} paddleId - Paddle subscription ID
 * @returns {Promise<string>} - URL to update payment method
 */
const getUpdatePaymentMethodUrl = async (paddleId) => {
  try {
    const response = await paddleApi.get(`/subscriptions/${paddleId}/update-payment-method-transaction`);
    return response.data.data.checkout_url;
  } catch (error) {
    console.error(`Error getting update payment method URL for ${paddleId}:`, error.message);
    throw error;
  }
};

/**
 * Get all subscriptions for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} - Array of subscriptions
 */
const getUserSubscriptions = async (userId) => {
  try {
    return await Subscription.find({ userId }).sort({ createdAt: -1 });
  } catch (error) {
    console.error(`Error getting subscriptions for user ${userId}:`, error.message);
    throw error;
  }
};

/**
 * Get active subscription for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} - Active subscription or null
 */
const getActiveSubscription = async (userId) => {
  try {
    return await Subscription.findOne({
      userId,
      status: { $in: ['active', 'trialing'] }
    });
  } catch (error) {
    console.error(`Error getting active subscription for user ${userId}:`, error.message);
    throw error;
  }
};

/**
 * Update next payment date for active subscriptions
 * @returns {Promise<void>}
 */


module.exports = {
  getSubscription,
  syncSubscription,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  getUpdatePaymentMethodUrl,
  getUserSubscriptions,
  getActiveSubscription
}; 