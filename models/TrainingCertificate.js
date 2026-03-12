const mongoose = require('mongoose');

const trainingCertificateSchema = new mongoose.Schema({
  // Certificate Number (manually entered by admin)
  certificateNumber: {
    type: String,
    required: true,
    unique: true,
    index: true,
    // Format: TRAIN-001, TRAIN-2025-009, HOR-TR-01, etc.
  },

  // Trainee Info (instead of company)
  trainee: {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    organization: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
  },

  // Training Info (instead of standard)
  training: {
    courseName: {
      type: String,
      required: true,
      // Example: "ISO 9001:2015 Awareness"
    },
    category: {
      type: String,
      enum: ['ISO 9001', 'ISO 14001', 'ISO 45001', 'HACCP', 'GMP', 'Other'],
    },
    date: {
      type: Date,
      required: true,
    },
    hours: {
      type: Number,
      required: true,
    },
    trainer: String,
  },

  // Dates (same as ISO)
  issueDate: {
    type: Date,
    required: true,
    default: Date.now,
  },
  expiryDate: {
    type: Date,
    required: true,
  },

  // QR Code URL (for verification link)
  qrCode: {
    type: String,
    unique: true,
  },

  // QR Code Image (base64 data URL)
  qrCodeImage: {
    type: String,
    required: true,
  },

  // Status (same as ISO)
  status: {
    type: String,
    enum: ['active', 'expired', 'revoked'],
    default: 'active',
  },

  // Created by (same as ISO)
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  notes: String,
}, {
  timestamps: true,
});

// Indexes
trainingCertificateSchema.index({ certificateNumber: 1 });
trainingCertificateSchema.index({ qrCode: 1 });

module.exports = mongoose.model('TrainingCertificate', trainingCertificateSchema);
