const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
    clientName: {
        type: String,
        required: true
    },
    companyName: {
        type: String,
        required: true
    },
    companyTelephone: String,
    companyEmail: String,
    telephone: String,
    fax: String,
    website: String,
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    postalCode: String,
    email: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    country: String,
    programme: String,
    executiveManagerName: String,
    executiveManagerMobile: String,
    executiveManagerEmail: String,
    contactPersonPosition: String,
    contactPersonMobile: String,
    contactPersonEmail: String,
    workforceTotalEmployees: String,
    workforceEmployeesPerShift: String,
    workforceNumberOfShifts: String,
    workforceSeasonalEmployees: String,
    transferReason: String,
    transferExpiringDate: String,
    iso9001DesignAndDevelopment: String,
    iso9001OtherNonApplicableClauses: String,
    iso9001OtherNonApplicableClausesText: String,
    iso14001SitesManaged: String,
    iso14001RegisterOfSignificantAspects: String,
    iso14001EnvironmentalManagementManual: String,
    iso14001InternalAuditProgramme: String,
    iso14001InternalAuditImplemented: String,
    iso22000HaccpImplementation: String,
    iso22000HaccpStudies: String,
    iso22000Sites: String,
    iso22000ProcessLines: String,
    iso22000ProcessingType: String,
    iso45001HazardsIdentified: String,
    iso45001CriticalRisks: String,
    serviceType: {
        type: String,
        required: true,
        trim: true
        // Enum validation removed - accepts full service type descriptions from frontend
        // Example: "ISO 9001:2015 - Quality Management System"
    },
    standards: [{
        type: String
    }],
    otherService: String,
    numberOfEmployees: Number,
    industry: String,
    description: {
        type: String,
        required: true
    },

    files: [{
        name: String,
        url: String,
        storageKey: String,
        bucket: String,
        mimeType: String,
        size: Number
    }],

    status: {
        type: String,
        enum: ['new', 'pending', 'in-progress', 'approved', 'completed', 'rejected', 'cancelled'],
        default: 'new'
    },
    quotation: {
        amount: Number,
        currency: {
            type: String,
            default: 'USD'
        },
        validUntil: Date,
        notes: String
    },
    adminNotes: String,
    followUps: [{
        date: {
            type: Date,
            default: Date.now
        },
        note: String,
        by: String
    }]
}, {
    timestamps: true
});

// Indexes
requestSchema.index({ status: 1 });
requestSchema.index({ email: 1 });
requestSchema.index({ companyName: 'text', clientName: 'text' });
requestSchema.index({ createdAt: -1 });

// Add a follow-up to a request
requestSchema.methods.addFollowUp = async function (note, by) {
    this.followUps.push({ note, by });
    return this.save();
};

// Update status and add a follow-up
requestSchema.methods.updateStatus = async function (status, note, by) {
    this.status = status;
    if (note) {
        await this.addFollowUp(note, by);
    }
    return this.save();
};

module.exports = mongoose.model('Request', requestSchema);
