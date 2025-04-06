const cron = require('node-cron');
const { sendQuotesToUsersForCurrentTime } = require('./quote-sender');
const { exec } = require('child_process');
const path = require('path');
const { resetQuoteStatusForAllUsers } = require('../utils/quoteStatus');


// Run the scheduler every minute to check for users who should receive quotes
cron.schedule('* * * * *', async () => {
  console.log('Checking for users who should receive quotes now...');
  await sendQuotesToUsersForCurrentTime();
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




// Schedule the reset to run at midnight in each timezone
// This will run every hour and check if it's midnight in any timezone
cron.schedule('0 * * * *', async () => {
  try {
    console.log('Running midnight reset check...');
    await resetQuoteStatusForAllUsers();
    console.log('Midnight reset completed successfully');
  } catch (error) {
    console.error('Error in midnight reset:', error);
  }
});


console.log('Quote scheduler started. Will check every minute for users to send quotes to...');
console.log('Payment check scheduler started. Will run daily at midnight');

// Export the scheduler functionality
module.exports = {
  startScheduler: () => {
    console.log('Scheduler initialized for quotes and payment checks');
    console.log('Scheduled jobs started');
  }
};