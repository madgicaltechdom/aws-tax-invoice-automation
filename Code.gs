// ============================================================
// AWS GST Invoice Automation — Google Apps Script
// ============================================================

// --------------- Configuration ---------------

const CONFIG = {
  FOLDER_ID : "YOUR_FOLDER_ID",
  SHEET_ID  : "YOUR_SHEET_ID",
  SHEET_NAME: "YOUR_SHEET_NAME",
  ACCOUNT_ID: "YOUR_AWS_ACCOUNT_ID",
  ENDPOINT  : "https://invoicing.us-east-1.api.aws",
  SERVICE   : "invoicing",
  REGION    : "us-east-1",
  ALERT_EMAIL: Session.getActiveUser().getEmail(), // Change if needed
};

// --------------- Entry Point ---------------

function downloadCurrentMonthTaxInvoice() {
  Logger.log("🚀 Starting AWS GST Invoice Automation...\n");

  const creds = getCredentials_();
  if (!creds) return;

  const period     = getCurrentMonthPeriod_();
  const summaries  = fetchInvoiceSummaries_(creds, period);
  if (!summaries) return;

  const gstInvoices = summaries.filter(inv => inv.InvoiceId.startsWith("AIN"));
  if (gstInvoices.length === 0) {
    Logger.log("⚠️ No GST (AIN) invoices found.");
    return;
  }

  const sheet          = getOrInitSheet_();
  const existingIds    = getExistingInvoiceIds_(sheet);
  const folder         = DriveApp.getFolderById(CONFIG.FOLDER_ID);

  gstInvoices.forEach(inv =>
    processInvoice_(inv.InvoiceId, period.monthLabel, creds, sheet, existingIds, folder)
  );

  Logger.log("🎉 Automation Complete!");
}

// --------------- Invoice Processing ---------------

function processInvoice_(invoiceId, monthLabel, creds, sheet, existingIds, folder) {
  const fileName = buildFileName_(monthLabel);

  const inSheet = existingIds.includes(invoiceId);
  const existingFile = findFileInFolder_(folder, fileName);
  const inDrive = existingFile !== null;

  if (inSheet && inDrive) {
    Logger.log(`⚠️ Invoice ${invoiceId} already in Sheet and Drive. Skipping.`);
    return;
  }

  let savedFile;

  if (!inDrive) {
    savedFile = downloadAndSaveInvoice_(invoiceId, fileName, creds, folder);
    if (!savedFile) return; // error already logged + alerted inside
  } else {
    savedFile = existingFile;
    Logger.log(`⚠️ File already in Drive: ${fileName}`);
  }

  if (!inSheet) {
    appendToSheet_(sheet, invoiceId, fileName, savedFile.getUrl());
  } else {
    Logger.log(`⚠️ Invoice ${invoiceId} already logged in Sheet. Skipping entry.`);
  }
}

function downloadAndSaveInvoice_(invoiceId, fileName, creds, folder) {
  const pdfUrl = fetchInvoicePdfUrl_(invoiceId, creds);
  if (!pdfUrl) return null;

  try {
    const blob = UrlFetchApp.fetch(pdfUrl).getBlob().setName(fileName);
    const file = folder.createFile(blob);
    Logger.log(`✅ Saved GST Invoice to Drive: ${fileName}`);
    return file;
  } catch (e) {
    const msg = `❌ Failed to download/save PDF for ${invoiceId}: ${e.message}`;
    Logger.log(msg);
    sendAlert_(msg);
    return null;
  }
}

// --------------- AWS API Calls ---------------

function fetchInvoiceSummaries_(creds, period) {
  const payload = JSON.stringify({
    Selector: { ResourceType: "ACCOUNT_ID", Value: CONFIG.ACCOUNT_ID },
    Filter: {
      TimeInterval: {
        StartDate: Math.floor(period.startDate.getTime() / 1000),
        EndDate  : Math.floor(period.endDate.getTime()   / 1000),
      }
    }
  });

  const response = awsRequest_("Invoicing.ListInvoiceSummaries", payload, creds);
  if (!response) return null;

  const data = JSON.parse(response.getContentText());
  if (!data.InvoiceSummaries || data.InvoiceSummaries.length === 0) {
    Logger.log("⚠️ No invoices found for this month.");
    return null;
  }
  return data.InvoiceSummaries;
}

function fetchInvoicePdfUrl_(invoiceId, creds) {
  const payload  = JSON.stringify({ InvoiceId: invoiceId });
  const response = awsRequest_("Invoicing.GetInvoicePDF", payload, creds);
  if (!response) return null;

  const data = JSON.parse(response.getContentText());
  const url  = data?.InvoicePDF?.DocumentUrl;

  if (!url) {
    const msg = `❌ PDF URL not found for invoice ${invoiceId}`;
    Logger.log(msg);
    sendAlert_(msg);
    return null;
  }
  return url;
}

function awsRequest_(target, payload, creds) {
  const response = awsSignedRequestWithTarget_(
    "POST",
    CONFIG.ENDPOINT,
    CONFIG.SERVICE,
    CONFIG.REGION,
    target,
    payload,
    creds.accessKey,
    creds.secretKey
  );

  if (response.getResponseCode() !== 200) {
    const msg = `❌ AWS request failed [${target}] — HTTP ${response.getResponseCode()}: ${response.getContentText()}`;
    Logger.log(msg);
    sendAlert_(msg);
    return null;
  }
  return response;
}

// --------------- AWS Signature V4 ---------------

function awsSignedRequestWithTarget_(method, endpoint, service, region, target, payload, accessKey, secretKey) {
  const host    = endpoint.replace("https://", "");
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);

  const canonicalHeaders =
    "content-type:application/x-amz-json-1.1\n" +
    "host:" + host + "\n" +
    "x-amz-date:" + amzDate + "\n" +
    "x-amz-target:" + target + "\n";

  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const payloadHash   = sha256Hex_(payload);

  const canonicalRequest =
    method + "\n/\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign    =
    "AWS4-HMAC-SHA256\n" + amzDate + "\n" + credentialScope + "\n" + sha256Hex_(canonicalRequest);

  const signingKey = getSignatureKey_(secretKey, dateStamp, region, service);
  const signature  = hmacHex_(signingKey, stringToSign);

  const authorizationHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return UrlFetchApp.fetch(endpoint, {
    method      : method,
    contentType : "application/x-amz-json-1.1",
    headers     : {
      "Authorization": authorizationHeader,
      "X-Amz-Date"   : amzDate,
      "X-Amz-Target" : target,
    },
    payload           : payload,
    muteHttpExceptions: true,
  });
}

function getSignatureKey_(secretKey, dateStamp, regionName, serviceName) {
  const kSecret  = Utilities.newBlob("AWS4" + secretKey).getBytes();
  const kDate    = Utilities.computeHmacSha256Signature(Utilities.newBlob(dateStamp).getBytes(),    kSecret);
  const kRegion  = Utilities.computeHmacSha256Signature(Utilities.newBlob(regionName).getBytes(),   kDate);
  const kService = Utilities.computeHmacSha256Signature(Utilities.newBlob(serviceName).getBytes(),  kRegion);
  return           Utilities.computeHmacSha256Signature(Utilities.newBlob("aws4_request").getBytes(), kService);
}

function hmacHex_(keyBytes, text) {
  return Utilities.computeHmacSha256Signature(Utilities.newBlob(text).getBytes(), keyBytes)
    .map(b => ("0" + (b & 0xff).toString(16)).slice(-2)).join("");
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)
    .map(b => ("0" + (b & 0xff).toString(16)).slice(-2)).join("");
}

// --------------- Sheet Helpers ---------------

function getOrInitSheet_() {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["GST Invoice No", "GST No", "Drive File Name", "PDF Link"]);
  }
  return sheet;
}

function getExistingInvoiceIds_(sheet) {
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
}

function appendToSheet_(sheet, invoiceId, fileName, driveLink) {
  const gstNumber = PropertiesService.getScriptProperties().getProperty("GST_NUMBER");
  sheet.appendRow([invoiceId, gstNumber, fileName, driveLink]);
  Logger.log(`✅ Logged invoice ${invoiceId} to Google Sheet`);
}

// --------------- Drive Helpers ---------------

/**
 * Returns the first matching DriveApp File object, or null if not found.
 * Avoids the fragile hasNext() → next() split from the original code.
 */
function findFileInFolder_(folder, fileName) {
  const files = folder.getFilesByName(fileName);
  return files.hasNext() ? files.next() : null;
}

// --------------- Utility Helpers ---------------

function getCredentials_() {
  const props     = PropertiesService.getScriptProperties();
  const accessKey = props.getProperty("AWS_ACCESS_KEY");
  const secretKey = props.getProperty("AWS_SECRET_KEY");
  if (!accessKey || !secretKey) {
    Logger.log("❌ Missing AWS credentials in Script Properties.");
    return null;
  }
  return { accessKey, secretKey };
}

function getCurrentMonthPeriod_() {
  const now   = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    startDate  : start,
    endDate    : end,
    monthLabel : start.toLocaleString("en-US", { month: "long", year: "numeric" })
                      .replace(" ", "-"), // e.g. "June-2025" — no spaces in filenames
  };
}

function buildFileName_(monthLabel) {
  return `AWS-GST-Invoice-${monthLabel}.pdf`;
}

function sendAlert_(message) {
  try {
    MailApp.sendEmail({
      to     : CONFIG.ALERT_EMAIL,
      subject: "⚠️ AWS GST Invoice Automation Error",
      body   : message,
    });
  } catch (e) {
    Logger.log("⚠️ Could not send alert email: " + e.message);
  }
}