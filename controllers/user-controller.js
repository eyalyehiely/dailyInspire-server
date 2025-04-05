const nodemailer = require('nodemailer');

// Function to send welcome email after signup
const sendWelcomeEmail = async (userEmail) => {
  try {
    console.log('Preparing to send welcome email to:', userEmail);
    console.log('Email configuration:', {
      service: process.env.EMAIL_SERVICE || 'gmail',
      user: process.env.EMAIL_USER ? 'Set' : 'Not set',
      password: process.env.EMAIL_PASSWORD ? 'Set' : 'Not set',
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`
    });
    
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    // Sample quote to give them a preview
    const sampleQuote = {
      text: "The journey of a thousand miles begins with one step.",
      author: "Lao Tzu"
    };

    // Format the preferred time for display
    const timeFormat = new Intl.DateTimeFormat('en', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      timeZone: user.timezone || 'UTC'
    });
    const formattedTime = timeFormat.format(new Date(`2000-01-01T${user.preferredTime || '09:00'}`));

    // Check if this is a subscription welcome email
    const isSubscriptionWelcome = user.isPay === true;
    const emailSubject = isSubscriptionWelcome 
      ? 'Welcome to Daily Inspirational Quotes Premium!' 
      : 'Welcome to Daily Inspirational Quotes!';
    
    // Customer portal link
    const customerPortalLink = 'https://customer-portal.paddle.com/cpl_01jq9rqdm30n58mzpn6dcr7wbd';
    
    const subscriptionInfo = isSubscriptionWelcome 
      ? `<div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #0066cc;">Premium Subscription Activated</h3>
          <p>Thank you for subscribing to our premium service! Your account has been upgraded and you now have access to all premium features.</p>
          <p><strong>Subscription Status:</strong> Active</p>
          <p><strong>Subscription ID:</strong> ${user.subscriptionId || 'N/A'}</p>
          <p>You can manage your subscription anytime through our customer portal:</p>
          <p><a href="${customerPortalLink}" style="display: inline-block; background-color: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">Manage Subscription</a></p>
        </div>` 
      : '';

    const mailOptions = {
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: emailSubject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>Welcome to Daily Inspirational Quotes, ${userEmail}!</h2>
          
          <p>Thank you for signing up for our daily quote service. Your account has been successfully created!</p>
          
          ${subscriptionInfo}
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">Your Preferences</h3>
            <p><strong>Daily Quote Time:</strong> ${formattedTime}</p>
            <p><strong>Timezone:</strong> ${user.timezone || 'UTC'}</p>
          </div>
          
          <p>Starting tomorrow, you'll receive a new inspirational quote every day at your preferred time.</p>
          
          <div style="margin: 30px 0;">
            <h3>Here's a preview of what to expect:</h3>
            <blockquote style="border-left: 4px solid #ccc; padding: 10px 15px; font-style: italic; margin: 15px 0;">
              "${sampleQuote.text}"
            </blockquote>
            <p style="text-align: right;">— ${sampleQuote.author}</p>
          </div>
          
          <p>We hope these daily quotes will bring inspiration and motivation to your day!</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 14px;">If you ever want to update your preferences or unsubscribe, you can do so by logging into your account or clicking the unsubscribe link in any of our emails.</p>
            ${isSubscriptionWelcome ? `<p style="color: #666; font-size: 14px;">To manage your subscription, visit our <a href="${customerPortalLink}">customer portal</a>.</p>` : ''}
          </div>
        </div>
      `
    };

    console.log('Sending welcome email to:', user.email);
    const info = await transporter.sendMail(mailOptions);
    console.log(`Welcome email sent successfully to ${user.email}. Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('Error sending welcome email:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      stack: error.stack
    });
    // Don't throw - we don't want to break the signup process if email fails
  }
};

const sendEmailToOwner = async (user) => {
  try {
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    // Format the preferred time for display
    const timeFormat = new Intl.DateTimeFormat('en', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      timeZone: user.timezone || 'UTC'
    });
    const formattedTime = timeFormat.format(new Date(`2000-01-01T${user.preferredTime || '09:00'}`));

    const mailOptions = {
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`,
      to: process.env.OWNER_EMAIL, // Send to owner's email
      subject: 'New User Signup - Daily Inspirational Quotes',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>New User Signup!</h2>
          
          <p>A new user has signed up for Daily Inspirational Quotes.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">User Details</h3>
            <p><strong>Name:</strong> ${user.first_name}</p>
            <p><strong>Email:</strong> ${user.email}</p>
            <p><strong>Daily Quote Time:</strong> ${formattedTime}</p>
            <p><strong>Timezone:</strong> ${user.timezone || 'UTC'}</p>
            <p><strong>Signup Date:</strong> ${new Date().toLocaleString()}</p>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 14px;">This is an automated notification from your Daily Inspirational Quotes application.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Notification email sent to owner about new user: ${user.email}`);
  } catch (error) {
    console.error('Error sending notification email to owner:', error);
    // Don't throw - we don't want to break the signup process if email fails
  }
};

// Send sorry email to user that cancel his subscription
const sendPaymentFailedEmail = async (user) => {
  try {
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Sorry, we couldn\'t process your payment',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>Sorry, we couldn't process your payment</h2>
          <p>We're sorry to inform you that we couldn't process your payment. Please try again using a different payment method.</p>
          <p>If you continue to experience issues, please contact our support team for assistance.</p>
          <p>Thank you for your understanding.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Sorry email sent to user: ${user.email}`);
  } catch (error) {
    console.error('Error sending sorry email:', error);
    // Don't throw - we don't want to break the signup process if email fails
  }
};





// Export the functions
module.exports = {
  sendWelcomeEmail,
  sendEmailToOwner,
  sendPaymentFailedEmail
}; 