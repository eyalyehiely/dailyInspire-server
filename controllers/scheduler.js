const cron = require('node-cron');
const { sendQuotesToUsersForCurrentTime } = require('./quote-sender');

// Run the scheduler every minute to check for users who should receive quotes
cron.schedule('* * * * *', async () => {
  console.log('Checking for users who should receive quotes now...');
  await sendQuotesToUsersForCurrentTime();
});

console.log('Quote scheduler started. Will check every minute for users to send quotes to...');

// Export the scheduler functionality
module.exports = {
  startScheduler: () => {
    console.log('Time-based quote scheduler initialized');
  }
}; 