// Fixed to the CMS's actual base_url (admin/config.yml) rather than trusting
// req.headers.host, which a client can set to anything — building the OAuth
// redirect_uri from it would let a forged Host header steer where GitHub is
// told to send the authorization code.
const CALLBACK_HOST = 'runstw.vercel.app';

export default function handler(req, res) {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const redirectUri = `https://${CALLBACK_HOST}/api/callback`;
  const scope = 'repo,user';

  const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}`;

  res.writeHead(302, { Location: authUrl });
  res.end();
}
