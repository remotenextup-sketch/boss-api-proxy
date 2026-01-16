// api/boss/orders/get.ts（修正版）
import fetch from 'node-fetch'
import { getAccessToken } from '../token'

export default async function handler(req, res) {
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
  try {
    return res.status(200).json(JSON.parse(text))
  } catch {
    return res.status(500).json({
      error: 'non-json response from BOSS',
      raw: text
    })
  }
}
