const https = require('https');
const he = require('he');
const logger = require('../utils/logger');

const RESEND_API_HOST = 'api.resend.com';
const COMPANY_EMAIL = 'info@horascert.com';

/**
 * Core email sender using Resend API
 * @param {Object} params - Email parameters
 * @param {string} params.to - Recipient email (dynamic)
 * @param {string} params.subject - Email subject
 * @param {string} params.html - Email HTML body
 * @param {string} params.from - Optional from address (defaults to EMAIL_FROM)
 * @returns {Promise<Object>} - Email send result with messageId
 */
const sendEmail = async ({ to, subject, html, from }) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set');
  }

  const fromAddress = from || process.env.EMAIL_FROM || 'HORAS <info@horascert.com>';

  if (!to) {
    throw new Error('Recipient email (to) is required');
  }

  logger.info('Sending email', { to, subject });

  const payload = JSON.stringify({ from: fromAddress, to, subject, html });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        host: RESEND_API_HOST,
        path: '/emails',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 30_000
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : null;
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              logger.info('Email sent successfully', { to, messageId: parsed?.id });
              resolve(parsed);
              return;
            }

            const message =
              (parsed && parsed.message) ||
              (parsed && parsed.error && parsed.error.message) ||
              `Resend API error (${res.statusCode || 'unknown'})`;
            reject(new Error(message));
          } catch (e) {
            reject(new Error(`Resend API invalid response (${res.statusCode || 'unknown'})`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Resend request timeout'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
};

// ============================================================
// EMAIL TEMPLATES & FUNCTIONS
// ============================================================

/**
 * Helper: Format field for email display
 */
const formatField = (label, value) => {
  if (!value || value === 'N/A' || value === 'Not specified' || value === 'undefined') {
    return '';
  }

  const safeValue = he.encode(String(value), { useNamedReferences: true });
  return `<p><strong>${label}:</strong> ${safeValue}</p>`;
};

/**
 * Helper: Build address from components
 */
const buildAddress = (address1, address2, city, state, postal, country) => {
  const parts = [address1, address2, city, state, postal, country]
    .filter(part => part && part.trim() && part !== 'undefined')
    .join(', ');
  return parts || null;
};

/**
 * Helper: Escape HTML
 */
const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return he.encode(String(value), { useNamedReferences: true });
};

// ============================================================
// 1. APPLICATION EMAILS
// ============================================================

/**
 * Send application notification to company with DYNAMIC form data
 * Only shows fields that have actual data (no empty/undefined values)
 * Includes uploaded files as downloadable links
 * @param {Object} applicationData - Complete application form data
 */
const sendApplicationEmail = async (applicationData) => {
  try {
    // ========== HELPER FUNCTIONS ==========

    /**
     * Check if a value is empty/undefined/invalid
     */
    const isEmpty = (value) => {
      if (!value) return true;
      const str = String(value).trim();
      if (!str) return true;
      if (str === 'undefined' || str === 'N/A' || str === 'None' || str === 'Not provided' || str === 'Not Provided') return true;
      if (str === 'null') return true;
      return false;
    };

    /**
     * Render a single field with label and value
     */
    const renderField = (label, value) => {
      if (isEmpty(value)) return '';
      const safeValue = escapeHtml(String(value).trim());
      return `<p>${escapeHtml(label)}: <strong>${safeValue}</strong></p>`;
    };

    /**
     * Render a section only if it has at least one populated field
     */
    const renderSection = (title, icon, fields) => {
      // Filter out empty fields
      const populatedFields = fields.filter(field => !isEmpty(field));

      // If no populated fields, return empty string (section won't appear)
      if (populatedFields.length === 0) return '';

      return `
        <h3 style="color: #0066cc; margin-top: 20px;">${icon} ${escapeHtml(title)}</h3>
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px;">
          ${populatedFields.join('')}
        </div>
      `;
    };

    /**
     * Render uploaded files section
     */
    const renderFilesSection = (files) => {
      if (!Array.isArray(files) || files.length === 0) return '';

      const filesList = files
        .filter(file => file && file.name)
        .map(file => {
          const fileName = escapeHtml(file.name);
          const fileUrl = file.publicUrl || file.url || '';

          if (fileUrl) {
            return `<li><a href="${escapeHtml(fileUrl)}" style="color: #0066cc; text-decoration: none;">📎 ${fileName}</a></li>`;
          }
          return `<li>📎 ${fileName}</li>`;
        })
        .join('');

      if (!filesList) return '';

      return `
        <h3 style="color: #0066cc; margin-top: 20px;">📁 Uploaded Files</h3>
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px;">
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${filesList}
          </ul>
        </div>
      `;
    };

    // ========== PARSE AND EXTRACT DATA ==========

    // Parse certifications
    let certificationsText = '';
    try {
      const certifications = applicationData.certificationsRequested
        ? (typeof applicationData.certificationsRequested === 'string'
          ? JSON.parse(applicationData.certificationsRequested)
          : applicationData.certificationsRequested)
        : [];
      if (Array.isArray(certifications) && certifications.length > 0) {
        certificationsText = certifications.join(', ');
      }
    } catch (e) {
      logger.warn('Failed to parse certifications', { error: e.message });
    }

    // Build formatted address
    const formattedAddress = buildAddress(
      applicationData.addressLine1,
      applicationData.addressLine2,
      applicationData.city,
      applicationData.state,
      applicationData.postalCode,
      applicationData.country
    );

    // ========== BUILD DYNAMIC EMAIL HTML ==========
    // Each section is built conditionally - only appears if it has data

    const contactInfoFields = [
      renderField('Name', applicationData.contactPersonName || applicationData.name),
      renderField('Email', applicationData.contactEmail || applicationData.email),
      renderField('Phone', applicationData.contactPhone || applicationData.phone),
      renderField('Position', applicationData.contactPersonPosition),
      renderField('Mobile', applicationData.contactPersonMobile)
    ];

    const companyInfoFields = [
      renderField('Company Name', applicationData.companyName),
      renderField('Address', formattedAddress),
      renderField('Website', applicationData.website),
      renderField('Telephone', applicationData.telephone),
      renderField('Fax', applicationData.fax),
      renderField('Industry', applicationData.industry),
      renderField('Company Size', applicationData.companySize),
      renderField('Number of Employees', applicationData.numberOfEmployees),
      renderField('Number of Locations', applicationData.numberOfLocations)
    ];

    const executiveManagerFields = [
      renderField('Name', applicationData.executiveManagerName),
      renderField('Email', applicationData.executiveManagerEmail),
      renderField('Mobile', applicationData.executiveManagerMobile)
    ];

    const certificationFields = [
      certificationsText ? renderField('Certifications Requested', certificationsText) : '',
      renderField('Certification Scope', applicationData.certificationScope),
      renderField('Certification Programme', applicationData.certificationProgramme),
      renderField('Current Certifications', applicationData.currentCertifications),
      renderField('Preferred Audit Date', applicationData.preferredAuditDate)
    ];

    const workforceFields = [
      renderField('Total Employees', applicationData.workforceTotalEmployees),
      renderField('Employees Per Shift', applicationData.workforceEmployeesPerShift),
      renderField('Number of Shifts', applicationData.workforceNumberOfShifts),
      renderField('Seasonal Employees', applicationData.workforceSeasonalEmployees)
    ];

    const iso9001Fields = [
      renderField('Design and Development', applicationData.iso9001DesignAndDevelopment),
      renderField('Other Non-Applicable Clauses', applicationData.iso9001OtherNonApplicableClauses),
      renderField('Non-Applicable Clauses Details', applicationData.iso9001OtherNonApplicableClausesText)
    ];

    const iso14001Fields = [
      renderField('Sites Managed', applicationData.iso14001SitesManaged),
      renderField('Register of Significant Aspects', applicationData.iso14001RegisterOfSignificantAspects),
      renderField('Environmental Management Manual', applicationData.iso14001EnvironmentalManagementManual),
      renderField('Internal Audit Programme', applicationData.iso14001InternalAuditProgramme),
      renderField('Internal Audit Implemented', applicationData.iso14001InternalAuditImplemented)
    ];

    const iso22000Fields = [
      renderField('HACCP Implementation', applicationData.iso22000HaccpImplementation),
      renderField('HACCP Studies', applicationData.iso22000HaccpStudies),
      renderField('Sites', applicationData.iso22000Sites),
      renderField('Process Lines', applicationData.iso22000ProcessLines),
      renderField('Processing Type', applicationData.iso22000ProcessingType)
    ];

    const iso45001Fields = [
      renderField('Hazards Identified', applicationData.iso45001HazardsIdentified),
      renderField('Critical Risks', applicationData.iso45001CriticalRisks)
    ];

    const transferFields = [
      renderField('Transfer Reason', applicationData.transferReason),
      renderField('Expiring Date', applicationData.transferExpiringDate)
    ];

    // Build the complete email HTML with only sections that have data
    let emailHTML = `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <h2 style="color: #0066cc; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">
            📋 NEW CERTIFICATION APPLICATION
          </h2>
          
          ${renderSection('Contact Information', '👤', contactInfoFields)}
          ${renderSection('Company Information', '🏢', companyInfoFields)}
          ${renderSection('Executive Manager Information', '👔', executiveManagerFields)}
          ${renderSection('Certification Details', '✅', certificationFields)}
          ${renderSection('Workforce Details', '👥', workforceFields)}
          ${renderSection('ISO 9001 Details', '📊', iso9001Fields)}
          ${renderSection('ISO 14001 Details', '🌍', iso14001Fields)}
          ${renderSection('ISO 22000 Details', '🍔', iso22000Fields)}
          ${renderSection('ISO 45001 Details', '⚠️', iso45001Fields)}
          ${!isEmpty(applicationData.transferReason) ? renderSection('Transfer Information', '🔄', transferFields) : ''}
          
          ${!isEmpty(applicationData.additionalInfo) ? `
            <h3 style="color: #0066cc; margin-top: 20px;">📝 Additional Information</h3>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px;">
              <p>${escapeHtml(applicationData.additionalInfo).replace(/\n/g, '<br>')}</p>
            </div>
          ` : ''}

          ${renderFilesSection(applicationData.uploadedFiles)}

          <!-- FOOTER -->
          <hr style="margin-top: 30px; border: none; border-top: 2px solid #ddd;">
          <p style="color: #666; font-size: 12px;">
            <strong>Submitted on:</strong> ${new Date().toLocaleString()}<br>
            ${applicationData.requestId ? `<strong>Request ID:</strong> ${escapeHtml(applicationData.requestId)}` : ''}
          </p>
          <p style="color: #999; font-size: 10px;">
            This is an automated notification from HORAS Certification System.<br>
            Do not reply to this email directly.
          </p>
        </body>
      </html>
    `;

    const info = await sendEmail({
      to: COMPANY_EMAIL,
      subject: `New Certification Application - ${escapeHtml(String(applicationData.companyName || 'Submission'))}`,
      html: emailHTML
    });

    logger.info('Application email sent to company', {
      to: COMPANY_EMAIL,
      company: applicationData.companyName,
      requestId: applicationData.requestId,
      filesCount: Array.isArray(applicationData.uploadedFiles) ? applicationData.uploadedFiles.length : 0,
      messageId: info.id
    });

    return { success: true, messageId: info.id };
  } catch (error) {
    logger.error('Error sending application email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send application confirmation to applicant (SIMPLE version for user)
 */
const sendApplicationReceivedToClient = async ({ to, requestId }) => {
  try {
    if (!to) {
      return { success: false, error: 'Recipient email is required' };
    }

    const safeRequestId = requestId ? escapeHtml(String(requestId)) : '';
    const safeTo = escapeHtml(String(to));

    const emailBody = `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <h2 style="color: #0066cc;">✅ Application Received</h2>
          
          <p>Thank you for submitting your certification application!</p>
          
          <div style="background-color: #e8f4f8; padding: 15px; border-left: 4px solid #0066cc; margin: 20px 0;">
            <p><strong>We have received your application and our team is reviewing it.</strong></p>
            <p>We will contact you soon with updates.</p>
          </div>

          <h3>Your Application Details:</h3>
          <ul style="background-color: #f9f9f9; padding: 15px; border-radius: 5px;">
            <li><strong>Request Number:</strong> <code style="background-color: #f0f0f0; padding: 2px 6px; border-radius: 3px;">${safeRequestId}</code></li>
            <li><strong>Status:</strong> <strong style="color: #ff9800;">Pending Review</strong></li>
            <li><strong>Confirmation Email:</strong> ${safeTo}</li>
          </ul>

          <h3>What Happens Next?</h3>
          <ol style="line-height: 2;">
            <li>Our team will review your application thoroughly</li>
            <li>We may contact you for additional information if needed</li>
            <li>You'll receive a status update via email</li>
            <li>Official certification process will begin upon approval</li>
          </ol>

          <hr style="margin-top: 30px; border: none; border-top: 2px solid #ddd;">
          <p style="color: #666; font-size: 12px;">
            <strong>Questions?</strong> Contact us at <strong>info@horascert.com</strong>
          </p>
          <p style="color: #999; font-size: 10px;">
            This is an automated confirmation from HORAS Certification System.<br>
            Please keep this email for your records. Do not reply to this email directly.
          </p>
        </body>
      </html>
    `;

    const info = await sendEmail({
      to,
      subject: 'Your Certification Application Has Been Received',
      html: emailBody
    });

    logger.info('Application confirmation email sent to client', {
      to,
      requestId,
      messageId: info.id
    });

    return { success: true, messageId: info.id };
  } catch (error) {
    logger.error('Error sending application confirmation:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send application status update to applicant
 */
const sendApplicationStatusUpdateToClient = async ({ to, requestId, oldStatus, newStatus, companyName }) => {
  try {
    if (!to) {
      return { success: false, error: 'Recipient email is required' };
    }

    const safeRequestId = requestId ? escapeHtml(String(requestId)) : '';
    const safeOldStatus = oldStatus ? escapeHtml(String(oldStatus)) : '';
    const safeNewStatus = newStatus ? escapeHtml(String(newStatus)) : '';
    const safeCompanyName = companyName ? escapeHtml(String(companyName)) : '';

    const emailBody = `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          ${safeCompanyName ? `<p style="background-color: #e8f4f8; padding: 12px; border-left: 4px solid #0066cc; margin-bottom: 20px;"><strong>Company:</strong> ${safeCompanyName}</p>` : ''}
          <h2 style="color: #0066cc;">Application Status Updated</h2>
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px;">
            <p><strong>Request Number:</strong> ${safeRequestId}</p>
            <p><strong>Previous Status:</strong> <span style="color: #d9534f;">${safeOldStatus}</span></p>
            <p><strong>New Status:</strong> <span style="color: #5cb85c;">${safeNewStatus}</span></p>
          </div>
          <hr style="margin-top: 30px; border: none; border-top: 2px solid #ddd;">
          <p style="color: #999; font-size: 10px;">
            This is an automated notification from HORAS Certification System.<br>
            Please do not reply to this email directly.
          </p>
        </body>
      </html>
    `;

    const info = await sendEmail({
      to,
      subject: 'Application Status Update',
      html: emailBody
    });

    return { success: true, messageId: info.id };
  } catch (error) {
    logger.error('Error sending status update email:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================
// 2. CONTACT FORM EMAILS
// ============================================================

/**
 * Send contact form submission to company
 */
const sendContactEmail = async (contactData) => {
  try {
    const safeName = escapeHtml(contactData.name);
    const safeEmail = escapeHtml(contactData.email);
    const safePhone = contactData.phone ? escapeHtml(contactData.phone) : 'N/A';
    const safeSubject = escapeHtml(contactData.subject);
    const safeMessage = escapeHtml(contactData.message).replace(/\n/g, '<br>');

    const emailBody = `
      <h2>New Contact Form Submission</h2>
      <h3>From:</h3>
      <p><strong>Name:</strong> ${safeName}</p>
      <p><strong>Email:</strong> ${safeEmail}</p>
      <p><strong>Phone:</strong> ${safePhone}</p>
      <h3>Message:</h3>
      <p><strong>Subject:</strong> ${safeSubject}</p>
      <p>${safeMessage}</p>
      <hr>
      <p><small>Submitted on: ${new Date().toLocaleString()}</small></p>
    `;

    const info = await sendEmail({
      to: COMPANY_EMAIL,
      subject: `Contact Form: ${String(contactData.subject || 'New Inquiry')}`,
      html: emailBody
    });

    return { success: true, messageId: info.id };
  } catch (error) {
    logger.error('Error sending contact email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send auto-reply to contact form submitter
 */
const sendContactAutoReplyToClient = async ({ to, name }) => {
  try {
    if (!to) {
      return { success: false, error: 'Recipient email is required' };
    }

    const safeName = name ? escapeHtml(String(name)) : '';

    const emailBody = `
      <h2>We Received Your Message</h2>
      <p>Dear ${safeName || 'Valued Customer'},</p>
      <p>Thank you for contacting us. We have received your message and our team will respond as soon as possible.</p>
      <hr>
      <p><small>This is an automated response. Please do not reply.</small></p>
    `;

    const info = await sendEmail({
      to,
      subject: 'We Received Your Message',
      html: emailBody
    });

    return { success: true, messageId: info.id };
  } catch (error) {
    logger.error('Error sending contact auto-reply:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send reply from admin to contact form
 */
const sendReplyToUser = async ({ to, userName, replyMessage }) => {
  try {
    if (!to) {
      return { success: false, error: 'Recipient email is required' };
    }

    if (!replyMessage || replyMessage.trim() === '') {
      return { success: false, error: 'Reply message is required' };
    }

    const safeName = userName ? escapeHtml(String(userName)) : 'Valued Customer';
    const safeMessage = escapeHtml(replyMessage).replace(/\n/g, '<br>');

    const emailBody = `
      <h2>Response to Your Inquiry</h2>
      <p>Dear ${safeName},</p>
      <p>Thank you for reaching out. Here is our response:</p>
      <div style="background-color: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #007bff;">
        <p>${safeMessage}</p>
      </div>
      <p>If you have further questions, please feel free to contact us.</p>
      <hr>
      <p><small>Best regards,<br/>
      <strong>HORAS Certification Team</strong><br/>
      <a href="https://horascert.com">horascert.com</a></small></p>
    `;

    const info = await sendEmail({
      to,
      subject: 'Response to Your Inquiry',
      html: emailBody
    });

    return { success: true, messageId: info.id };
  } catch (error) {
    logger.error('Error sending reply email:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================
// 3. CERTIFICATE EMAILS
// ============================================================

/**
 * Send certificate notification to company (internal)
 */
const sendCertificateNotification = async (certificate) => {
  try {
    const emailBody = `
      <h2>New Certificate Created</h2>
      <h3>Certificate Information:</h3>
      <p><strong>Certificate Number:</strong> ${escapeHtml(certificate.certificateNumber)}</p>
      <p><strong>Company:</strong> ${escapeHtml(certificate.companyName)}</p>
      <p><strong>Standard:</strong> ${escapeHtml(certificate.standard)}</p>
      <p><strong>Scope:</strong> ${escapeHtml(certificate.scope)}</p>
      <p><strong>Issue Date:</strong> ${certificate.issueDate ? new Date(certificate.issueDate).toLocaleDateString() : 'N/A'}</p>
      <p><strong>Expiry Date:</strong> ${certificate.expiryDate ? new Date(certificate.expiryDate).toLocaleDateString() : 'N/A'}</p>
      <hr>
      <p><small>Created on: ${new Date().toLocaleString()}</small></p>
    `;

    const info = await sendEmail({
      to: COMPANY_EMAIL,
      subject: `New Certificate: ${certificate.companyName}`,
      html: emailBody
    });

    return { success: true, messageId: info.id };
  } catch (error) {
    logger.error('Error sending certificate notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send certificate to company
 */
const sendCertificateToCompany = async (certificate) => {
  try {
    if (!certificate.companyEmail) {
      return { success: false, error: 'Company email is required' };
    }

    const emailBody = `
      <h2>Your ISO Certificate</h2>
      <p>Hello,</p>
      <p>Your ISO certificate has been issued successfully.</p>
      <h3>Certificate Details:</h3>
      <p><strong>Certificate Number:</strong> ${escapeHtml(certificate.certificateNumber)}</p>
      <p><strong>Company:</strong> ${escapeHtml(certificate.companyName)}</p>
      <p><strong>Standard:</strong> ${escapeHtml(certificate.standard)}</p>
      <p><strong>Scope:</strong> ${escapeHtml(certificate.scope)}</p>
      <p><strong>Issue Date:</strong> ${certificate.issueDate ? new Date(certificate.issueDate).toLocaleDateString() : 'N/A'}</p>
      <p><strong>Expiry Date:</strong> ${certificate.expiryDate ? new Date(certificate.expiryDate).toLocaleDateString() : 'N/A'}</p>
      <h3>Verify Your Certificate:</h3>
      <p><a href="${process.env.FRONTEND_URL || 'https://horascert.com'}/certificate/${certificate.certificateId}" target="_blank">View Certificate</a></p>
      <p>Thank you.</p>
      <p><strong>HORAS Certification</strong></p>
      <hr>
      <p><small>This is an automated message. Please do not reply.</small></p>
    `;

    const info = await sendEmail({
      to: certificate.companyEmail,
      subject: `Your ISO Certificate - ${certificate.companyName}`,
      html: emailBody
    });

    return { success: true, messageId: info.id };
  } catch (error) {
    logger.error('Error sending certificate to company:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================
// 4. TRAINING CERTIFICATE EMAILS
// ============================================================

/**
 * Send training certificate notification to company (internal)
 */
const sendTrainingCertificateNotification = async (certificate) => {
  try {
    const emailBody = `
      <h2>New Training Certificate Created</h2>
      <h3>Certificate Details:</h3>
      <p><strong>Certificate Number:</strong> ${escapeHtml(certificate.certificateNumber)}</p>
      <p><strong>Trainee Name:</strong> ${escapeHtml(certificate.trainee.name)}</p>
      <p><strong>Organization:</strong> ${escapeHtml(certificate.trainee.organization)}</p>
      <p><strong>Course:</strong> ${escapeHtml(certificate.training.courseName)}</p>
      <p><strong>Training Hours:</strong> ${certificate.training.hours}</p>
      <p><strong>Expiry Date:</strong> ${certificate.expiryDate ? new Date(certificate.expiryDate).toLocaleDateString() : 'N/A'}</p>
      <hr>
      <p><small>Created on: ${new Date().toLocaleString()}</small></p>
    `;

    const info = await sendEmail({
      to: COMPANY_EMAIL,
      subject: `New Training Certificate: ${certificate.trainee.name}`,
      html: emailBody
    });

    return { success: true, messageId: info.id };
  } catch (error) {
    logger.error('Error sending training certificate notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send training certificate to trainee
 */
const sendTrainingCertificateToTrainee = async (certificate) => {
  try {
    if (!certificate.trainee.email) {
      return { success: false, error: 'Trainee email is required' };
    }

    const emailBody = `
      <h2>Your Training Certificate</h2>
      <p>Dear ${escapeHtml(certificate.trainee.name)},</p>
      <p>Congratulations! Your training certificate has been successfully issued.</p>
      <h3>Certificate Details:</h3>
      <p><strong>Certificate Number:</strong> ${escapeHtml(certificate.certificateNumber)}</p>
      <p><strong>Organization:</strong> ${escapeHtml(certificate.trainee.organization)}</p>
      <p><strong>Course Name:</strong> ${escapeHtml(certificate.training.courseName)}</p>
      <p><strong>Training Hours:</strong> ${certificate.training.hours}</p>
      <p><strong>Training Date:</strong> ${certificate.training.date ? new Date(certificate.training.date).toLocaleDateString() : 'N/A'}</p>
      <p><strong>Issue Date:</strong> ${new Date(certificate.issueDate).toLocaleDateString()}</p>
      <p><strong>Expiry Date:</strong> ${new Date(certificate.expiryDate).toLocaleDateString()}</p>
      <h3>Verify Your Certificate:</h3>
      <p><a href="${process.env.FRONTEND_URL || 'https://horascert.com'}/verify/training/${certificate.certificateNumber}" target="_blank">View Certificate</a></p>
      <p>Thank you for choosing HORAS for your training needs.</p>
      <hr>
      <p><small>This is an automated message. Please do not reply.</small></p>
    `;

    const info = await sendEmail({
      to: certificate.trainee.email,
      subject: `Your Training Certificate - ${certificate.trainee.name}`,
      html: emailBody
    });

    return { success: true, messageId: info.id };
  } catch (error) {
    logger.error('Error sending training certificate to trainee:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  sendEmail,
  sendApplicationEmail,
  sendApplicationReceivedToClient,
  sendApplicationStatusUpdateToClient,
  sendContactEmail,
  sendContactAutoReplyToClient,
  sendReplyToUser,
  sendCertificateNotification,
  sendCertificateToCompany,
  sendTrainingCertificateNotification,
  sendTrainingCertificateToTrainee
};
