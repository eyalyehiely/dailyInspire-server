const nodemailer = require('nodemailer');

// Function to send welcome email after signup
const sendWelcomeEmail = async (user) => {
  try {
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

    const mailOptions = {
      from: process.env.EMAIL_FROM || `Daily Inspirational Quotes <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Welcome to Daily Inspirational Quotes!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>Welcome to Daily Inspirational Quotes, ${user.first_name}!</h2>
          
          <p>Thank you for signing up for our daily quote service. Your account has been successfully created!</p>
          
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
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Welcome email sent to ${user.email}`);
  } catch (error) {
    console.error('Error sending welcome email:', error);
    // Don't throw - we don't want to break the signup process if email fails
  }
};

// Export the function
module.exports = {
  sendWelcomeEmail
}; 