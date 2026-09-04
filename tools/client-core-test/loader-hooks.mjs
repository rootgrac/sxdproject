/**
 * 测试专用 ESM resolve hook：
 * client/assets/scripts 下的代码按 Cocos 惯例使用无扩展名相对 import（'./sha256'），
 * Node ESM 无法解析 → 这里尝试追加 .ts 后交给默认解析器。
 * 仅由 tools/client-core-test 的测试命令启用（--import loader-entry.mjs），不进入游戏运行时。
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    for (const cand of [specifier, `${specifier}.ts`, `${specifier}.js`]) {
      try {
        return await nextResolve(cand, context);
      } catch (err) {
        if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
      }
    }
  }
  return nextResolve(specifier, context);
}
