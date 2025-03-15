const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const axios = require('axios');

// Route to get payment page information
router.get('/checkout-info', auth, async (req, res) => {
  try {
    // Check if user is already paid
    const user = await User.findById(req.user.id);
    if (user.isPay) {
      return res.json({ isPaid: true, message: 'You already have premium access' });
    }
    
    // Return checkout information
    return res.json({
      isPaid: false,
      checkoutUrl: process.env.LEMON_SQUEEZY_CHECKOUT_URL,
      userId: req.user.id
    });
  } catch (error) {
    console.error('Error getting checkout info:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Webhook endpoint for LemonSqueezy to notify about successful payments
router.post('/webhook', async (req, res) => {
  try {
    const { body } = req;
    
    // Verify webhook signature (implementation depends on LemonSqueezy's requirements)
    // This is a simple example - in production you should verify the webhook signature
    
    // Check if this is a payment success event
    if (body.meta && body.meta.event_name === 'order_created') {
      const orderData = body.data;
      
      // Extract the user ID from custom data (you'll need to pass this from your checkout page)
      const userId = orderData.attributes.custom_data?.user_id;
      
      if (userId) {
        // Update user's payment status
        await User.findByIdAndUpdate(userId, { isPay: true });
        console.log(`User ${userId} payment status updated to paid`);
      }
    }
    
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(400).json({ message: 'Webhook error' });
  }
});

// Route to check payment status
router.get('/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    return res.json({ isPaid: user.isPay });
  } catch (error) {
    console.error('Error checking payment status:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 