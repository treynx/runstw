// Contact form reCAPTCHA gate: the browser sends the reCAPTCHA v3 token here,
// this verifies it with Google, and replies whether the submission may proceed.
// Actual email delivery happens in the browser (contact.html -> FormSubmit),
// because FormSubmit blocks server-to-server calls.
//
// Environment variable (set in Vercel):
//   RECAPTCHA_SECRET - private key used to verify tokens (never sent to the browser)
//
// If RECAPTCHA_SECRET is not set, or Google can't be reached, this responds "ok"
// so the form keeps working (the honeypot still guards it). It only blocks when
// Google actively reports the token as spam / failed.

const RECAPTCHA_MIN_SCORE = 0.5;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { token } = req.body || {};
  const secret = process.env.RECAPTCHA_SECRET;

  // Not configured yet -> don't block; honeypot still guards the form.
  if (!secret) {
    res.status(200).json({ ok: true, verified: false });
    return;
  }

  try {
    const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token || '' }),
    });
    const verify = await verifyRes.json();
    const scoreOk = typeof verify.score !== 'number' || verify.score >= RECAPTCHA_MIN_SCORE;

    if (verify.success && scoreOk) {
      res.status(200).json({ ok: true, verified: true });
    } else {
      res.status(400).json({ ok: false, error: "That didn't pass our spam check. Please try again." });
    }
  } catch (err) {
    // Transient outage reaching Google -> let it through rather than break the form.
    res.status(200).json({ ok: true, verified: false });
  }
}
