const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();
const bcrypt = require('bcrypt');
const auth = require('../middleware/auth');
const { sendSignUpEmail } = require('../controllers/quote-sender');
const { cancelSubscriptionEmail } = require('../controllers/user-controller');
// Near the top of the file
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing from environment variables!');
}

// Login route
router.post('/login', async (req, res) => {
  try {
    // Log request to help debug
    console.log('Login request received:', JSON.stringify(req.body.email));
    
    const { email, password } = req.body;
    
    // Check if all fields are provided
    if (!email || !password) {
      return res.status(400).json({ 
        message: 'Please provide both email and password',
        fields: {
          email: email ? 'provided' : 'missing',
          password: password ? 'provided' : 'missing'
        }
      });
    }
    
    // Find the user by email
    const user = await User.findOne({ email });
    
    // Check if user exists
    if (!user) {
      return res.status(401).json({ 
        message: 'Account not registered. Please sign up first.',
        error: 'invalid_credentials'
      });
    }
    
    // Validate password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ 
        message: 'Invalid credentials. Please check your email and password.',
        error: 'invalid_credentials'
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    
    // Return success with token and user data
    res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        preferredTime: user.preferredTime,
        timezone: user.timezone,
        quotesEnabled: user.quotesEnabled
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      message: 'Server error during login process',
      error: error.message
    });
  }
});



// Add this route to reset a user's password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Manually set and save password
    user.password = newPassword;
    await user.save();
    
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ message: 'Error resetting password', error: error.message });
  }
});

// Delete account route
router.post('/delete-account', auth, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate request
    if (!email || !password) {
      return res.status(400).json({ 
        message: 'Email and password are required to delete account'
      });
    }
    
    // Ensure user can only delete their own account
    if (email !== req.user.email) {
      return res.status(403).json({
        message: 'You can only delete your own account'
      });
    }
    
    // Find the user
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }
    
    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({
        message: 'Invalid password'
      });
    }

    // First cancel the subscription if it exists
    if (user.subscriptionId) {
      const cancelResponse = await fetch(`${process.env.PADDLE_API_URL}/subscriptions/${user.subscriptionId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`
        },
        body: JSON.stringify({
          effective_from: 'immediately'
        })
      });

      const data = await cancelResponse.json();
      
      if (!cancelResponse.ok) {
        console.error('Paddle API Error:', data);
        return res.status(500).json({
          message: 'Failed to cancel subscription. Please contact support if the issue persists.',
          error: data.error ? data.error.message : 'Unknown error occurred'
        });
      }

      if (!data.data || data.data.status !== 'canceled') {
        return res.status(500).json({
          message: 'Subscription cancellation failed. Please try again or contact support.',
          status: data.data ? data.data.status : 'unknown'
        });
      }
    }
    
    // After successful subscription cancellation, delete the user account
    await User.findByIdAndDelete(req.user.id);
    
    
    res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ message: 'Server error while deleting account' });
  }
});

// Add a new route to get user preferences
router.get('/preferences', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if the user has an active or valid subscription
    // Valid subscription statuses are 'active' or 'cancelled' (during grace period)
    if (!user.isPay || !user.quotesEnabled) {
      return res.status(403).json({ 
        message: 'Subscription required to access preferences',
        status: user.subscriptionStatus,
        code: 'subscription_required'
      });
    }
    
    console.log("Sending user preferences with ID:", userId);
    
    res.status(200).json({
      success: true,
      preferences: {
        _id: user._id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        preferredTime: user.preferredTime,
        timezone: user.timezone,
        quotesEnabled: user.quotesEnabled,
        cardBrand: user.cardBrand,
        cardLastFour: user.cardLastFour
      }
    });
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    res.status(500).json({ message: 'Server error while fetching preferences' });
  }
});

// Update user preferences
router.put('/preferences', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { preferredTime, timezone, quotesEnabled, first_name, last_name } = req.body;
    
    // Find user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if the user has an active or valid subscription
    // Valid subscription statuses are 'active' or 'cancelled' (during grace period)
    if (!user.isPay || (user.subscriptionStatus !== 'active' && user.subscriptionStatus !== 'cancelled')) {
      return res.status(403).json({ 
        message: 'Subscription required to update preferences',
        status: user.subscriptionStatus,
        code: 'subscription_required'
      });
    }
    
    // Update fields if provided
    if (first_name !== undefined) {
      user.first_name = first_name;
    }

    if (last_name !== undefined) {
      user.last_name = last_name;
    }

    
    if (preferredTime !== undefined) {
      // Validate time format
      if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(preferredTime)) {
        return res.status(400).json({ 
          message: 'Invalid time format. Please use HH:MM in 24-hour format.'
        });
      }
      user.preferredTime = preferredTime;
    }
    
    if (timezone !== undefined) {
      // Validate timezone
      try {
        Intl.DateTimeFormat(undefined, {timeZone: timezone});
        user.timezone = timezone;
      } catch (e) {
        return res.status(400).json({ 
          message: 'Invalid timezone. Please provide a valid IANA timezone string.'
        });
      }
    }
    
    if (quotesEnabled !== undefined) {
      user.quotesEnabled = !!quotesEnabled;
    }
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Preferences updated successfully',
      preferences: {
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        preferredTime: user.preferredTime,
        timezone: user.timezone,
        quotesEnabled: user.quotesEnabled
      }
    });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    res.status(500).json({ message: 'Server error while updating preferences' });
  }
});

// Add a token verification endpoint
router.get('/verify', auth, async (req, res) => {
  try {
    // Get user from database to ensure we have the most up-to-date data
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ isValid: false, message: 'User not found' });
    }
    
    // Check if registration is complete
    if (!user.isRegistrationComplete) {
      return res.status(403).json({
        isValid: true,
        registrationStatus: 'incomplete',
        message: 'Registration incomplete. Please complete payment to activate your account.',
        nextStep: 'payment'
      });
    }
    
    // Token is valid and registration is complete
    return res.json({
      isValid: true,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        isRegistrationComplete: user.isRegistrationComplete,
        isPaid: user.isPay,
        subscriptionStatus: user.subscriptionStatus || 'none'
      }
    });
  } catch (error) {
    console.error('Error verifying token:', error);
    return res.status(500).json({ isValid: false, message: 'Server error' });
  }
});

// Add this route to create a new user
router.post('/signup', async (req, res) => {
  try {
    const { email, password, first_name, last_name } = req.body;
    
    // Check if all fields are provided
    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({ 
        message: 'Please provide all required fields',
        fields: {
          email: email ? 'provided' : 'missing',
          password: password ? 'provided' : 'missing',
          first_name: first_name ? 'provided' : 'missing',
          last_name: last_name ? 'provided' : 'missing'
        }
      });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'User already exists' });
    }
    
    // Create new user
    const user = new User({
      email,
      password,
      first_name,
      last_name,
      lastCheckoutAttempt: {
        url: null,
        firstPaymentDate: null,
        nextPaymentDate: null,
        timestamp: null
      }
    });
    
    await user.save();
    
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Server error while creating user' });
  }
});

module.exports = router; 