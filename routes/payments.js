const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { Paddle, EventName } = require('@paddle/paddle-node-sdk');
const { 
  processSuccessfulPayment,
  paddleApi,
} = require('../controllers/paddle-controller');
const subscriptionService = require('../services/subscriptionService');
const mongoose = require('mongoose');

// Initialize Paddle SDK
const paddle = new Paddle(process.env.PADDLE_API_KEY);

// Route to get payment page information
router.get('/checkout-info', auth, async (req, res) => {
  try {
    console.log('=== CHECKOUT INFO REQUEST ===');
    console.log('User ID:', req.user?.id);
    console.log('Auth token present:', !!req.headers.authorization);
    
    if (!req.user?.id) {
      console.error('No user ID found in request');
      return res.status(401).json({ 
        message: 'Authentication required',
        error: 'No user ID found'
      });
    }
    
    // Check if user is already paid
    const user = await User.findById(req.user.id);
    if (!user) {
      console.error('User not found:', req.user.id);
      return res.status(404).json({ 
        message: 'User not found',
        error: 'User not found in database'
      });
    }
    
    // If user already has paid status, return comprehensive subscription info
    if (user.isPay) {
      console.log('User already has premium access:', req.user.id);
      
      // Get additional subscription details from Paddle if available
      let subscriptionDetails = null;
      let cardBrand = user.cardBrand;
      let cardLastFour = user.cardLastFour;
      let customerPortalUrl = "";
      let cancelSubscriptionUrl = "";
      
      if (user.subscriptionId) {
        try {
          const response = await paddleApi.get(`/subscriptions/${user.subscriptionId}`);
          if (response.data) {
            const subData = response.data;
            subscriptionDetails = subData;
            
            // Extract card details
            cardBrand = subData.payment_information?.card_brand || "";
            cardLastFour = subData.payment_information?.last_four || "";
            
            // Extract URLs from the response
            customerPortalUrl = subData.customer_portal_url || "";
            cancelSubscriptionUrl = subData.cancel_url || "";
          }
        } catch (err) {
          console.error('Error fetching subscription details:', err.message);
        }
      }
      
      return res.json({ 
        isPaid: true, 
        message: 'You already have premium access',
        subscriptionStatus: user.subscriptionStatus || 'active',
        subscriptionId: user.subscriptionId || null,
        cardBrand,
        cardLastFour,
        customerPortalUrl,
        cancelSubscriptionUrl,
        subscriptionDetails,
        paymentUpdatedAt: user.paymentUpdatedAt,
        quotesEnabled: user.quotesEnabled
      });
    }
    
    // Return Paddle checkout information for non-paid users
    const responseData = {
      isPaid: false,
      productId: process.env.PADDLE_PRODUCT_ID,
      userId: req.user.id,
      subscriptionStatus: user.subscriptionStatus || 'none',
      subscriptionId: user.subscriptionId || null,
      quotesEnabled: user.quotesEnabled || false,
      paymentUpdatedAt: user.paymentUpdatedAt || null
    };
    
    console.log("Sending checkout info to client:", responseData);
    console.log('Final response being sent:', JSON.stringify(responseData, null, 2));
    return res.json(responseData);
  } catch (error) {
    console.error('Error in checkout-info route:', error);
    return res.status(500).json({ 
      message: 'Server error', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Route to create a subscription transaction
router.post('/create-subscription', auth, async (req, res) => {
  try {
    const { priceId, quantity = 1 } = req.body;
    
    if (!priceId) {
      return res.status(400).json({ error: 'Price ID is required' });
    }

    // Get user details
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create transaction with automatic collection mode
    const transactionData = {
      items: [
        {
          price_id: priceId,
          quantity: quantity
        }
      ],
      collection_mode: "automatic",
      custom_data: {
        user_id: user._id.toString()
      }
    };

    const response = await paddleApi.post('/transactions', transactionData);
    
    if (!response.data || !response.data.data) {
      throw new Error('Invalid response from Paddle API');
    }

    const transaction = response.data.data;
    
    // Update user's last checkout attempt
    const now = new Date();
    const nextPaymentDate = new Date(now);
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

    await User.findByIdAndUpdate(req.user.id, {
      'lastCheckoutAttempt': {
        url: transaction.checkout?.url,
        firstPaymentDate: now,
        nextPaymentDate: nextPaymentDate,
        timestamp: now
      },
      paymentUpdatedAt: now
    });
    
    // Return the transaction ID and checkout URL
    return res.json({
      transactionId: transaction.id,
      checkoutUrl: transaction.checkout?.url,
      status: transaction.status
    });

  } catch (error) {
    console.error('Error creating subscription transaction:', error);
    return res.status(500).json({ 
      error: 'Failed to create subscription transaction',
      details: error.message
    });
  }
});



// Route to check user's current payment status
router.get('/status', auth, async (req, res) => {
  try {
    console.log('Checking payment status for user:', req.user.id);
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Get active subscription for the user
    const subscription = await axios.get(`${process.env.PADDLE_API_URL}/subscriptions/${user.subscriptionId}`, {
      headers: {
        'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`
      }

    });
    const activeSubscription = subscription.data.data.status;
    
    // If user has a subscription ID, fetch details from Paddle API
    let cardBrand = user.cardBrand || "";
    let cardLastFour = user.cardLastFour || "";
    let customerPortalUrl = "";
    let cancelSubscriptionUrl = "";
    let subscriptionDetails = null;
    let paddleError = null;
    
    console.log('User card details from database:', { 
      cardBrand: user.cardBrand, 
      cardLastFour: user.cardLastFour 
    });
    
    if (activeSubscription=="active") {
      try {
        console.log('Fetching subscription details from Paddle for ID:', activeSubscription.paddleSubscriptionId);
        const paddleSubscription = await subscriptionService.getSubscription(activeSubscription.paddleSubscriptionId);
        
        // Check if response follows Paddle's API format
        if (paddleSubscription && paddleSubscription.data) {
          const subData = paddleSubscription.data;
          console.log('Received subscription data from Paddle:', JSON.stringify(subData, null, 2));
          
          subscriptionDetails = subData;
          
          // Extract card details from payment information with better logging
          if (subData.payment_information) {
            console.log('Payment information found:', JSON.stringify(subData.payment_information, null, 2));
            cardBrand = subData.payment_information.card_brand || "";
            cardLastFour = subData.payment_information.last_four || "";
            console.log('Extracted card details:', { cardBrand, cardLastFour });
          } else {
            console.log('No payment information found in subscription data');
          }
          
          // Extract URLs from the response
          customerPortalUrl = subData.management_urls?.update_payment_method || "";
          cancelSubscriptionUrl = subData.management_urls?.cancel || "";
          
          // Update user's payment status based on Paddle's status
          const paddleStatus = subData.status;
          console.log('Current Paddle status:', paddleStatus);
          console.log('Current user status:', user.subscriptionStatus);
          
          if (paddleStatus !== user.subscriptionStatus) {
            console.log('Updating user status to match Paddle status');
            await User.findByIdAndUpdate(req.user.id, {
              subscriptionStatus: paddleStatus,
              isPay: paddleStatus === 'active',
              quotesEnabled: paddleStatus === 'active',
              paymentUpdatedAt: new Date()
            });
            user.subscriptionStatus = paddleStatus;
            user.isPay = paddleStatus === 'active';
            user.quotesEnabled = paddleStatus === 'active';
          }
        } else {
          console.error('Invalid Paddle API response format:', paddleSubscription);
          paddleError = 'Invalid response from payment system';
        }
      } catch (err) {
        console.error('Error fetching subscription details:', err.message);
        console.error('Error details:', err.response?.data || err);
        paddleError = err.message;
        
        // If the subscription is not found in Paddle, mark the user as unpaid
        if (err.response?.status === 404) {
          console.log('Subscription not found in Paddle, marking user as unpaid');
          await User.findByIdAndUpdate(req.user.id, {
            isPay: false,
            subscriptionStatus: 'none',
            quotesEnabled: false,
            paymentUpdatedAt: new Date()
          });
          return res.json({
            isPay: false,
            isRegistrationComplete: user.isRegistrationComplete,
            quotesEnabled: false,
            subscriptionStatus: 'none',
            subscriptionId: null,
            error: 'Subscription not found in payment system'
          });
        }
      }
    } else {
      console.log('No active subscription found for user:', req.user.id);
    }
    
    const response = {
      isPay: user.isPay,
      isRegistrationComplete: user.isRegistrationComplete,
      quotesEnabled: user.quotesEnabled,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionId: user.subscriptionId,
      cardBrand: user.cardBrand,
      cardLastFour: user.cardLastFour,
      customerPortalUrl,
      cancelSubscriptionUrl,
      subscriptionDetails,
      paymentUpdatedAt: user.paymentUpdatedAt,
      error: paddleError
    };
    
    console.log('Sending payment status response with card details:', {
      cardBrand: response.cardBrand,
      cardLastFour: response.cardLastFour
    });
    
    console.log('Final response being sent:', JSON.stringify(response, null, 2));
    return res.json(response);
  } catch (error) {
    console.error('Error checking payment status:', error);
    return res.status(500).json({ 
      message: 'Server error',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});


// Route to update user payment data
router.post('/update-user-data', auth, async (req, res) => {
  try {
    const { subscriptionId, subscriptionStatus, cardBrand, cardLastFour, firstPaymentDate, nextPaymentDate } = req.body;
    
    console.log('Received update-user-data request with card details:', {
      cardBrand,
      cardLastFour,
      subscriptionId,
      subscriptionStatus
    });
    
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Subscription ID is required' });
    }
    
    // Use the subscription ID as is, without adding any prefix
    const formattedSubscriptionId = subscriptionId;
    console.log(`Using subscription ID: ${formattedSubscriptionId}`);
    
    // Get current date in Israel timezone
    const now = new Date();
    const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    // Calculate next payment date (same date next month)
    const calculatedNextPaymentDate = new Date(israelTime);
    calculatedNextPaymentDate.setMonth(calculatedNextPaymentDate.getMonth() + 1);
    
    // Update user's subscription data
    const updateData = {
      subscriptionId: formattedSubscriptionId,
      subscriptionStatus: subscriptionStatus || 'active',
      isPay: true,
      quotesEnabled: true,
      isRegistrationComplete: true,
      paymentUpdatedAt: new Date(),
      cardBrand: cardBrand,
      cardLastFour: cardLastFour,
      'lastCheckoutAttempt.firstPaymentDate': firstPaymentDate || israelTime,
      'lastCheckoutAttempt.nextPaymentDate': nextPaymentDate || calculatedNextPaymentDate,
      'lastCheckoutAttempt.timestamp': new Date()
    };
    
    console.log('Updating user with data:', updateData);
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('User updated successfully with card details:', {
      cardBrand: user.cardBrand,
      cardLastFour: user.cardLastFour
    });
    
    return res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        isPay: user.isPay,
        subscriptionStatus: user.subscriptionStatus,
        quotesEnabled: user.quotesEnabled,
        isRegistrationComplete: user.isRegistrationComplete,
        cardBrand: user.cardBrand,
        cardLastFour: user.cardLastFour,
        firstPaymentDate: user.lastCheckoutAttempt?.firstPaymentDate,
        nextPaymentDate: user.lastCheckoutAttempt?.nextPaymentDate
      }
    });
  } catch (error) {
    console.error('Error updating user data:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Route to verify a transaction with Paddle
router.get('/verify-transaction/:transactionId', auth, async (req, res) => {
  try {
    console.log('=== VERIFY TRANSACTION REQUEST ===');
    console.log('Transaction ID:', req.params.transactionId);
    console.log('User ID:', req.user?.id);
    
    if (!req.user?.id) {
      console.error('No user ID found in request');
      return res.status(401).json({ 
        message: 'Authentication required',
        error: 'No user ID found'
      });
    }
    
    // Check if transactionId is null or 'null'
    if (!req.params.transactionId || req.params.transactionId === 'null') {
      console.error('Invalid transaction ID provided');
      return res.status(400).json({ 
        message: 'Invalid transaction ID',
        error: 'A valid transaction ID is required'
      });
    }
    
    // Get user details
    const user = await User.findById(req.user.id);
    if (!user) {
      console.error('User not found:', req.user.id);
      return res.status(404).json({ 
        message: 'User not found',
        error: 'User not found in database'
      });
    }
    
    // Call Paddle API to get transaction details
    console.log('Fetching transaction details from Paddle API');
    const response = await paddleApi.get(`/transactions/${req.params.transactionId}`);
    
    if (!response.data || !response.data.data) {
      console.error('Invalid response from Paddle API');
      return res.status(404).json({ 
        message: 'Transaction not found',
        error: 'Invalid response from Paddle API'
      });
    }
    
    const transaction = response.data.data;
    console.log('Transaction data:', transaction);
    
    // Check if the transaction is completed
    if (transaction.status !== 'completed') {
      console.error('Transaction not completed:', transaction.status);
      return res.status(400).json({ 
        message: 'Transaction not completed',
        error: `Transaction status: ${transaction.status}`
      });
    }
    
    // Extract subscription ID from the transaction
    const subscriptionId = transaction.subscription_id;
    console.log('Subscription ID from transaction:', subscriptionId);
    
    if (!subscriptionId) {
      console.error('No subscription ID found in transaction data');
      return res.status(400).json({ 
        message: 'No subscription ID found',
        error: 'No subscription ID found in transaction data'
      });
    }
    
    // Update user's subscription data
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      {
        subscriptionId: subscriptionId,
        subscriptionStatus: 'active',
        isPay: true,
        cardBrand: req.query.cardBrand,
        cardLastFour: req.query.cardLastFour,
        quotesEnabled: true,
        isRegistrationComplete: true,
        paymentUpdatedAt: new Date()
      },
      { new: true }
    );
    
    if (!updatedUser) {
      console.error('Failed to update user subscription data');
      return res.status(500).json({
        message: 'Failed to update user subscription',
        error: 'User update failed'
      });
    }
    
    return res.json({
      message: 'Transaction verified successfully',
      subscriptionId: subscriptionId,
      status: 'active',
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        isPay: updatedUser.isPay,
        subscriptionStatus: updatedUser.subscriptionStatus,
        quotesEnabled: updatedUser.quotesEnabled,
        isRegistrationComplete: updatedUser.isRegistrationComplete,
        cardBrand: updatedUser.cardBrand,
        cardLastFour: updatedUser.cardLastFour
      }
    });
  } catch (error) {
    console.error('Error verifying transaction:', error);
    return res.status(500).json({
      message: 'Error verifying transaction',
      error: error.message
    });
  }
});

// Route to get subscription management URL
router.get('/subscription-management-url', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.subscriptionId) {
      return res.status(404).json({ 
        message: 'Subscription not found',
        error: 'No active subscription found'
      });
    }

    const response = await paddleApi.get(`/subscriptions/${user.subscriptionId}`);
    const managementUrl = response.data.data.management_urls.update_payment_method;
    
    return res.json({ managementUrl });
  } catch (error) {
    console.error('Error getting subscription management URL:', error);
    return res.status(500).json({ 
      message: 'Failed to get management URL',
      error: error.message
    });
  }
});

module.exports = router;