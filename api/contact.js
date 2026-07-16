// Contact form backend: verifies a reCAPTCHA v3 token server-side, then
// hands the message to FormSubmit for delivery to info@runstw.com.
//
// Environment variables (set in Vercel):
//   RECAPTCHA_SITE_KEY  - public key, served to the page so it can load reCAPTCHA
//   RECAPTCHA_SECRET    - private key, used here to verify tokens (never sent to the browser)
//
// If RECAPTCHA_SECRET is not set, verification is skipped and the honeypot
// alone guards the form, so the page keeps working before the keys are added.

const RECAPTCHA_MIN_SCORE = 0.5;
const CONTACT_EMAIL = 'info@runstw.com';

export default async function handler(req, res) {
  // GET: hand the public site key to the page so it can load reCAPTCHA.
  if (req.method === 'GET') {
    res.status(200).json({ siteKey: process.env.RECAPTCHA_SITE_KEY || '' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { name, email, message, token, _honey } = req.body || {};

  // Honeypot: real people leave this blank. Pretend success and drop it.
  if (_honey) {
    res.status(200).json({ success: true });
    return;
  }

  if (!name || !email || !message) {
    res.status(400).json({ error: 'Please fill in your name, email, and message.' });
    return;
  }

  const secret = process.env.RECAPTCHA_SECRET;
  if (secret) {
    try {
      const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token || '' }),
      });
      const verify = await verifyRes.json();
      const scoreOk = typeof verify.score !== 'number' || verify.score >= RECAPTCHA_MIN_SCORE;
      if (!verify.success || !scoreOk) {
        res.status(400).json({ error: "That didn't pass our spam check. Please try again." });
        return;
      }
    } catch (err) {
      res.status(502).json({ error: 'Could not reach the spam checker. Please try again shortly.' });
      return;
    }
  }

  // Deliver via FormSubmit's AJAX endpoint (info@runstw.com already activated).
  try {
    const mailRes = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name,
        email,
        message,
        _subject: 'New message from runstw.com',
        _template: 'table',
      }),
    });
    if (!mailRes.ok) throw new Error('mail relay returned ' + mailRes.status);
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(502).json({ error: 'Message could not be sent right now. Please email us directly.' });
  }
}
