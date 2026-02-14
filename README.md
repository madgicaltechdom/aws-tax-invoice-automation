# aws-tax-invoice-automation (Google Apps Script)

## Overview

This project automates the downloading of AWS Tax (GST) invoices using the AWS Invoicing API and stores:

- PDF files in Google Drive
- Invoice details in Google Sheets
- Prevents duplicate downloads
- Runs automatically using time-based triggers

## Features

- Fetches GST (AIN) invoices only
- Uses AWS Signature V4 authentication
- Saves PDF to Google Drive
- Logs Invoice ID and GST number to Google Sheet
- Skips duplicate invoices (Drive + Sheet check)
- Monthly automated trigger support

## Requirements

- AWS Account (Billing access enabled)
- AWS IAM User with:
    - invoicing:ListInvoiceSummaries
    - invoicing:GetInvoicePDF
- AWS Access Key & Secret Key
- Google Account
- Google Drive
- Google Sheet
- Google Apps Script

## Setup Instructions

### Step 1: Create Google Sheet

1. Create a new Google Sheet.
2. Note the Sheet ID from the URL.
3. Default sheet name should be: Sheet1.

### Step 2: Create Drive Folder

1. Create a folder in Google Drive.
2. Copy the Folder ID from URL.

### Step 3: Add Google Apps Script

1. Open the Google Sheet.
2. Go to Extensions → Apps Script.
3. Delete default code.
4. Paste contents of Code.gs.
5. Save the project.

### Step 4: Add Script Properties

In Apps Script:

1. Click Project Settings (⚙️ icon)
2. Scroll to Script Properties
3. Add:

```
| Key	          |    Value
------------------------------------------
| AWS_ACCESS_KEY  |	   Your AWS Access Key
| AWS_SECRET_KEY  |    Your AWS Secret Key
| GST_NUMBER	  |    Your GST Number
```

### Step 5: Update IDs in Code

Replace:

```
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
```

With your actual IDs.

### Step 6: Authorize Script

1. Run downloadCurrentMonthTaxInvoice() manually.
2. Grant required permissions:
    - Google Drive
    - Google Sheets
    - External API requests

## Setup Auto Trigger

1. Open Apps Script.
2. Click Triggers (Clock icon).
3. Click Add Trigger.
4. Select:
- Function: downloadCurrentMonthTaxInvoice
- Event Source: Time-driven
- Type: Month timer
- Day: 3rd of every month
- Time: 6 AM (recommended)
This ensures AWS invoices (usually available by 1st–3rd) are fetched automatically.

## How It Works

1. Calculates current month.
2. Calls AWS Invoicing.ListInvoiceSummaries.
3. Filters invoices starting with AIN.
4. Checks:
- If file exists in Drive
- If Invoice ID exists in Sheet
5. Downloads only new invoices.
6. Logs invoice details in Sheet.

## Output Example

Drive File Name:
```
AWS-GST-Invoice-February 2026.pdf
```

Sheet Columns:

- GST Invoice No
- GST No
- Drive File Name
- PDF Link

## Security Notes

1. AWS credentials are stored in Script Properties, not in code.
2. Repository does NOT contain credentials.
3. Do not commit keys to GitHub.

## Future Improvements (Optional)

1. Add email notification on new invoice
2. Auto-fetch previous month instead of current
3. Store invoice amount & GST breakdown
4. Multi-account support

## Automation Ready!

Once setup is complete, invoices will automatically download every month without manual intervention.