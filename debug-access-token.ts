import { getValidAccessToken } from '../lib/accessTokenStore.ts';

async function main() {
  const token = await getValidAccessToken();
  console.log(token);
}

main();

