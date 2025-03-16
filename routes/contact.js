const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

// Google Sheets configuration
const SPREADSHEET_ID = '1MCIpvpJGT6sLuqIENhzQcuOU1fgLmqXb9BHQr5MsMsk';
const SHEET_NAME = 'Sheet1'; // Use the default sheet name

// Create client with credentials
const getGoogleSheetsClient = async () => {
  try {
    // Check for credentials and show detailed debug info
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
      console.error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable');
      throw new Error('Google service account email is missing');
    }
    
    if (!process.env.GOOGLE_PRIVATE_KEY) {
      console.error('Missing GOOGLE_PRIVATE_KEY environment variable');
      throw new Error('Google private key is missing');
    }
    
    console.log('Attempting to create auth with:', {
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      hasPrivateKey: !!process.env.GOOGLE_PRIVATE_KEY,
      privateKeyLength: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.length : 0
    });

    // Fix private key formatting
    const privateKey = process.env.GOOGLE_PRIVATE_KEY
      .replace(/\\n/g, '\n')
      .replace(/"-----/g, '-----')
      .replace(/-----"/g, '-----');
    
    // Google auth setup
    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      privateKey,
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
      console.log('Contact form submission received from:', email);
      
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
      
      console.log('Attempting to append data to spreadsheet');
      
      // First, get spreadsheet info to verify access and available sheets
      try {
        const sheetsInfo = await sheets.spreadsheets.get({
          spreadsheetId: SPREADSHEET_ID
        });
        
        console.log('Available sheets:', 
          sheetsInfo.data.sheets.map(s => s.properties.title)
        );
        
        // Use the first sheet if available
        if (sheetsInfo.data.sheets && sheetsInfo.data.sheets.length > 0) {
          const firstSheet = sheetsInfo.data.sheets[0].properties.title;
          console.log('Using first available sheet:', firstSheet);
          
          // Append data to spreadsheet using the first sheet
          const response = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${firstSheet}!A:E`,
            valueInputOption: 'USER_ENTERED',
            resource: {
              values: [rowData]
            }
          });
          
          console.log('Data appended successfully:', response.data);
          
          // Apply yellow formatting if possible
          try {
            const sheetId = sheetsInfo.data.sheets[0].properties.sheetId;
            const updatedRange = response.data.updates.updatedRange;
            const rowNumber = parseInt(updatedRange.split(':')[0].match(/\d+/)[0]);
            
            await sheets.spreadsheets.batchUpdate({
              spreadsheetId: SPREADSHEET_ID,
              resource: {
                requests: [{
                  updateCells: {
                    range: {
                      sheetId: sheetId,
                      startRowIndex: rowNumber - 1,
                      endRowIndex: rowNumber,
                      startColumnIndex: 0,
                      endColumnIndex: 5
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
            
            console.log('Row formatting applied successfully');
          } catch (formatError) {
            console.error('Error applying formatting (non-critical):', formatError.message);
            // Continue even if formatting fails
          }
          
          return res.status(200).json({ 
            message: 'Message sent successfully! We\'ll get back to you soon.'
          });
        } else {
          throw new Error('No sheets found in the spreadsheet');
        }
      } catch (sheetsError) {
        console.error('Error accessing spreadsheet:', sheetsError);
        throw new Error(`Could not access spreadsheet: ${sheetsError.message}`);
      }
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