import { connect, cleanupE2E } from './lib.mjs';
const c = await connect(); console.log('удалено тестовых учеников:', await cleanupE2E(c));
