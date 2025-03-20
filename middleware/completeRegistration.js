const User = require('../models/User');

/**
 * Middleware to check if a user has completed registration through subscription
 * This should be used after the auth middleware
 */
const completeRegistration = async (req, res, next) => {
  try {
    // Auth middleware should have already attached the user to the request
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    // Get fresh user data to ensure we have the latest isRegistrationComplete status
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    // Check if registration is complete
    if (!user.isRegistrationComplete) {
      return res.status(403).json({ 
        message: 'Account setup incomplete',
        registrationStatus: 'incomplete',
        nextStep: 'subscription',
        redirectTo: '/payment'
      });
    }
    
    // Registration is complete, proceed
    next();
  } catch (error) {
    console.error('Error in completeRegistration middleware:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = completeRegistration; 