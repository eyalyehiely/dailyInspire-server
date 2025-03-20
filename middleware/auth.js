const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    // Log the request headers for debugging
    console.log('Auth middleware: Headers received:', JSON.stringify(req.headers));
    
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    console.log('Auth middleware: Token extracted:', token ? 'Token found' : 'No token found');
    
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Auth middleware: Token verified, user ID:', decoded.id);
    
    // Find user with the id from token
    const user = await User.findById(decoded.id);
    
    if (!user) {
      console.log('Auth middleware: User not found with ID:', decoded.id);
      return res.status(401).json({ message: 'User not found' });
    }
    
    console.log('Auth middleware: User found, email:', user.email);
    
    // Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware: Error:', error.message);
    res.status(401).json({ message: 'Authentication failed' });
  }
};

module.exports = auth; 