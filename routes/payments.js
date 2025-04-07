const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { Paddle, EventName } = require('@paddle/paddle-node-sdk');
const { 
  processSuccessfulPayment,
  paddleApi,
} = require('../controllers/paddle-controller');
const { sendWelcomeEmail, sendPaymentFailedEmail, cancelSubscriptionEmail, sendPaymentMethodUpdatedEmail } = require('../controllers/user-controller');
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

// Create a `POST` endpoint to accept webhooks sent by Paddle.
router.post('/webhook', async (req, res) => {
    console.log('\n===== NEW WEBHOOK RECEIVED =====');
    
    const signature = req.headers['paddle-signature'];
    const rawRequestBody = req.body;
    const secretKey = process.env.PADDLE_WEBHOOK_SECRET;

      try {
        if (signature && rawRequestBody) {
          // The `unmarshal` function will validate the integrity of the webhook and return an entity
          const eventData = await paddle.webhooks.unmarshal(rawRequestBody, secretKey, signature);
          const userId = eventData.data?.customData?.user_id;
          const customerId = eventData.data?.customerId;
          console.log('User ID:', userId);
          console.log('Event Data:', JSON.stringify(eventData, null, 2));

          switch (eventData.eventType) {
    // Activate subscription
            case EventName.SubscriptionActivated:
              console.log(`Subscription ${eventData.data.id} was activated`);
              try {
                // Check if user's subscription is already active
                const user = await User.findById(userId);
                if (!user) {
                  console.error('User not found for ID:', userId);
                  return res.status(404).json({ error: 'User not found' });
                }

                // Only send welcome email if subscription wasn't already active
                if (user.subscriptionStatus !== 'active') {
                  console.log('Sending welcome email to:', userId);
                  await sendWelcomeEmail(userId);
                } else {
                  console.log('Welcome email already sent for user:', userId);
                }
              } catch (error) {
                console.error('Error sending welcome email:', error);
                // Don't fail the webhook for email errors
              }
              break;

// PaymentMethodSaved
            case EventName.PaymentMethodSaved:
              console.log(`Payment method saved for user: ${userId}`);
              console.log(`Subscription ${eventData.data.id} payment method updated`);
              try {

                const user = await User.findById(userId);
                if (!user) {
                  console.error('❌ User not found for ID:', userId);
                  return res.status(404).json({ error: 'User not found' });
                }

                const response = await fetch(`${process.env.PADDLE_API_URL}/customers/${customerId}/payment-methods`, {
                  method: 'GET',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`
                  }
                });

                if (!response.ok) {
                  throw new Error(`Paddle API error: ${response.status} ${response.statusText}`);
                }

                const responseData = await response.json();
                console.log('Paddle API response:', JSON.stringify(responseData, null, 2));

                // Get the first payment method (usually the most recent)
                const paymentMethod = responseData.data[0];
                if (!paymentMethod || !paymentMethod.card) {
                  throw new Error('No card payment method found');
                }

                // Update user with new payment method details
                const updateData = {
                  cardBrand: paymentMethod.card.type,
                  cardLastFour: paymentMethod.card.last4,
                  quotesEnabled: true,
                  isPay: true,
                  subscriptionStatus: 'active',
                  paymentUpdatedAt: new Date()
                };

                const updatedUser = await User.findByIdAndUpdate(
                  userId,
                  updateData,
                  { new: true }
                );

                if (!updatedUser) {
                  throw new Error('Failed to update user payment details');
                }

                console.log('✅ User card details updated successfully');
                await sendPaymentMethodUpdatedEmail(userId);
                return res.status(200).json({ success: true });
              } catch (error) {
                console.error('❌ Error processing payment method update:', error);
                console.error('Error stack:', error.stack);
                return res.status(500).json({ error: 'Failed to process payment method update' });
              }
              break;

    // Cancel subscription
            case EventName.SubscriptionCanceled:
              console.log(`Subscription ${eventData.data.id} was cancelled`);
              console.log('\n===== PROCESSING SUBSCRIPTION CANCELLED =====');
              try {
                console.log('Customer ID from webhook:', userId);
                console.log('Webhook Customer Data:', JSON.stringify(eventData.data?.customer, null, 2));
                
                if (!userId) {
                  console.error('❌ No customer ID found in webhook data');
                  return res.status(400).json({ error: 'No customer ID found' });
                }

                const user = await User.findOne({ _id: userId });
                console.log('User Found:', user ? 'Yes' : 'No');
                console.log('User Details:', {
                  id: user?._id,
                  email: user?.email,
                  isPay: user?.isPay,
                  subscriptionStatus: user?.subscriptionStatus
                });
                
                if (!user) {
                  console.error('❌ User not found for ID:', userId);
                  return res.status(404).json({ error: 'User not found' });
                }

                // Get subscription details from the webhook payload
                const subscriptionData = eventData.data;
                const billingPeriodEnd = user.lastCheckoutAttempt?.nextPaymentDate;
                
                if (!billingPeriodEnd || !(billingPeriodEnd instanceof Date) || isNaN(billingPeriodEnd.getTime())) {
                  console.error('Invalid or missing billing period end date:', billingPeriodEnd);
                  return res.status(400).json({ error: 'Invalid billing period end date' });
                }

                // Check if this is an immediate cancellation or end-of-billing-period cancellation
                const isImmediateCancellation = subscriptionData.scheduled_change === null;
                console.log('Cancellation type:', isImmediateCancellation ? 'Immediate' : 'End of billing period');

                if (isImmediateCancellation) {
                  // Immediate cancellation - revoke access now
                  const updateData = {
                    subscriptionStatus: 'canceled',
                    isPay: false,
                    quotesEnabled: false,
                    paymentUpdatedAt: new Date(),
                    canceledAt: new Date()
                  };
                  console.log('Updating user with data for immediate cancellation:', updateData);

                  const updatedUser = await User.findByIdAndUpdate(user._id, updateData, { new: true });
                  console.log('✅ User updated successfully for immediate cancellation');
                  console.log('Updated User Status:', {
                    isPay: updatedUser.isPay,
                    subscriptionStatus: updatedUser.subscriptionStatus,
                    email: updatedUser.email
                  });
                } else {
                  // End of billing period cancellation - maintain access until the end date
                  console.log('Subscription cancelled but maintaining access until end of billing period:', billingPeriodEnd);
                  const updateData = {
                    subscriptionStatus: 'canceled',
                    canceledAt: new Date(),
                    billingPeriodEnd,
                    // Keep isPay and quotesEnabled as true until the billing period ends
                    isPay: true,
                    quotesEnabled: true
                  };
                  await User.findByIdAndUpdate(user._id, updateData);

                  // Send cancellation email with the appropriate end date
                  await cancelSubscriptionEmail(userId, billingPeriodEnd);
                }

                return res.status(200).json({ 
                  success: true, 
                  message: 'Subscription cancelled successfully',
                  user: {
                    id: user._id,
                    email: user.email,
                    subscriptionStatus: user.subscriptionStatus,
                    accessEndsAt: billingPeriodEnd,
                    isImmediateCancellation
                  }
                });
              } catch (error) {
                console.error('❌ Error processing subscription cancellation:', error);
                console.error('Error stack:', error.stack);
                return res.status(500).json({ error: 'Failed to process subscription cancellation' });
              }
              break;

      // TransactionPaymentFailed
            case EventName.TransactionPaymentFailed:
              console.log(`Transaction ${eventData.data.id} payment failed`);
              try {
                const userId = eventData.data?.customData?.user_id;
                await sendPaymentFailedEmail(userId);
              } catch (error) {
                console.error('❌ Error processing transaction payment failure:', error);
                console.error('Error stack:', error.stack);
                return res.status(500).json({ error: 'Failed to process transaction payment failure' });
              }
              break;
            
            default:
              console.log(`Unknown event type: ${eventData.eventType}`);
          }
        } else {
          console.log('❌ No signature or body found in webhook request');
          
        }
      } catch (error) {
        console.error('❌ Error in webhook route:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
      return res.status(200).json({ ok: true });
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
        cardBrand: req.query.cardBrand,
        cardLastFour: req.query.cardLastFour,
        quotesEnabled: true,
        isRegistrationComplete: true,
        paymentUpdatedAt: new Date()
      },
      { new: true }
    );
    
    if (!user) {
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
        id: user._id,
        email: user.email,
        isPay: user.isPay,
        subscriptionStatus: user.subscriptionStatus,
        quotesEnabled: user.quotesEnabled,
        isRegistrationComplete: user.isRegistrationComplete,
        cardBrand: user.cardBrand,
        cardLastFour: user.cardLastFour
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