import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDataStore, StoreError } from './store.mjs';

function usage() {
  console.error('用法: node apps/server/cli.mjs create-account --username <用户名> [--password <密码>] [--data <目录>]');
  console.error('未提供 --password 时，从环境变量 LUMAMARK_PASSWORD 读取密码。');
}

function optionsFrom(args) {
  if (args[0] !== 'create-account') return null;
  const options = {};
  for (let index = 1; index < args.length; index += 1) {
    const key = args[index];
    if (key !== '--username' && key !== '--password' && key !== '--data') {
      throw new Error(`无法识别 ${key}`);
    }
    const value = args[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`缺少 ${key}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

export async function createAccountCommand(args, env = process.env) {
  const options = optionsFrom(args);
  if (!options || !options['--username']) {
    usage();
    return 1;
  }
  const password = options['--password'] ?? env.LUMAMARK_PASSWORD;
  if (!password) {
    console.error('需要 --password 或环境变量 LUMAMARK_PASSWORD');
    return 1;
  }
  const dataDir = resolve(options['--data'] || env.LUMAMARK_DATA || 'data');
  const store = openDataStore(dataDir);
  try {
    const account = await store.createAccount(options['--username'], password);
    console.log(`created ${account.username}`);
    return 0;
  } catch (error) {
    if (error instanceof StoreError && error.code === 'account_exists') console.error('账号已存在');
    else if (error instanceof StoreError && error.code === 'invalid_account') console.error('用户名或密码无效');
    else console.error(error instanceof Error ? error.message : '创建账号失败');
    return 1;
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  try {
    process.exitCode = await createAccountCommand(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : '创建账号失败');
    process.exitCode = 1;
  }
}
