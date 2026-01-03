// api/boss/oauth/callback.js
export default function handler(req, res) {
  res.status(200).send('OAuth Callback Endpoint (Ready)');
}
