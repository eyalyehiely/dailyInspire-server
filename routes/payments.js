const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { 
  verifyWebhookSignature, 
  sendReceiptEmail, 
  processSuccessfulPayment,
  generateCheckoutUrl,
  verifySubscriptionStatus,
  paddleApi,
  generateClientToken
} = require('../controllers/paddle-controller');
const { sendWelcomeEmail } = require('../controllers/user-controller');
const subscriptionService = require('../services/subscriptionService');
const mongoose = require('mongoose');

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
      // let cardBrand = "";
      let cardLastFour = "";
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

// Webhook endpoint for Paddle to handle all subscription events
router.post('/webhook', async (req, res) => {
  try {
    console.log('===== WEBHOOK RECEIVED =====');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    
    // Get the raw body string
    const rawBody = req.rawBody;
    if (!rawBody) {
      console.error('Raw body not available');
      return res.status(400).json({ error: 'Raw body not available' });
    }
    
    // Verify webhook signature from Paddle
    const signature = req.headers['x-paddle-signature'];
    if (!signature) {
      console.error('Missing webhook signature');
      return res.status(401).json({ error: 'Missing signature' });
    }
    
    // Verify the signature with the raw body
    const isSignatureValid = verifyWebhookSignature(signature, rawBody);
    if (!isSignatureValid) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Use the parsed body if available, otherwise parse it
    let body = req.body;
    if (!body || Object.keys(body).length === 0) {
      try {
        body = JSON.parse(rawBody);
      } catch (error) {
        console.error('Failed to parse webhook body:', error);
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    
    console.log('Webhook body:', JSON.stringify(body, null, 2));
    
    const eventType = body.event_type;
    if (!eventType) {
      console.error('Missing event_type in webhook body');
      return res.status(400).json({ error: 'Missing event_type' });
    }
    
    console.log(`Processing webhook event: ${eventType}`);
    
    // Log the incoming webhook for debugging
    console.log(`Received Paddle webhook: ${eventType}`);
    console.log('Webhook data:', JSON.stringify(body, null, 2));
    
    // Add detailed customer data logging
    if (body.data?.customer) {
      console.log('===== CUSTOMER DATA RECEIVED =====');
      console.log('Customer ID:', body.data.customer.id);
      console.log('Customer Email:', body.data.customer.email);
      console.log('Customer Status:', body.data.customer.status);
      console.log('Customer Name:', body.data.customer.name);
      console.log('Customer Created At:', body.data.customer.created_at);
      console.log('Customer Updated At:', body.data.customer.updated_at);
      console.log('Marketing Consent:', body.data.customer.marketing_consent);
      console.log('Locale:', body.data.customer.locale);
      console.log('Custom Data:', body.data.customer.custom_data);
      console.log('================================');
    }
    
    // Extract user ID from custom data or find by email
    let userId = null;
    
    // Try to get user ID from custom data first
    if (body.data?.custom_data?.user_id) {
      userId = body.data.custom_data.user_id;
      console.log('Found user ID in custom data:', userId);
    }
    
    // If no user ID in custom data, try to find by email
    if (!userId && body.data?.customer_email) {
      const user = await User.findOne({ email: body.data.customer_email });
      if (user) {
        userId = user._id;
        console.log('Found user by email:', userId);
      }
    }
    
    if (!userId) {
      console.error('Could not find user ID from webhook data');
      return res.status(400).json({ error: 'Could not find user ID' });
    }
    
    // Handle different webhook events
    switch (eventType) {
      case 'subscription.created':
      case 'subscription.updated':
      case 'subscription.payment_succeeded':
      case 'checkout.completed':
        // When a new subscription is created or payment succeeds
        console.log(`Processing ${eventType} for user ${userId}`);
        
        // Extract subscription ID from various possible locations in the webhook data
        let subscriptionId;
        
        if (eventType === 'checkout.completed') {
          // For checkout.completed events, we need to get the subscription ID from the items array
          subscriptionId = body.data?.items?.[0]?.subscription_id;
          if (!subscriptionId) {
            console.error('Missing subscription ID in checkout.completed webhook data');
            console.log('Webhook data structure:', JSON.stringify(body, null, 2));
            return res.status(400).json({ error: 'Missing subscription ID in checkout data' });
          }
        } else {
          // For other subscription events
          subscriptionId = body.data?.subscription_id || 
                         body.data?.id || 
                         body.data?.attributes?.subscription_id ||
                         body.data?.attributes?.id;
          
          if (!subscriptionId) {
            console.error('Missing subscription ID in webhook data');
            console.log('Webhook data structure:', JSON.stringify(body, null, 2));
            return res.status(400).json({ error: 'Missing subscription ID' });
          }
        }
        
        // Use the subscription ID as is, without adding any prefix
        console.log(`Using subscription ID: ${subscriptionId}`);
        
        // Validate subscription ID format
        if (typeof subscriptionId !== 'string' || subscriptionId.trim().length === 0) {
          console.error('Invalid subscription ID format:', subscriptionId);
          return res.status(400).json({ error: 'Invalid subscription ID format' });
        }
        
        console.log('Processing payment with subscription ID:', subscriptionId);
        
        try {
          // Get subscription data from Paddle
          const paddleSubscription = await subscriptionService.getSubscription(subscriptionId);
          console.log('Subscription data from Paddle:', paddleSubscription);
          
          // Sync subscription data to our database
          const subscription = await subscriptionService.syncSubscription(paddleSubscription, userId);
          console.log('Synced subscription:', subscription);
          
          // Send welcome email if this is a new subscription
          if (eventType === 'subscription.created' || eventType === 'checkout.completed') {
            console.log(`Sending welcome email for ${eventType} event to user ${userId}`);
            const user = await User.findById(userId);
            if (user) {
              try {
                await sendWelcomeEmail(user);
                console.log(`Welcome email successfully sent to ${user.email}`);
              } catch (emailError) {
                console.error(`Failed to send welcome email to ${user.email}:`, emailError);
                // Continue processing even if email fails
              }
            } else {
              console.error(`User not found for ID ${userId}, cannot send welcome email`);
            }
          }
          
          // Send receipt email for successful payments
          if (eventType === 'subscription.payment_succeeded' || eventType === 'checkout.completed') {
            console.log(`Sending receipt email for ${eventType} event to user ${userId}`);
            const user = await User.findById(userId);
            if (user) {
              try {
                await sendReceiptEmail(user, {
                  orderId: subscriptionId
                });
                console.log(`Receipt email successfully sent to ${user.email}`);
              } catch (emailError) {
                console.error(`Failed to send receipt email to ${user.email}:`, emailError);
                // Continue processing even if email fails
              }
            } else {
              console.error(`User not found for ID ${userId}, cannot send receipt email`);
            }
          }
          
          console.log(`Successfully processed payment for user: ${user?.email}`);
          return res.status(200).json({ 
            success: true,
            message: 'Payment processed successfully',
            user: {
              id: user?._id,
              email: user?.email,
              isPay: user?.isPay,
              subscriptionStatus: user?.subscriptionStatus,
              quotesEnabled: user?.quotesEnabled
            }
          });
        } catch (error) {
          console.error('Error processing payment:', error);
          console.error('Error stack:', error.stack);
          return res.status(500).json({ 
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
          });
        }
        
      case 'subscription.cancelled':
        // When a subscription is cancelled
        console.log(`Processing subscription cancellation for user ${userId}`);
        
        const canceledSubscriptionId = body.data?.subscription_id || 
                                      body.data?.id || 
                                      body.data?.attributes?.subscription_id ||
                                      body.data?.attributes?.id;
        
        if (canceledSubscriptionId) {
          try {
            // Cancel subscription in Paddle and sync to our database
            await subscriptionService.cancelSubscription(canceledSubscriptionId);
            console.log(`Subscription cancelled for user ${userId}`);
          } catch (error) {
            console.error('Error canceling subscription:', error);
          }
        } else {
          // Fallback to updating user directly if we can't find the subscription ID
          await User.findByIdAndUpdate(userId, { 
            subscriptionStatus: 'cancelled',
            quotesEnabled: false,
            isPay: false
          });
          console.log(`Subscription cancelled for user ${userId} (fallback method)`);
        }
        break;
        
      case 'subscription.paused':
        // When a subscription is paused
        console.log(`Processing subscription pause for user ${userId}`);
        
        const pausedSubscriptionId = body.data?.subscription_id || 
                                    body.data?.id || 
                                    body.data?.attributes?.subscription_id ||
                                    body.data?.attributes?.id;
        
        if (pausedSubscriptionId) {
          try {
            // Pause subscription in Paddle and sync to our database
            await subscriptionService.pauseSubscription(pausedSubscriptionId);
            console.log(`Subscription paused for user ${userId}`);
          } catch (error) {
            console.error('Error pausing subscription:', error);
          }
        } else {
          // Fallback to updating user directly if we can't find the subscription ID
          await User.findByIdAndUpdate(userId, { 
            subscriptionStatus: 'paused',
            quotesEnabled: false,
            isPay: false
          });
          console.log(`Subscription paused for user ${userId} (fallback method)`);
        }
        break;
        
      case 'subscription.resumed':
        // When a subscription is resumed
        console.log(`Processing subscription resume for user ${userId}`);
        
        const resumedSubscriptionId = body.data?.subscription_id || 
                                     body.data?.id || 
                                     body.data?.attributes?.subscription_id ||
                                     body.data?.attributes?.id;
        
        if (resumedSubscriptionId) {
          try {
            // Resume subscription in Paddle and sync to our database
            await subscriptionService.resumeSubscription(resumedSubscriptionId);
            console.log(`Subscription resumed for user ${userId}`);
          } catch (error) {
            console.error('Error resuming subscription:', error);
          }
        } else {
          // Fallback to updating user directly if we can't find the subscription ID
          await User.findByIdAndUpdate(userId, { 
            subscriptionStatus: 'active',
            quotesEnabled: true,
            isPay: true
          });
          console.log(`Subscription resumed for user ${userId} (fallback method)`);
        }
        break;
        
      default:
        console.log(`Unhandled webhook event: ${eventType}`);
    }
    
    // Verify the update was successful
    const finalUser = await User.findById(userId);
    console.log('Final user status:', {
      email: finalUser.email,
      isPay: finalUser.isPay,
      subscriptionStatus: finalUser.subscriptionStatus,
      quotesEnabled: finalUser.quotesEnabled,
      subscriptionId: finalUser.subscriptionId,
      paymentUpdatedAt: finalUser.paymentUpdatedAt
    });
    
    console.log(`Webhook processed successfully for event: ${eventType}`);
    return res.status(200).json({ received: true, status: 'processed' });
  } catch (error) {
    console.error('Webhook error:', error);
    console.error('Error stack:', error.stack);
    return res.status(200).json({ message: 'Webhook error', error: error.message });
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
    const activeSubscription = await subscriptionService.getActiveSubscription(req.user.id);
    
    // If user has a subscription ID, fetch details from Paddle API
    let cardBrand = "";
    let cardLastFour = "";
    let customerPortalUrl = "";
    let cancelSubscriptionUrl = "";
    let subscriptionDetails = null;
    let paddleError = null;
    
    if (activeSubscription) {
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
      cardBrand,
      cardLastFour,
      customerPortalUrl,
      cancelSubscriptionUrl,
      subscriptionDetails,
      paymentUpdatedAt: user.paymentUpdatedAt,
      error: paddleError
    };
    
    console.log('Sending payment status response:', JSON.stringify(response, null, 2));
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

// Raw webhook debug endpoint - logs all incoming webhook data without verification
router.post('/webhook-debug', async (req, res) => {
  try {
    console.log('===== WEBHOOK DEBUG ENDPOINT TRIGGERED =====');
    
    const fs = require('fs');
    const path = require('path');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(__dirname, '../logs');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Extract any potential user IDs from the data for easier debugging
    let possibleUserIds = [];
    const body = req.body;
    
    // Look in common places for user IDs
    if (body?.data?.attributes?.custom_data?.user_id) {
      possibleUserIds.push(body.data.attributes.custom_data.user_id);
    }
    if (body?.meta?.custom_data?.user_id) {
      possibleUserIds.push(body.meta.custom_data.user_id);
    }
    if (req.query.user_id) {
      possibleUserIds.push(req.query.user_id);
    }
    
    // Log the raw headers and body
    const logData = {
      timestamp: new Date().toISOString(),
      possibleUserIds,
      headers: req.headers,
      body: req.body,
      query: req.query
    };
    
    // Write to file
    const logPath = path.join(logDir, `webhook-debug-${timestamp}.json`);
    fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
    
    console.log(`Webhook debug data saved to ${logPath}`);
    console.log('Possible User IDs:', possibleUserIds);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    // Try to process this webhook data through the normal webhook handler logic
    if (body.meta?.event_name && possibleUserIds.length > 0) {
      console.log('Attempting to process webhook data...');
      
      // Try each user ID until one works
      for (const userId of possibleUserIds) {
        try {
          if (!mongoose.Types.ObjectId.isValid(userId)) {
            console.log(`Invalid user ID format: ${userId}, skipping`);
            continue;
          }
          
          const user = await User.findById(userId);
          if (!user) {
            console.log(`User not found with ID: ${userId}, skipping`);
            continue;
          }
          
          console.log(`Found user: ${user.email} with ID: ${userId}`);
          
          // Process the webhook based on event type
          const eventName = body.meta.event_name;
          
          if (eventName === 'subscription_created' || eventName === 'order_created') {
            const updatedUser = await processSuccessfulPayment(userId, body.data?.id || 'debug-webhook');
            console.log(`Successfully processed payment for user: ${updatedUser.email}`);
          }
          
          break; // Exit loop once a valid user is processed
        } catch (err) {
          console.error(`Error processing user ${userId}:`, err);
        }
      }
    }
    
    // Always respond with success
    return res.status(200).json({ 
      received: true, 
      status: 'debug_logged',
      possibleUserIds
    });
  } catch (error) {
    console.error('Webhook debug error:', error);
    return res.status(200).json({ received: true, error: error.message }); // Still return 200 to avoid retries
  }
});

// Debug endpoint to check a user's payment status (for admin debugging only)
router.get('/debug-user-status', async (req, res) => {
  try {
    const { email, userId } = req.query;
    
    if (!email && !userId) {
      return res.status(400).json({ error: 'Please provide either email or userId query parameter' });
    }
    
    let user;
    
    if (email) {
      user = await User.findOne({ email });
    } else if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      user = await User.findById(userId);
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Return user payment information
    return res.json({
      id: user._id.toString(),
      email: user.email,
      name: `${user.first_name} ${user.last_name}`,
      isPay: user.isPay,
      isRegistrationComplete: user.isRegistrationComplete,
      quotesEnabled: user.quotesEnabled,
      subscriptionStatus: user.subscriptionStatus || 'none',
      subscriptionId: user.subscriptionId || 'none',
      paymentUpdatedAt: user.paymentUpdatedAt || 'never'
    });
  } catch (error) {
    console.error('Error in debug-user-status endpoint:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Admin endpoint to manually upgrade a user (should be behind admin auth in production)
router.post('/admin/force-upgrade', async (req, res) => {
  try {
    const { email, userId } = req.body;
    
    if (!email && !userId) {
      return res.status(400).json({ error: 'Please provide either email or userId in the request body' });
    }
    
    let user;
    
    if (email) {
      user = await User.findOne({ email });
    } else if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      user = await User.findById(userId);
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Process the upgrade
    const subscriptionId = `admin-upgrade-${Date.now()}`;
    const updatedUser = await processSuccessfulPayment(user._id.toString(), subscriptionId);
    
    // Return upgraded user information
    return res.json({
      success: true,
      message: `User ${updatedUser.email} has been upgraded to paid status`,
      user: {
        id: updatedUser._id.toString(),
        email: updatedUser.email,
        name: `${updatedUser.first_name} ${updatedUser.last_name}`,
        isPay: updatedUser.isPay,
        subscriptionStatus: updatedUser.subscriptionStatus
      }
    });
  } catch (error) {
    console.error('Error in force-upgrade endpoint:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Route to update user payment data
router.post('/update-user-data', auth, async (req, res) => {
  try {
    const { subscriptionId, subscriptionStatus, cardBrand, cardLastFour, firstPaymentDate, nextPaymentDate } = req.body;
    
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
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
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
      },
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
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
    
    if (!req.params.transactionId) {
      console.error('No transaction ID provided');
      return res.status(400).json({ 
        message: 'Transaction ID is required',
        error: 'No transaction ID provided'
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
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        subscriptionId: subscriptionId,
        subscriptionStatus: 'active',
        isPay: true,
        quotesEnabled: true,
        isRegistrationComplete: true,
        paymentUpdatedAt: new Date()
      },
      { new: true }
    );
    
    if (!user) {
      console.error('User not found:', req.user.id);
      return res.status(404).json({ 
        message: 'User not found',
        error: 'User not found in database'
      });
    }
    
    console.log('User subscription updated successfully');
    
    return res.json({
      success: true,
      message: 'Transaction verified successfully',
      transaction: transaction,
      user: {
        id: user._id,
        email: user.email,
        isPay: user.isPay,
        subscriptionStatus: user.subscriptionStatus,
        quotesEnabled: user.quotesEnabled
      }
    });
  } catch (error) {
    console.error('Error verifying transaction:', error);
    return res.status(500).json({ 
      message: 'Server error', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});


module.exports = router;