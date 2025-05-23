// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  first_name: {
    type: String,
    required: true,
    trim: true
  },
  last_name: {
    type: String,
    required: true,
    trim: true
  },
  paddleCustomerId: {
    type: String,
    default: null,
    index: true
  },
  quotesEnabled: {
    type: Boolean,
    default: true
  },
  isPay: {
    type: Boolean,
    default: false
  },
  isRegistrationComplete: {
    type: Boolean,
    default: false
  },
  subscriptionId: {
    type: String,
    default: null
  },
  subscriptionStatus: {
    type: String,
    enum: ['none', 'active', 'canceled', 'past_due', 'unpaid', 'trialing', 'paused'],
    default: 'none'
  },
  cardBrand: {
    type: String,
    default: null
  },
  cardLastFour: {
    type: String,
    default: null
  },
  paymentUpdatedAt: {
    type: Date,
    default: null
  },
  lastCheckoutAttempt: {
    url: {
      type: String,
      default: null
    },
    firstPaymentDate: {
      type: Date,
      default: null,
      validate: {
        validator: function(v) {
          return v === null || (v instanceof Date && !isNaN(v));
        },
        message: props => `${props.value} is not a valid date`
      }
    },
    nextPaymentDate: {
      type: Date,
      default: null,
      validate: {
        validator: function(v) {
          return v === null || (v instanceof Date && !isNaN(v));
        },
        message: props => `${props.value} is not a valid date`
      }
    },
    canceledAt: {
      type: Date,
      default: null,
      validate: {
        validator: function(v) {
          return v === null || (v instanceof Date && !isNaN(v));
        },
        message: props => `${props.value} is not a valid date`
      }
    },
    timestamp: {
      type: Date,
      default: null
    }
  },
  preferredTime: {
    type: String,
    default: "07:00", // Default time (24-hour format)
    validate: {
      validator: function(v) {
        return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
      },
      message: props => `${props.value} is not a valid time format. Use HH:MM in 24-hour format.`
    }
  },
  timezone: {
    type: String,
    default: "UTC", // Default timezone
    validate: {
      validator: function(v) {
        try {
          Intl.DateTimeFormat(undefined, {timeZone: v});
          return true;
        } catch (e) {
          return false;
        }
      },
      message: props => `${props.value} is not a valid timezone.`
    }
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  resetPasswordToken: {
    type: String
  },
  resetPasswordExpires: {
    type: Date
  },
  isQuoteSentToday: {
    type: Boolean,
    default: false
  },
  lastQuoteSentAt: {
    type: Date,
    default: null
  },
  quotesDisabledAfter: {
    type: Date,
    default: null,
    validate: {
      validator: function(v) {
        return v === null || (v instanceof Date && !isNaN(v));
      },
      message: props => `${props.value} is not a valid date`
    }
  }
});

// Hash password before saving
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
UserSchema.methods.comparePassword = async function(candidatePassword) {
  // Add safety check to prevent bcrypt errors
  if (!this.password) {
    console.log('No password hash stored for user');
    return false;
  }
  
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    console.error('Password comparison error:', error);
    return false;
  }
};

// Fix: Check if model exists before creating it
module.exports = mongoose.models.User || mongoose.model('User', UserSchema);