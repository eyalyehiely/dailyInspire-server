const User = require('../models/User');

/**
 * Checks if a quote was already sent today for a user
 * @param {string} userId - The user's ID
 * @returns {Promise<boolean>} - True if quote was sent today, false otherwise
 */
const isQuoteSentToday = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return false;

  // If no quote was ever sent, return false
  if (!user.lastQuoteSentAt) return false;

  // Get current date in user's timezone
  const userTimezone = user.timezone || 'UTC';
  const now = new Date();
  const userNow = new Date(now.toLocaleString('en-US', { timeZone: userTimezone }));

  // Get last quote sent date in user's timezone
  const lastSent = new Date(user.lastQuoteSentAt.toLocaleString('en-US', { timeZone: userTimezone }));

  // Compare dates (ignoring time)
  return userNow.getFullYear() === lastSent.getFullYear() &&
         userNow.getMonth() === lastSent.getMonth() &&
         userNow.getDate() === lastSent.getDate();
};

/**
 * Updates the quote sending status for a user
 * @param {string} userId - The user's ID
 * @param {boolean} sent - Whether a quote was sent
 * @returns {Promise<void>}
 */
const updateQuoteStatus = async (userId, sent) => {
  await User.findByIdAndUpdate(userId, {
    isQuoteSentToday: sent,
    lastQuoteSentAt: sent ? new Date() : null
  });
};

/**
 * Resets the quote sending status for all users at midnight
 * This should be called by a scheduled job
 */
const resetQuoteStatusForAllUsers = async () => {
  await User.updateMany(
    { isQuoteSentToday: true },
    { isQuoteSentToday: false }
  );
};

module.exports = {
  isQuoteSentToday,
  updateQuoteStatus,
  resetQuoteStatusForAllUsers
}; 