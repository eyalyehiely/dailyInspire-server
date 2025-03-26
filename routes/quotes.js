const express = require('express');
const router = express.Router();
const { sendQuotesToAllUsers } = require('../controllers/quote-sender');
const User = require('../models/User')
const jwt = require('jsonwebtoken');
const { sendWelcomeEmail, sendEmailToOwner } = require('../controllers/user-controller');
// Add timezone validation utility
const isValidTimezone = (timezone) => {
  try {
    Intl.DateTimeFormat(undefined, {timeZone: timezone});
    return true;
  } catch (e) {
    return false;
  }
};

// POST: Manually trigger sending quotes to all users
router.post('/send', async (req, res) => {
  try {
    // Start the process async
    sendQuotesToAllUsers()
      .then(() => console.log('Manual quote sending completed'))
      .catch(err => console.error('Error in manual quote sending:', err));
    
    // Immediately return success response
    res.status(200).json({ 
      success: true, 
      message: 'Quote sending process started' 
    });
  } catch (error) {
    console.error('Error triggering quote send:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to start quote sending process' 
    });
  }
});

// Update signup route to accept timezone and preferred time
router.post('/signup', async (req, res) => {
  try {
    const { email, first_name, last_name, preferredTime, timeZone, password } = req.body;
    
    // More detailed logging
    console.log('Received signup request with data structure:');
    
    // Validate required fields
    if (!email || !first_name || !last_name || !password || !preferredTime || !timeZone) {
      console.log('Missing required fields');
      return res.status(400).json({ 
        message: 'Missing required fields', 
        missingFields: {
          email: !email,
          first_name: !first_name,
          last_name: !last_name,
          password: !password,
          preferredTime: !preferredTime,
          timeZone: !timeZone
        }
      });
    }
    let timezone=timeZone
    
    // Create a new user with all required fields and mark registration as incomplete
    const user = new User({
      email,
      first_name,
      last_name,
      preferredTime,
      timezone,
      password, // Make sure to include the password
      isRegistrationComplete: false, // Mark registration as incomplete until subscription
      quotesEnabled: false // Disable quotes until subscription is complete
    });
    
    console.log('Saving user with preferredTime:', preferredTime);
    
    await user.save();
    
    // Send notification email to owner about new signup
    try {
      await sendEmailToOwner(user);
      console.log('Owner notification email sent successfully');
    } catch (emailError) {
      console.error('Error sending owner notification email:', emailError);
      // Don't throw - we don't want to break the signup process if email fails
    }
    
    // Generate JWT token for auto-login
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Don't send welcome email until subscription is complete
    // We'll send it when the subscription_created webhook is received
    
    res.status(201).json({
      message: 'User created successfully. Please complete subscription to activate your account.',
      token,
      user: {
        id: user._id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        isRegistrationComplete: false
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'An error occurred during signup. Please try again.' });
  }
});

// Add a new route to update user preferences
router.post('/preferences', async (req, res) => {
  const { email, preferredTime, timezone } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Update preferred time if provided
    if (preferredTime !== undefined) {
      // Validate time format
      if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(preferredTime)) {
        return res.status(400).json({ 
          message: 'Invalid time format. Please use HH:MM in 24-hour format.'
        });
      }
      user.preferredTime = preferredTime;
    }

    // Update timezone if provided
    if (timezone !== undefined) {
      // Validate timezone
      if (!isValidTimezone(timezone)) {
        return res.status(400).json({ 
          message: 'Invalid timezone. Please provide a valid IANA timezone string.'
        });
      }
      user.timezone = timezone;
    }

    await user.save();
    
    res.status(200).json({ 
      message: 'User preferences updated successfully.',
      user: {
        email: user.email,
        preferredTime: user.preferredTime,
        timezone: user.timezone,
        quotesEnabled: user.quotesEnabled
      }
    });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
});

// Unsubscribe route
router.post('/unsubscribe', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }
  
  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    
    user.quotesEnabled = false;
    await user.save();
    
    res.status(200).json({ message: 'Successfully unsubscribed from daily quotes.' });
  } catch (error) {
    console.error('Error unsubscribing user:', error);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
});

// Resubscribe route
router.post('/resubscribe', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }
  
  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    
    user.quotesEnabled = true;
    await user.save();
    
    res.status(200).json({ message: 'Successfully resubscribed to daily quotes.' });
  } catch (error) {
    console.error('Error resubscribing user:', error);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
});

module.exports = router;