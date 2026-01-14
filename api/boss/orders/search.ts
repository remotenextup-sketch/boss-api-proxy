async function getAccessToken() {
  const r = await fetch(
    'https://boss-api-proxy.vercel.app/api/boss/token'
  );
  const j = await r.json();
  return j.access_token;
}

export default async function handler(req, res) {
  const token = await getAccessToken();

  const apiRes = await fetch(
    'https://api.boss-oms.jp/BOSS-API/v1/orders/search',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    }
  );

  const json = await apiRes.json();
  return res.status(200).json(json);
}
