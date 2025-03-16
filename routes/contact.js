const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

// Google Sheets configuration
const SPREADSHEET_ID = '1MCIpvpJGT6sLuqIENhzQcuOU1fgLmqXb9BHQr5MsMsk';
const SHEET_NAME = 'Customers support'; // Update this to your sheet name

// Create client with credentials
const getGoogleSheetsClient = async () => {
  try {
    // Check for credentials
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('Google Sheets credentials are missing. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.');
    }

    // Google auth setup
    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Ensure newlines are properly handled
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    // Create Google Sheets API client
    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    console.error('Error creating Google Sheets client:', error);
    throw error;
  }
};

// Format date in Israel time zone
const getIsraelDateTime = () => {
  return new Date().toLocaleString('en-US', { 
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

// Implement rate limiting for security
const contactRequestsMap = new Map();
const MAX_REQUESTS = 5; // Max requests per timeframe
const TIMEFRAME = 60 * 60 * 1000; // 1 hour in milliseconds

const isRateLimited = (email) => {
  const now = Date.now();
  const userRequests = contactRequestsMap.get(email) || [];
  
  // Filter out requests older than TIMEFRAME
  const recentRequests = userRequests.filter(timestamp => now - timestamp < TIMEFRAME);
  
  // Update the map with recent requests
  contactRequestsMap.set(email, recentRequests);
  
  // Check if user has exceeded maximum requests
  return recentRequests.length >= MAX_REQUESTS;
};

// POST /api/contact - Handle contact form submissions
router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    
    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    
    // Check for rate limiting
    if (isRateLimited(email)) {
      console.log(`Rate limit exceeded for contact from ${email}`);
      return res.status(429).json({ 
        message: 'Too many contact requests. Please try again later.'
      });
    }
    
    // Update the rate limiter
    const userRequests = contactRequestsMap.get(email) || [];
    contactRequestsMap.set(email, [...userRequests, Date.now()]);
    
    try {
      // Get Google Sheets client
      const sheets = await getGoogleSheetsClient();
      
      // Prepare row data
      const rowData = [
        name,
        email,
        message,
        'new', // Status
        getIsraelDateTime() // Timestamp in Israel timezone
      ];
      
      // Append data to spreadsheet
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:E`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [rowData]
        }
      });
      
      // Get the updated row number
      const updatedRange = response.data.updates.updatedRange;
      const rowNumber = parseInt(updatedRange.split(':')[0].match(/\d+/)[0]);
      
      // Apply yellow formatting to the new row
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            updateCells: {
              range: {
                sheetId: 0, // Assuming it's the first sheet
                startRowIndex: rowNumber - 1,
                endRowIndex: rowNumber,
                startColumnIndex: 0,
                endColumnIndex: 5 // A through E columns
              },
              rows: [{
                values: Array(5).fill({
                  userEnteredFormat: {
                    backgroundColor: {
                      red: 1.0,
                      green: 0.95,
                      blue: 0.6
                    }
                  }
                })
              }],
              fields: 'userEnteredFormat.backgroundColor'
            }
          }]
        }
      });
      
      console.log(`Contact form submission from ${name} (${email}) saved to Google Sheets`);
      
      return res.status(200).json({ 
        message: 'Message sent successfully! We\'ll get back to you soon.'
      });
    } catch (sheetError) {
      console.error('Error saving to Google Sheets:', sheetError);
      return res.status(500).json({ 
        message: 'Failed to send message. Please try again later.',
        error: sheetError.message
      });
    }
  } catch (error) {
    console.error('Error in contact form handler:', error);
    return res.status(500).json({ 
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router; 