const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { sendApplicationEmail, sendContactEmail } = require('../config/email');
const { applicationLimiter, contactEmailLimiter } = require('../middleware/rateLimiters');
const Request = require('../models/Request');
const Email = require('../models/Email');
const logger = require('../utils/logger');
const { uploadFile } = require('../services/supabaseStorage');

const router = express.Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, JPEG, and PNG files are allowed'));
    }
  }
});

// Validation rules for application form
const applicationValidation = [
  body('companyName').optional().trim().isLength({ min: 2, max: 200 }),
  body('companyAddress').optional().trim().isLength({ min: 10, max: 500 }),
  body('industry').optional().trim().isLength({ min: 2, max: 100 }),
  body('contactPersonName').optional().trim().isLength({ min: 2, max: 100 }),
  body('contactEmail').custom((value, { req }) => {
    const candidate = value || req.body.email;
    if (!candidate) {
      throw new Error('Email is required');
    }
    return true;
  }).isEmail().normalizeEmail(),
  body('contactPhone').optional().trim().isLength({ min: 8, max: 20 }),
  body('standards').optional(),
];

// Validation rules for contact form
const contactValidation = [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone').optional().trim().isLength({ min: 8, max: 20 }),
  body('subject').trim().isLength({ min: 3, max: 200 }).withMessage('Subject must be between 3 and 200 characters'),
  body('message').trim().isLength({ min: 10, max: 2000 }).withMessage('Message must be between 10 and 2000 characters'),
];

/**
 * POST /api/applications
 * Submit a new certification application with file uploads
 */
router.post('/', upload.array('file', 10), applicationValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'ValidationError',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      companyName,
      telephone,
      fax,
      email,
      website,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      companyAddress,
      industry,
      country,
      companySize,
      numberOfEmployees,
      numberOfLocations,
      contactPersonName,
      contactPersonPosition,
      contactEmail,
      contactPhone,
      standards,
      certificationProgramme,
      transferReason,
      transferExpiringDate,
      currentCertifications,
      preferredAuditDate,
      additionalInfo,
      executiveManagerName,
      executiveManagerMobile,
      executiveManagerEmail,
      contactPersonMobile,
      contactPersonEmail,
      workforceTotalEmployees,
      workforceEmployeesPerShift,
      workforceNumberOfShifts,
      workforceSeasonalEmployees,
      iso9001DesignAndDevelopment,
      iso9001OtherNonApplicableClauses,
      iso9001OtherNonApplicableClausesText,
      iso14001SitesManaged,
      iso14001RegisterOfSignificantAspects,
      iso14001EnvironmentalManagementManual,
      iso14001InternalAuditProgramme,
      iso14001InternalAuditImplemented,
      iso22000HaccpImplementation,
      iso22000HaccpStudies,
      iso22000Sites,
      iso22000ProcessLines,
      iso22000ProcessingType,
      iso45001HazardsIdentified,
      iso45001CriticalRisks,
    } = req.body;

    const resolvedContactEmail = contactEmail || email || req.body.email || '';
    const resolvedContactPhone = contactPhone || telephone || req.body.telephone || req.body.phone || '';

    if (!resolvedContactEmail) {
      return res.status(400).json({
        success: false,
        error: 'ValidationError',
        message: 'Email is required'
      });
    }

    if (!resolvedContactPhone) {
      return res.status(400).json({
        success: false,
        error: 'ValidationError',
        message: 'Telephone is required'
      });
    }
    const resolvedCompanyAddress = companyAddress || [
      addressLine1 || req.body.addressLine1,
      addressLine2 || req.body.addressLine2,
      city || req.body.city,
      state || req.body.state,
      postalCode || req.body.postalCode,
      country || req.body.country
    ].filter(Boolean).join(', ');

    // Parse standards if it's a JSON string
    let parsedStandards = [];
    try {
      parsedStandards = standards ? JSON.parse(standards) : [];
    } catch {
      parsedStandards = Array.isArray(standards) ? standards : (standards ? [standards] : []);
    }

    // Create Request record in MongoDB FIRST
    const descriptionParts = [];
    if (certificationProgramme) descriptionParts.push(`Programme: ${certificationProgramme}`);
    if (transferReason) descriptionParts.push(`Transfer reason: ${transferReason}`);
    if (transferExpiringDate) descriptionParts.push(`Transfer expiry: ${transferExpiringDate}`);
    if (additionalInfo) descriptionParts.push(additionalInfo);

    const requestData = {
      clientName: contactPersonName || 'Anonymous',
      companyName: companyName || 'Not Provided',
      companyTelephone: telephone || resolvedContactPhone || '',
      companyEmail: email || resolvedContactEmail || '',
      telephone: telephone || '',
      fax: fax || '',
      email: resolvedContactEmail,
      website: website || '',
      addressLine1: addressLine1 || '',
      addressLine2: addressLine2 || '',
      city: city || '',
      state: state || '',
      postalCode: postalCode || '',
      phone: resolvedContactPhone,
      country: country || '',
      programme: certificationProgramme || '',
      executiveManagerName: executiveManagerName || '',
      executiveManagerMobile: executiveManagerMobile || '',
      executiveManagerEmail: executiveManagerEmail || '',
      contactPersonPosition: contactPersonPosition || '',
      contactPersonMobile: contactPersonMobile || '',
      contactPersonEmail: contactPersonEmail || '',
      workforceTotalEmployees: workforceTotalEmployees || '',
      workforceEmployeesPerShift: workforceEmployeesPerShift || '',
      workforceNumberOfShifts: workforceNumberOfShifts || '',
      workforceSeasonalEmployees: workforceSeasonalEmployees || '',
      transferReason: transferReason || '',
      transferExpiringDate: transferExpiringDate || '',
      iso9001DesignAndDevelopment: iso9001DesignAndDevelopment || '',
      iso9001OtherNonApplicableClauses: iso9001OtherNonApplicableClauses || '',
      iso9001OtherNonApplicableClausesText: iso9001OtherNonApplicableClausesText || '',
      iso14001SitesManaged: iso14001SitesManaged || '',
      iso14001RegisterOfSignificantAspects: iso14001RegisterOfSignificantAspects || '',
      iso14001EnvironmentalManagementManual: iso14001EnvironmentalManagementManual || '',
      iso14001InternalAuditProgramme: iso14001InternalAuditProgramme || '',
      iso14001InternalAuditImplemented: iso14001InternalAuditImplemented || '',
      iso22000HaccpImplementation: iso22000HaccpImplementation || '',
      iso22000HaccpStudies: iso22000HaccpStudies || '',
      iso22000Sites: iso22000Sites || '',
      iso22000ProcessLines: iso22000ProcessLines || '',
      iso22000ProcessingType: iso22000ProcessingType || '',
      iso45001HazardsIdentified: iso45001HazardsIdentified || '',
      iso45001CriticalRisks: iso45001CriticalRisks || '',
      serviceType: parsedStandards.length > 0 ? parsedStandards[0] : 'General',
      standards: parsedStandards,
      numberOfEmployees: numberOfEmployees || null,
      industry: industry || '',
      description: descriptionParts.join(' | ') || 'Certification application',
      status: 'new',
    };

    let savedRequest = null;
    try {
      savedRequest = await Request.create(requestData);
      logger.info('Application request created in database', { requestId: savedRequest._id });
    } catch (dbError) {
      logger.error('Failed to save application request to database:', dbError);
      return res.status(500).json({
        success: false,
        error: 'DatabaseError',
        message: 'Failed to save application. Please try again later.',
        details: dbError && dbError.message
      });
    }

    // Handle file uploads if files were provided
    const uploadedFiles = req.files || [];
    if (uploadedFiles.length > 0) {
      const uploaded = [];

      for (const file of uploadedFiles) {
        try {
          const result = await uploadFile(
            file.buffer,
            file.originalname,
            file.mimetype,
            savedRequest._id.toString()
          );
          uploaded.push({
            name: file.originalname,
            storageKey: result.storageKey,
            bucket: result.bucket,
            mimeType: result.mimeType,
            size: result.size,
            isPublic: result.isPublic
          });
          logger.info('File uploaded for application', {
            requestId: savedRequest._id,
            fileName: file.originalname,
            size: file.size
          });
        } catch (fileErr) {
          logger.warn('Failed to upload application file', {
            requestId: savedRequest._id,
            fileName: file.originalname,
            error: fileErr && fileErr.message
          });
        }
      }

      if (uploaded.length > 0) {
        try {
          savedRequest.files = uploaded;
          await savedRequest.save();
          logger.info('Files metadata saved to application', {
            requestId: savedRequest._id,
            fileCount: uploaded.length
          });
        } catch (saveErr) {
          logger.warn('Failed to save uploaded file metadata to request', {
            requestId: savedRequest._id,
            error: saveErr && saveErr.message
          });
        }
      }
    }

    // Prepare data for email notification
    const applicationData = {
      name: contactPersonName,
      email: resolvedContactEmail,
      phone: resolvedContactPhone,
      companyName,
      companyAddress,
      industry,
      companySize,
      numberOfEmployees: numberOfEmployees?.toString(),
      numberOfLocations: numberOfLocations?.toString(),
      contactPersonName,
      contactPersonPosition,
      contactEmail: resolvedContactEmail,
      contactPhone: resolvedContactPhone,
      certificationsRequested: JSON.stringify(parsedStandards),
      currentCertifications,
      preferredAuditDate: preferredAuditDate ? new Date(preferredAuditDate) : null,
      additionalInfo,
    };

    // Send email notification (async, don't block on failure)
    let emailSent = false;
    try {
      const emailResult = await sendApplicationEmail(applicationData);
      emailSent = Boolean(emailResult && emailResult.success);
      if (emailSent) {
        logger.info('Notification email sent for application', { requestId: savedRequest._id });
      } else {
        logger.warn('Failed to send notification email', { requestId: savedRequest._id, error: emailResult?.error });
      }
    } catch (emailError) {
      logger.error('Error sending application email:', emailError);
      // Email failure does NOT block success response
      emailSent = false;
    }

    // Return success - application is saved even if email failed
    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      emailSent: emailSent,
      requestId: savedRequest._id,
    });
  } catch (error) {
    logger.error('Error processing application:', error);
    res.status(500).json({
      success: false,
      error: 'InternalServerError',
      message: 'Failed to submit application. Please try again later.',
      details: error && error.message
    });
  }
});

/**
 * POST /api/applications/contact
 * Submit contact form
 */
router.post('/contact', contactEmailLimiter, contactValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'ValidationError',
        errors: errors.array()
      });
    }

    const { name, email, phone, subject, message, type } = req.body;

    // Save to Email model FIRST
    let savedEmail = null;
    try {
      savedEmail = await Email.create({
        senderName: name,
        senderEmail: email,
        senderPhone: phone,
        subject,
        message,
        type: type || 'contact',
        status: 'new'
      });
      logger.info('Contact email saved to database', { emailId: savedEmail._id });
    } catch (dbError) {
      logger.error('Failed to save contact email to database:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Failed to save message. Please try again later.',
        message: 'Database error'
      });
    }

    // Prepare contact data for email notification
    const contactData = {
      name,
      email,
      phone,
      subject,
      message,
    };

    // Send email notification (async, don't block on failure)
    let emailSent = false;
    try {
      const emailResult = await sendContactEmail(contactData);
      emailSent = Boolean(emailResult && emailResult.success);
      if (emailSent) {
        logger.info('Notification email sent for contact form', { emailId: savedEmail._id });
      } else {
        logger.warn('Failed to send contact notification email', { emailId: savedEmail._id });
      }
    } catch (emailError) {
      logger.error('Error sending contact email:', emailError);
      // Email failure does NOT block success response
      emailSent = false;
    }

    // Return success - contact message is saved even if notification email failed
    res.status(201).json({
      success: true,
      message: 'Message submitted successfully',
      emailSent: emailSent,
      emailId: savedEmail._id,
    });
  } catch (error) {
    logger.error('Error processing contact form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit message. Please try again later.',
    });
  }
});

module.exports = router;

