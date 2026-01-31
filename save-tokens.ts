import { setTokens } from './lib/token-store.ts';

async function main() {
  await setTokens({
    accessToken: 'xxx',
    refreshToken: 'yyy',
  });
  console.log('KVに保存完了');
}

main();

