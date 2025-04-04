const cron = require('node-cron');
const { sendQuotesToUsersForCurrentTime } = require('./quote-sender');
const { updateNextPaymentDates } = require('../services/subscriptionService');
const { exec } = require('child_process');
const path = require('path');

// Run the scheduler every minute to check for users who should receive quotes
cron.schedule('* * * * *', async () => {
  console.log('Checking for users who should receive quotes now...');
  await sendQuotesToUsersForCurrentTime();
});

// Update next payment dates daily at midnight Israel time
cron.schedule('0 0 * * *', async () => {
  console.log('Running scheduled task: updateNextPaymentDates');
  try {
    await updateNextPaymentDates();
  } catch (error) {
    console.error('Error in scheduled updateNextPaymentDates task:', error);
  }
}, {
  timezone: 'Asia/Jerusalem'
});

// Run daily at midnight to check for incomplete payments
cron.schedule('0 0 * * *', () => {
  console.log('Running daily check for incomplete payments...');
  const scriptPath = path.join(__dirname, '..', 'check-incomplete-payments.js');
  
  exec(`node ${scriptPath}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error running check-incomplete-payments: ${error}`);
      return;
    }
    if (stderr) {
      console.error(`Stderr from check-incomplete-payments: ${stderr}`);
    }
    console.log(`Check-incomplete-payments output: ${stdout}`);
  });
});

console.log('Quote scheduler started. Will check every minute for users to send quotes to...');
console.log('Payment check scheduler started. Will run daily at midnight');

// Export the scheduler functionality
module.exports = {
  startScheduler: () => {
    console.log('Scheduler initialized for quotes and payment checks');
  }
};