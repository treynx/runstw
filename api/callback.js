export default async function handler(req, res) {
  const { code } = req.query;
  const clientId = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;

  if (!code) {
    res.status(400).send(renderMessage('error', 'Missing authorization code'));
    return;
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      res.status(400).send(renderMessage('error', tokenData.error_description || tokenData.error));
      return;
    }

    res.status(200).send(renderMessage('success', tokenData.access_token));
  } catch (err) {
    res.status(500).send(renderMessage('error', err.message));
  }
}

function renderMessage(status, content) {
  const message = status === 'success'
    ? `authorization:github:success:${JSON.stringify({ token: content, provider: 'github' })}`
    : `authorization:github:error:${JSON.stringify({ message: content })}`;

  return `<!DOCTYPE html>
<html>
<body>
<script>
  (function() {
    function receiveMessage(e) {
      window.opener.postMessage(
        ${JSON.stringify(message)},
        e.origin
      );
      window.removeEventListener('message', receiveMessage, false);
    }
    window.addEventListener('message', receiveMessage, false);
    window.opener.postMessage('authorizing:github', '*');
  })();
</script>
</body>
</html>`;
}
