const bodyParser = require('body-parser');

const rawBody = bodyParser.raw({
  type: 'application/json',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
});

module.exports = rawBody; 