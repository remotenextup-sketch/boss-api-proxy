import { redisClient } from './redis';

(async () => {
  await redisClient.set(
    'refresh_token',
    'eyJhbGciOiJIUzUxMiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJhNTEwOTY4Yy1hZDUzLTRmYzgtODE2Ny01YTE1MTk1NWQ4ZjMifQ...'
  );
  console.log('初期 refresh_token を Redis にセットしました');
  process.exit(0);
})();
