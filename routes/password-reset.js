const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

// Setup nodemailer
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Route to request password reset - sends email with reset link
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
    
    // Create reset URL
    const clientURL = process.env.CLIENT_URL || 'http://localhost:5173';
    const resetURL = `${clientURL}/reset-password/${resetToken}`;
    
    // Send email
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'DailyInspire <noreply@dailyinspire.com>',
      to: user.email,
      subject: 'DailyInspire - Password Reset',
      html: `
        <h1>Reset Your Password</h1>
        <p>Hello ${user.first_name},</p>
        <p>We received a request to reset your password for your DailyInspire account.</p>
        <p>Click the button below to reset your password:</p>
        <a href="${resetURL}" style="display: inline-block; background-color: #4f46e5; color: white; text-decoration: none; padding: 10px 20px; border-radius: 5px; margin: 20px 0;">Reset Password</a>
        <p>This link will expire in 1 hour.</p>
        <p>If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
        <p>Best regards,</p>
        <p>The DailyInspire Team</p>
      `
    };
    
    await transporter.sendMail(mailOptions);
    
    res.status(200).json({ 
      message: 'If an account with that email exists, a password reset link has been sent.'
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
    
    // Send confirmation email
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'DailyInspire <noreply@dailyinspire.com>',
      to: user.email,
      subject: 'DailyInspire - Password Changed Successfully',
      html: `
        <h1>Password Changed Successfully</h1>
        <p>Hello ${user.first_name},</p>
        <p>Your password has been changed successfully.</p>
        <p>If you did not make this change, please contact our support team immediately.</p>
        <p>Best regards,</p>
        <p>The DailyInspire Team</p>
      `
    };
    
    await transporter.sendMail(mailOptions);
    
    res.status(200).json({ message: 'Password has been reset successfully' });
    
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router; 