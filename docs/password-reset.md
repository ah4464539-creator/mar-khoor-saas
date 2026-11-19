# Password reset ("Forgot password?")

Restaurant owners, managers and staff can reset their own password from the login card on `/restaurant.html`.

## Flow
1. **Forgot password?** opens the reset form inside the same card. The user enters their email.
2. `POST /auth/password/forgot` always answers with the same message, so it never reveals whether an email is registered.
   If the account exists, a one-time link is emailed: `https://mar-khoor.com/restaurant.html#reset-token=…`.
   The token sits in the URL fragment, so it is not sent to the server log or in `Referer` headers, and the page removes it from the address bar immediately.
3. `POST /auth/password/reset` sets the new password (minimum 12 characters), marks every open link for that user as used and deletes all of that user's sessions (every device is signed out).

## Security rules
- Only a SHA-256 hash of the token is stored (`password_resets` table). Links expire after 30 minutes and work once; requesting a new link revokes older ones.
- At most 3 emails per address per hour, plus 10 reset requests per IP per 15 minutes.
- Platform super admins cannot reset by email. Reset the owner account on the server with `npm run create-super-admin`.
- If email is not configured, the form says so honestly (HTTP 503) instead of pretending a link was sent.

## Deployment (Hostinger)
1. Back up the database, then apply `db/migrations/password-resets.sql` (additive; also included in `db/schema.sql` / `npm run migrate`).
2. Create a mailbox such as `no-reply@mar-khoor.com` in Hostinger Email.
3. Set these environment variables on the Node app and restart it:
   `PUBLIC_BASE_URL=https://mar-khoor.com`, `MAIL_FROM="Mar-Khoor <no-reply@mar-khoor.com>"`,
   `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USER=no-reply@mar-khoor.com`, `SMTP_PASSWORD=<mailbox password>`.
   (Alternatively set `RESEND_API_KEY` instead of the SMTP variables.)
4. Test on staging: request a link for a test restaurant account, open it, set a new password, confirm the old password fails and the new one works, and confirm the link cannot be reused.
