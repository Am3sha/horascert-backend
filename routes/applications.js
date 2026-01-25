const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { sendApplicationEmail, sendContactEmail, sendApplicationReceivedToClient } = require('../config/email');
const { applicationLimiter, contactEmailLimiter } = require('../middleware/rateLimiters');
const Request = require('../models/Request');
const Email = require('../models/Email');
const logger = require('../utils/logger');
const { uploadFile, getSignedFileUrl } = require('../services/supabaseStorage');
const { auth, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX, JPEG, and PNG files are allowed'));
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
router.post('/', applicationLimiter, upload.array('file', 3), applicationValidation, async (req, res) => {
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

    const parseOptionalNumber = (value) => {
      if (value === null || value === undefined) return null;
      const raw = String(value).trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

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
      numberOfEmployees: parseOptionalNumber(numberOfEmployees),
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
      const response = {
        success: false,
        error: 'DatabaseError',
        message: 'Failed to save application. Please try again later.',
        details: null
      };

      if (process.env.NODE_ENV === 'development') {
        response.details = dbError && dbError.message;
      }

      return res.status(500).json({
        ...response
      });
    }

    // Handle file uploads if files were provided
    const uploadedFiles = req.files || [];
    const uploaded = [];

    if (uploadedFiles.length > 0) {
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

    // Prepare complete data for email notification
    // Include ALL form data (not just subset) + uploaded files
    const applicationData = {
      // Request ID (needed for file URL generation)
      requestId: savedRequest._id.toString(),

      // Contact Information
      name: contactPersonName,
      email: resolvedContactEmail,
      phone: resolvedContactPhone,

      // Company Information
      companyName,
      companyAddress: resolvedCompanyAddress,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      website,
      telephone,
      fax,
      industry,
      companySize,
      numberOfEmployees: numberOfEmployees?.toString(),
      numberOfLocations: numberOfLocations?.toString(),

      // Contact Person Details
      contactPersonName,
      contactPersonPosition,
      contactPersonMobile: contactPersonMobile || contactPersonPhone,
      contactPersonEmail,
      contactEmail: resolvedContactEmail,
      contactPhone: resolvedContactPhone,

      // Executive Manager Details
      executiveManagerName,
      executiveManagerMobile,
      executiveManagerEmail,

      // Workforce Details
      workforceTotalEmployees,
      workforceEmployeesPerShift,
      workforceNumberOfShifts,
      workforceSeasonalEmployees,

      // ISO 9001 Details
      iso9001DesignAndDevelopment,
      iso9001OtherNonApplicableClauses,
      iso9001OtherNonApplicableClausesText,

      // ISO 14001 Details
      iso14001SitesManaged,
      iso14001RegisterOfSignificantAspects,
      iso14001EnvironmentalManagementManual,
      iso14001InternalAuditProgramme,
      iso14001InternalAuditImplemented,

      // ISO 22000 Details
      iso22000HaccpImplementation,
      iso22000HaccpStudies,
      iso22000Sites,
      iso22000ProcessLines,
      iso22000ProcessingType,

      // ISO 45001 Details
      iso45001HazardsIdentified,
      iso45001CriticalRisks,

      // Certification Details
      certificationsRequested: JSON.stringify(parsedStandards),
      certificationProgramme,
      currentCertifications,
      preferredAuditDate,
      transferReason,
      transferExpiringDate,

      // Additional Information
      additionalInfo,

      // Uploaded Files (IMPORTANT: Include file metadata)
      uploadedFiles: uploaded.map(file => ({
        name: file.name,
        storageKey: file.storageKey,
        bucket: file.bucket,
        mimeType: file.mimeType,
        size: file.size,
        publicUrl: ''
      })) || []
    };

    // ✅ Return success IMMEDIATELY - application is saved to database!
    // This is critical for UX: user gets instant feedback
    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      requestId: savedRequest._id,
    });

    // 🔄 Send confirmation email to client in background (non-blocking)
    // Must not affect admin email behavior or API response
    setImmediate(async () => {
      try {
        const result = await sendApplicationReceivedToClient({
          to: resolvedContactEmail,
          requestId: savedRequest._id.toString(),
        });

        if (result && result.success) {
          logger.info('Confirmation email sent to client for application', {
            requestId: savedRequest._id,
            to: resolvedContactEmail
          });
        } else {
          logger.warn('Failed to send confirmation email to client for application', {
            requestId: savedRequest._id,
            to: resolvedContactEmail,
            error: result && result.error
          });
        }
      } catch (err) {
        logger.error('Failed to send confirmation email to client for application:', err);
      }
    });

    // 🔄 Send email notification in background (non-blocking)
    // Uses setImmediate to ensure this runs after response is sent
    setImmediate(async () => {
      try {
        const expirySeconds = Math.max(
          60,
          parseInt(process.env.EMAIL_FILE_URL_EXPIRES_IN || '86400', 10) || 86400
        );

        if (Array.isArray(applicationData.uploadedFiles) && applicationData.uploadedFiles.length > 0) {
          applicationData.uploadedFiles = await Promise.all(
            applicationData.uploadedFiles.map(async (file) => {
              const bucket = file.bucket || process.env.STORAGE_BUCKET || 'certificates';
              const fallbackUrl = `${process.env.API_URL || 'http://localhost:5001'}/api/v1/applications/${savedRequest._id}/file/${encodeURIComponent(file.storageKey)}`;

              try {
                const signedUrl = await getSignedFileUrl(bucket, file.storageKey, expirySeconds);
                return { ...file, publicUrl: signedUrl };
              } catch (signErr) {
                logger.warn('Failed to generate signed URL for application file', {
                  requestId: savedRequest._id,
                  bucket,
                  storageKey: file.storageKey,
                  error: signErr && signErr.message
                });
                return { ...file, publicUrl: fallbackUrl };
              }
            })
          );
        }

        const emailResult = await sendApplicationEmail(applicationData);
        if (emailResult && emailResult.success) {
          logger.info('Notification email sent for application', { requestId: savedRequest._id });
        } else {
          logger.warn('Failed to send notification email', { requestId: savedRequest._id, error: emailResult?.error });
        }
      } catch (emailError) {
        logger.error('Error sending application email:', emailError);
        // Email failure is logged but doesn't affect user's application submission
      }
    });
  } catch (error) {
    logger.error('Error processing application:', error);
    const response = {
      success: false,
      error: 'InternalServerError',
      message: 'Failed to submit application. Please try again later.',
      details: null
    };

    if (process.env.NODE_ENV === 'development') {
      response.details = error && error.message;
    }

    res.status(500).json({
      ...response
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

    // ✅ Return success IMMEDIATELY - contact message is saved to database!
    // This is critical for UX: user gets instant feedback
    res.status(201).json({
      success: true,
      message: 'Message submitted successfully',
      emailId: savedEmail._id,
    });

    // 🔄 Send email notification in background (non-blocking)
    // Uses setImmediate to ensure this runs after response is sent
    setImmediate(async () => {
      try {
        const emailResult = await sendContactEmail(contactData);
        if (emailResult && emailResult.success) {
          logger.info('Notification email sent for contact form', { emailId: savedEmail._id });
        } else {
          logger.warn('Failed to send notification email', { emailId: savedEmail._id });
        }
      } catch (emailError) {
        logger.error('Error sending contact email:', emailError);
        // Email failure is logged but doesn't affect user's message submission
      }
    });
  } catch (error) {
    logger.error('Error processing contact form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit message. Please try again later.',
    });
  }
});

/**
 * GET /api/v1/applications/:requestId/file/:storageKey
 * Retrieve signed URL for uploaded file from Supabase
 * This endpoint is used to generate secure file links for email attachments
 */
router.get('/:requestId/file/:storageKey', auth, restrictTo('admin'), async (req, res) => {
  try {
    let { requestId, storageKey } = req.params;

    // Decode URL-encoded storageKey (contains slashes like: requests/id/filename.pdf)
    storageKey = decodeURIComponent(storageKey);

    // Validate request ID
    if (!requestId || !storageKey) {
      return res.status(400).json({
        success: false,
        error: 'Missing requestId or storageKey'
      });
    }

    // Verify the request exists (for security - don't expose file URLs for non-existent requests)
    const request = await Request.findById(requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Application not found'
      });
    }

    // Find the file in the request
    const file = request.files?.find(f => f.storageKey === storageKey);
    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Get signed URL from Supabase (valid for 1 hour)
    const supabaseStorage = require('../services/supabaseStorage');
    const signedUrl = await supabaseStorage.getFileUrl(storageKey, 3600);

    // Redirect directly to the file - browser will open/download it automatically
    return res.redirect(signedUrl);
  } catch (error) {
    logger.error('Error retrieving file URL:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve file URL'
    });
  }
});

module.exports = router;

