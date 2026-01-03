import axios from 'axios';

export default async function handler(req, res) {
  // Difyからクエリパラメータで orderId を受け取る想定
  const { orderId } = req.query;

  if (!orderId) {
    return res.status(400).json({ error: 'orderId is required' });
  }

  try {
    // 1. トークン取得 (client_credentials)
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', process.env.BOSS_CLIENT_ID);
    params.append('client_secret', process.env.BOSS_CLIENT_SECRET);

    const tokenRes = await axios.post(process.env.BOSS_TOKEN_ENDPOINT, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const accessToken = tokenRes.data.access_token;

    // 2. BOSS API (GetOrder) の呼び出し
    // APIの正確なパスが /GetOrder の場合
    const bossRes = await axios.get(`${process.env.BOSS_API_BASE_URL}GetOrder`, {
      params: { orderId: orderId }, 
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    // 3. レスポンスをそのままDifyに返す
    res.status(200).json(bossRes.data);

  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Proxy Error',
      details: error.response?.data || error.message
    });
  }
}
