# Data safety answer sheet — com.app.mmpl v2.0.0
Based on what the app/server actually stores. Re-check before submitting.

## Overview
- Does the app collect or share any required user data types? **Yes**
- Is all user data encrypted in transit? **Yes** (HTTPS only; `.app` is HSTS-preloaded)
- Do you provide a way for users to request that their data is deleted? **Yes** — in-app (Account → Request account deletion) and at https://store.mohanmishra.app/delete-account

## Data types
| Category | Type | Collected | Shared | Optional? | Purposes |
|---|---|---|---|---|---|
| Personal info | Name | Yes | Yes (seller fulfilling order, logistics) | Required | App functionality, Account management |
| Personal info | Email address | Yes | No | Required (email or phone) | Account management, Communications |
| Personal info | Phone number | Yes | Yes (seller, logistics for delivery) | Required | Account management, App functionality |
| Personal info | Address | Yes | Yes (seller, logistics) | Required for orders | App functionality |
| Personal info | Other info (business name, GSTIN) | Yes | Yes (seller, on invoice) | Optional | App functionality |
| Financial info | Purchase history | Yes | Yes (seller of that order) | Required for orders | App functionality |
| Financial info | Payment info | Payment status/reference only; card/UPI details handled by the payment gateway | Yes (payment gateway) | Required to pay | App functionality, Fraud prevention |
| Financial info | Other (vendor PAN, GSTIN, bank account for payouts) | Yes, vendors only | No | Required for vendors | App functionality |
| Messages | Other in-app messages (enquiries/quotes) | Yes | Yes (the seller addressed) | Optional | App functionality |
| Photos and videos / Files and docs | Product photos & documents uploaded by vendors | Yes | No (published on listing by vendor) | Optional | App functionality |
| App activity | App interactions (minimal server logs) | Yes | No | Required | Analytics/diagnostics, Security |
| App info and performance | Crash logs / Diagnostics | No | — | — | — |
| Device or other IDs | — | **No** | — | — | — |
| Location | — | **No** (addresses typed by user only) | — | — | — |
| Contacts, Calendar, Health, Audio, Web history | — | **No** | — | — | — |

Notes
- "Shared" = transferred to a third party: the selling vendor, the logistics partner and the payment gateway, only to fulfil the order. No advertising, no data sale.
- Data is processed ephemerally? No — stored on our servers.
- Retention: tax/invoice records 8 years (legal requirement); logs 180 days; rest deleted on account deletion.
- No ads SDK, no analytics SDK in the Android app (WebView shell, INTERNET permission only).
