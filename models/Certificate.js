const mongoose = require('mongoose');
const logger = require('../utils/logger');

const certificateSchema = new mongoose.Schema({
    // Unique Certificate ID (auto-generated)
    certificateId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // Certificate Number (user-provided)
    certificateNumber: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // Company/Entity Information
    companyName: {
        type: String,
        required: true,
        trim: true
    },

    companyAddress: {
        street: String,
        city: String,
        state: String,
        postalCode: String,
        country: String,
        fullAddress: String
    },

    // Standard Information
    standard: {
        type: String,
        required: true
    },

    standardDescription: {
        type: String
    },

    // Scope of Registration
    scope: {
        type: String,
        required: true,
        trim: true
    },

    // Certification Type
    certificationType: {
        type: String,
        default: 'Management System'
    },

    // Dates
    issueDate: {
        type: Date,
        required: true
    },

    expiryDate: {
        type: Date,
        required: true
    },

    firstIssueDate: {
        type: Date
    },

    lastUpdatedAt: {
        type: Date,
        default: Date.now
    },

    // Status with detailed information
    status: {
        type: String,
        enum: ['active', 'suspended', 'withdrawn', 'expired'],
        default: 'active',
        set: (v) => (v == null ? v : String(v).toLowerCase())
    },

    statusDescription: {
        type: String,
        default: 'This certification is active and valid, meeting all current standards set by the certifying body.'
    },

    // Sites Information (array of locations)
    sites: [{
        siteType: {
            type: String,
            default: 'Main Site'
        },
        siteLocation: String,
        certifiedEntity: String,
        siteScope: String
    }],

    // Technical Sectors (if applicable)
    technicalSectors: [{
        sectorCode: String,
        sectorName: String
    }],

    // Certification Body (Your company)
    certificationBody: {
        name: {
            type: String,
            default: 'HORAS-CERT'
        },
        fullName: String,
        profileUrl: String
    },

    // Accreditation Body
    accreditationBody: {
        code: {
            type: String,
            default: 'EGAC'
        },
        name: {
            type: String,
            default: 'Egyptian Accreditation Council'
        },
        profileUrl: String
    },

    // Assessment Association
    assessmentAssociation: {
        code: {
            type: String,
            default: 'IAF'
        },
        name: {
            type: String,
            default: 'International Accreditation Forum'
        },
        websiteUrl: {
            type: String,
            default: 'https://iaf.nu'
        }
    },

    // QR Code (stored as data URL or external URL)
    qrCodeUrl: {
        type: String
    },

    // Additional Notes (admin only)
    adminNotes: {
        type: String
    },

    // Created by
    createdBy: {
        type: String,
        default: 'admin'
    }
}, {
    timestamps: true
});

// Additional indexes for fast searching
certificateSchema.index({
    companyName: 'text',
    certificateNumber: 'text',
    scope: 'text'
});
certificateSchema.index({ status: 1 });

certificateSchema.index({ companyName: 1 });
certificateSchema.index({ issueDate: -1 });
certificateSchema.index({ expiryDate: 1 });
certificateSchema.index({ status: 1, createdAt: -1 });

// Virtual for certificate URL
certificateSchema.virtual('certificateUrl').get(function () {
    return `${process.env.COMPANY_WEBSITE || 'http://localhost:3000'}/certificate/${this.certificateId}`;
});

// Method to check if certificate is expired
certificateSchema.methods.checkExpiration = function () {
    if (new Date() > this.expiryDate && this.status === 'active') {
        this.status = 'expired';
        this.statusDescription = 'This certification has expired and is no longer valid.';
        return true;
    }
    return false;
};

// Pre-save hook to update lastUpdatedAt
certificateSchema.pre('save', function (next) {
    this.lastUpdatedAt = Date.now();
    next();
});

// Static method to check if certificate number is taken
certificateSchema.statics.isCertificateNumberTaken = async function (certificateNumber) {
    const certificate = await this.findOne({ certificateNumber });
    return !!certificate;
};

// Method to check if certificate is expired
certificateSchema.methods.isExpired = function () {
    return this.expiryDate < new Date();
};

// Static method to update expired certificates
certificateSchema.statics.updateExpiredCertificates = async function () {
    const result = await this.updateMany(
        {
            expiryDate: { $lt: new Date() },
            status: { $ne: 'withdrawn' }
        },
        {
            $set: {
                status: 'expired'
            }
        }
    );
    return result;
};

// Schedule periodic expiry updates
certificateSchema.statics.scheduleExpiryJob = function (intervalMs = 3600000) {
    return setInterval(async () => {
        try {
            await this.updateExpiredCertificates();
            logger.info('Updated expired certificates');
        } catch (err) {
            logger.error('Error updating expired certificates:', err);
        }
    }, intervalMs);
};

const Certificate = mongoose.model('Certificate', certificateSchema);

module.exports = Certificate;
