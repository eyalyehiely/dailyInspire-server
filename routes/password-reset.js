const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Route to request password reset - creates token without sending email (development version)
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    // Find user with this email
    const user = await User.findOne({ email });
    
    // Even if no user is found, we return success for security reasons
    // This prevents email enumeration attacks
    if (!user) {
      return res.status(200).json({ 
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }
    
    // Generate token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = Date.now() + 3600000; // 1 hour from now
    
    // Update user with reset token
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpires;
    await user.save();
    
    // Create reset URL (for reference only in development)
    const clientURL = process.env.CLIENT_URL || 'http://localhost:5173';
    const resetURL = `${clientURL}/reset-password/${resetToken}`;
    
    // In a production environment, you would send an email here
    console.log('Password reset token generated for', email);
    console.log('Reset URL:', resetURL);
    
    // For development purposes, return the token in the response
    // IMPORTANT: In production, you should remove this and send an email instead
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    res.status(200).json({ 
      message: 'If an account with that email exists, a password reset link has been sent.',
      ...(isDevelopment && { 
        dev_info: {
          reset_token: resetToken,
          reset_url: resetURL
        }
      })
    });
    
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Route to validate reset token
router.get('/reset-password/validate/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Find user with this token and make sure it hasn't expired
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ message: 'Password reset token is invalid or has expired' });
    }
    
    res.status(200).json({ message: 'Token is valid' });
    
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Route to reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }
    
    // Validate password
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    
    // Find user with this token and make sure it hasn't expired
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ message: 'Password reset token is invalid or has expired' });
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update user
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    
    // Log success (instead of sending email)
    console.log(`Password reset successful for user: ${user.email}`);
    
    res.status(200).json({ message: 'Password has been reset successfully' });
    
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router; 