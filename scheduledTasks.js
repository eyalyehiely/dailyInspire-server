const cron = require('node-cron');
const { updateNextPaymentDates } = require('./services/subscriptionService');

// Schedule tasks to run at specific times
const scheduleTasks = () => {
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
};

module.exports = {
  scheduleTasks
}; 