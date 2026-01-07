// api/boss/oauth/callback.js
export default function handler(req, res) {
  // 申請用URLとして存在していればOK
  // client_credentials を使う限り、ここは呼ばれないため
  res.status(200).json({ message: "Callback endpoint is active" });
}
