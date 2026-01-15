// /api/boss/orders/search.ts

async function getAccessToken() {
  const res = await fetch('https://boss-api-proxy.vercel.app/api/boss/token');

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token fetch failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error('access_token not found in token response');
  }

  return json.access_token;
}

export default async function handler(req, res) {
  try {
    // ① access_token 取得
    const accessToken = await getAccessToken();

    // ② BOSS SearchOrder を実行
    const apiRes = await fetch(
      'https://api.boss-oms.jp/BOSS-API/v1/orders/search',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req.body),
      }
    );

    const text = await apiRes.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: 'invalid json from boss api',
        raw: text,
      });
    }

    // ③ ★重要：レスポンス正規化
    // BOSS が [12345] を返してきても
    // { orders: [12345] } に揃える
    if (Array.isArray(json)) {
      return res.status(apiRes.status).json({
        orders: json,
      });
    }

    // すでに { orders: [...] } 形式ならそのまま返す
    return res.status(apiRes.status).json(json);

  } catch (e) {
    console.error('search error', e);
    return res.status(500).json({
      error: 'search failed',
      message: String(e),
    });
  }
}
