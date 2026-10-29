// BOSS の OAuth で使う使い捨て state (oauth/auto で作り、oauth/callback で 1 回だけ使う)
export const OAUTH_STATE_PREFIX = "boss:oauth_state:";
export const OAUTH_STATE_TTL_SEC = 600;
