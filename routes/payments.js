const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { Paddle, EventName } = require('@paddle/paddle-node-sdk');
const { 
  processSuccessfulPayment,
  paddleApi,
} = require('../controllers/paddle-controller');
const { sendWelcomeEmail, sendPaymentFailedEmail } = require('../controllers/user-controller');
const subscriptionService = require('../services/subscriptionService');
const mongoose = require('mongoose');

// Initialize Paddle SDK
const paddle = new Paddle(process.env.PADDLE_API_KEY);

// Paddle webhook IP addresses
const PADDLE_WEBHOOK_IPS = {
  sandbox: [
    '34.194.127.46',
    '54.234.237.108',
    '3.208.120.145',
    '44.226.236.210',
    '44.241.183.62',
    '100.20.172.113'
  ],
  live: [
    '34.232.58.13',
    '34.195.105.136',
    '34.237.3.244',
    '35.155.119.135',
    '52.11.166.252',
    '34.212.5.7'
  ]
};

// Middleware to verify Paddle IP
const verifyPaddleIP = (req, res, next) => {
  const clientIP = req.ip;
  const isSandbox = process.env.NODE_ENV === 'development';
  const allowedIPs = isSandbox ? PADDLE_WEBHOOK_IPS.sandbox : PADDLE_WEBHOOK_IPS.live;
  
  if (!allowedIPs.includes(clientIP)) {
    console.error('❌ Unauthorized IP:', clientIP);
    return res.status(403).json({ error: 'Unauthorized IP address' });
  }
  next();
};

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
router.post('/webhooks', verifyPaddleIP, express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('\n===== NEW WEBHOOK RECEIVED =====');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  try {
    // Get the signature from the Paddle-Signature header
    const signature = req.headers['paddle-signature'];
    if (!signature) {
      console.error('❌ Missing Paddle-Signature header');
      return res.status(400).json({ error: 'Missing Paddle-Signature header' });
    }

    // Get the raw request body
    const rawRequestBody = req.body.toString();
    if (!rawRequestBody) {
      console.error('❌ Missing request body');
      return res.status(400).json({ error: 'Missing request body' });
    }

    // Get the webhook secret from environment variables
    const secretKey = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secretKey) {
      console.error('❌ Missing PADDLE_WEBHOOK_SECRET environment variable');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
      // Verify the webhook signature using Paddle's SDK
      const eventData = await paddle.webhooks.unmarshal(rawRequestBody, secretKey, signature);
      console.log('✅ Webhook signature verified successfully');
      console.log('Event Type:', eventData.eventType);
      console.log('Full Event Data:', JSON.stringify(eventData, null, 2));
      
      // Immediately respond with 200 to acknowledge receipt
      res.status(200).json({ received: true });
      
      // Process the webhook event asynchronously
      process.nextTick(async () => {
        try {
          // Process the webhook event based on its type
          switch (eventData.eventType) {
            case EventName.CheckoutCompleted:
              console.log('\n===== PROCESSING CHECKOUT COMPLETED =====');
              try {
                const customerEmail = eventData.data?.customer?.email || eventData.data?.customer_email;
                console.log('Customer Email from webhook:', customerEmail);
                console.log('Webhook Customer Data:', JSON.stringify(eventData.data?.customer, null, 2));
                
                if (!customerEmail) {
                  console.error('❌ No customer email found in webhook data');
                  return res.status(400).json({ error: 'No customer email found' });
                }

                const user = await User.findOne({ email: customerEmail });
                console.log('User Found:', user ? 'Yes' : 'No');
                console.log('User Details:', {
                  id: user?._id,
                  email: user?.email,
                  isPay: user?.isPay,
                  subscriptionStatus: user?.subscriptionStatus
                });
                
                if (!user) {
                  console.error('❌ User not found for email:', customerEmail);
                  return res.status(404).json({ error: 'User not found' });
                }

                const updateData = {
                  subscriptionStatus: 'active',
                  isPay: true,
                  quotesEnabled: true,
                  paymentUpdatedAt: new Date(),
                  subscriptionId: eventData.data?.subscription_id || eventData.data?.id
                };
                console.log('Updating user with data:', updateData);

                const updatedUser = await User.findByIdAndUpdate(user._id, updateData, { new: true });
                console.log('✅ User updated successfully');
                console.log('Updated User Status:', {
                  isPay: updatedUser.isPay,
                  subscriptionStatus: updatedUser.subscriptionStatus,
                  email: updatedUser.email
                });

                console.log('\n===== ATTEMPTING TO SEND WELCOME EMAIL =====');
                console.log('Email Configuration:', {
                  from: process.env.EMAIL_FROM,
                  to: updatedUser.email,
                  subject: 'Welcome to DailyInspire'
                });

                try {
                  await sendWelcomeEmail(updatedUser);
                  console.log('✅ Welcome email sent successfully to:', updatedUser.email);
                } catch (emailError) {
                  console.error('❌ Error sending welcome email:', emailError);
                  console.error('Email Error Stack:', emailError.stack);
                  console.error('Email Configuration:', {
                    from: process.env.EMAIL_FROM,
                    to: updatedUser.email,
                    subject: 'Welcome to DailyInspire'
                  });
                }
              } catch (error) {
                console.error('❌ Error processing checkout completed:', error);
                console.error('Error stack:', error.stack);
              }
              break;

            case EventName.SubscriptionPaymentSucceeded:
              console.log('\n===== PROCESSING SUBSCRIPTION PAYMENT SUCCEEDED =====');
              try {
                const customerEmail = eventData.data?.customer?.email || eventData.data?.customer_email;
                console.log('Customer Email:', customerEmail);
                
                if (!customerEmail) {
                  console.error('❌ No customer email found in webhook data');
                  return res.status(400).json({ error: 'No customer email found' });
                }

                const user = await User.findOne({ email: customerEmail });
                console.log('User Found:', user ? 'Yes' : 'No');
                console.log('Current User Status:', {
                  isPay: user?.isPay,
                  subscriptionStatus: user?.subscriptionStatus
                });
                
                if (!user) {
                  console.error('❌ User not found for email:', customerEmail);
                  return res.status(404).json({ error: 'User not found' });
                }

                const updateData = {
                  subscriptionStatus: 'active',
                  isPay: true,
                  quotesEnabled: true,
                  paymentUpdatedAt: new Date(),
                  subscriptionId: eventData.data?.subscription_id || eventData.data?.id
                };
                console.log('Updating user with data:', updateData);

                const updatedUser = await User.findByIdAndUpdate(user._id, updateData, { new: true });
                console.log('✅ User updated successfully');
                console.log('Updated User Status:', {
                  isPay: updatedUser.isPay,
                  subscriptionStatus: updatedUser.subscriptionStatus
                });

                if (!user.isPay) {
                  console.log('First payment detected, sending welcome email...');
                  try {
                    await sendWelcomeEmail(updatedUser);
                    console.log('✅ Welcome email sent successfully');
                  } catch (emailError) {
                    console.error('❌ Error sending welcome email:', emailError);
                    console.error('Email Error Stack:', emailError.stack);
                    // Don't fail the webhook for email errors
                  }
                } else {
                  console.log('Not first payment, skipping welcome email');
                }
              } catch (error) {
                console.error('❌ Error processing subscription payment succeeded:', error);
                console.error('Error stack:', error.stack);
              }
              break;

            case EventName.SubscriptionCanceled:
              console.log('\n===== PROCESSING SUBSCRIPTION CANCELLED =====');
              try {
                const customerEmail = eventData.data?.customer?.email || eventData.data?.customer_email;
                console.log('Customer Email from webhook:', customerEmail);
                console.log('Webhook Customer Data:', JSON.stringify(eventData.data?.customer, null, 2));
                
                if (!customerEmail) {
                  console.error('❌ No customer email found in webhook data');
                  return res.status(400).json({ error: 'No customer email found' });
                }

                const user = await User.findOne({ email: customerEmail });
                console.log('User Found:', user ? 'Yes' : 'No');
                console.log('User Details:', {
                  id: user?._id,
                  email: user?.email,
                  isPay: user?.isPay,
                  subscriptionStatus: user?.subscriptionStatus
                });
                
                if (!user) {
                  console.error('❌ User not found for email:', customerEmail);
                  return res.status(404).json({ error: 'User not found' });
                }

                const updateData = {
                  subscriptionStatus: 'canceled',
                  isPay: false,
                  quotesEnabled: false,
                  paymentUpdatedAt: new Date(),
                  canceledAt: new Date()
                };
                console.log('Updating user with data:', updateData);

                const updatedUser = await User.findByIdAndUpdate(user._id, updateData, { new: true });
                console.log('✅ User updated successfully');
                console.log('Updated User Status:', {
                  isPay: updatedUser.isPay,
                  subscriptionStatus: updatedUser.subscriptionStatus,
                  email: updatedUser.email
                });

                return res.status(200).json({ 
                  success: true, 
                  message: 'Subscription cancelled successfully',
                  user: {
                    id: updatedUser._id,
                    email: updatedUser.email,
                    subscriptionStatus: updatedUser.subscriptionStatus
                  }
                });
              } catch (error) {
                console.error('❌ Error processing subscription cancellation:', error);
                console.error('Error stack:', error.stack);
                return res.status(500).json({ error: 'Failed to process subscription cancellation' });
              }
              break;

            case EventName.ProductUpdated:
              console.log(`Product ${eventData.data.id} was updated`);
              break;

            case EventName.SubscriptionUpdated:
              console.log(`Subscription ${eventData.data.id} was updated`);
              break;

            case EventName.SubscriptionCreated:
              console.log(`Subscription ${eventData.data.id} was created`);
              break;

            case EventName.SubscriptionPaused:
              console.log(`Subscription ${eventData.data.id} was paused`);
              break;

            case EventName.SubscriptionResumed:
              console.log(`Subscription ${eventData.data.id} was resumed`);
              break;

            case EventName.CheckoutUpdated:
              console.log(`Checkout ${eventData.data.id} was updated`);
              break;

            case EventName.CheckoutPaymentFailed:
              console.log(`Checkout ${eventData.data.id} payment failed`);
              try {
                await sendPaymentFailedEmail(eventData.data.customer_email);
              } catch (error) {
                console.error('Error sending payment failed email:', error);
                // Don't fail the webhook for email errors
              }
              break;

            case EventName.CheckoutPaymentSucceeded:
              console.log(`Checkout ${eventData.data.id} payment succeeded`);
              break;

            case EventName.CheckoutPaymentUpdated:
              console.log(`Checkout ${eventData.data.id} payment updated`);
              try {
                await User.findByIdAndUpdate(eventData.data.customer_email, {
                  paymentUpdatedAt: new Date(),
                  subscriptionStatus: 'active',
                  isPay: true,
                  quotesEnabled: true,
                  nextPaymentDate: eventData.data.next_payment_date,
                  subscriptionId: eventData.data.subscription_id,
                  cardBrand: eventData.data.payments[0].card_brand,
                  cardLastFour: eventData.data.payments[0].card_last4
                });
              } catch (error) {
                console.error('Error updating user payment details:', error);
                return res.status(500).json({ error: 'Failed to update user payment details' });
              }
              break;

            case EventName.CheckoutPaymentDisputed:
              console.log(`Checkout ${eventData.data.id} payment disputed`);
              break;

            case EventName.CheckoutPaymentDisputeUpdated:
              console.log(`Checkout ${eventData.data.id} payment dispute updated`);
              break;

            case EventName.TransactionPaid:
              console.log(`Transaction ${eventData.data.id} was paid`);
              try {
                await sendWelcomeEmail(eventData.data.customer_email);
              } catch (error) {
                console.error('Error sending welcome email:', error);
                // Don't fail the webhook for email errors
              }
              break;

            default:
              console.log(`Unhandled event type: ${eventData.eventType}`);
          }
        } catch (error) {
          console.error('❌ Error processing webhook asynchronously:', error);
          // Log the error but don't retry since we already responded
        }
      });
    } catch (error) {
      console.error('❌ Webhook signature verification failed:', error.message);
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }
  } catch (error) {
    console.error('❌ Unexpected error processing webhook:', error);
    return res.status(500).json({ error: 'Internal server error' });
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