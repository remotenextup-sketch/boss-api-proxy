// api/boss/orders/get.ts
import { getAccessToken } from '../token'

export default async function handler(req, res) {
  try {
    const { orderId } = req.body
    if (!orderId) {
      return res.status(400).json({ error: 'orderId required' })
    }

    const accessToken = await getAccessToken()

    const r = await fetch(
      'https://api.boss-oms.jp/BOSS-API/v1/orders/list',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          orders: [Number(orderId)]
        })
      }
    )

    const text = await r.text()

    // デバッグ用（超重要）
    console.log('BOSS RAW RESPONSE:', text)

    try {
      const json = JSON.parse(text)
      return res.status(200).json(json)
    } catch {
      return res.status(500).json({
        error: 'non-json response from BOSS',
        raw: text
      })
    }

  } catch (e) {
    console.error('orders/get error', e)
    return res.status(500).json({ error: 'internal error', detail: String(e) })
  }
}
