import { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { code } = req.query;
  res.status(200).send("OAuth callback received");
}
