/**
 * 爻 · 表达式 AST 求值（编译期常量与运行期共用）
 *
 * 值域：所有 6 位值在运算中一律 & 0x3F；`变(a, b)` 是唯一产生 12 位值的构造。
 */

import { cuo, zong, hu, bianShu, dangWei, xu, ben, dong, zhi } from './core.js';

export class EvalAstError extends Error {
  constructor(msg, code = 'Y0910') {
    super(msg);
    this.name = 'EvalAstError';
    this.code = code;
  }
}

const M = 0x3f;

const SIX = (v) => ((v | 0) & M);

/**
 * @param {object} ast
 * @param {{ben?: number, params?: Record<string, number>}} env
 * @returns {number}
 */
export function evalAst(ast, env = {}) {
  switch (ast.t) {
    case 'lit':
      return ast.kind === 'bian' ? ast.v : SIX(ast.v);

    case 'ben':
      if (env.ben === undefined) throw new EvalAstError('`本` 只能出现在转移目标里');
      return SIX(env.ben);

    case 'state':
      if (env.state === undefined) throw new EvalAstError('`变` 只能出现在转移目标里');
      return env.state;

    case 'var': {
      const v = env.params?.[ast.name] ?? env.consts?.[ast.name];
      if (v === undefined) throw new EvalAstError(`未定义的名字 "${ast.name}"（Y0014）`);
      // 不做掩码：态名可能是一个带动爻的 变，裸返回才能保住 12 位
      return v;
    }

    case 'un': {
      const x = SIX(evalAst(ast.x, env));
      return ast.op === '~' ? ~x & M : -x & M;
    }

    case 'bin': {
      const a = SIX(evalAst(ast.l, env));
      const b = SIX(evalAst(ast.r, env));
      switch (ast.op) {
        case '+': return (a + b) & M;
        case '-': return (a - b) & M;
        case '*': return (a * b) & M;
        case '&': return a & b;
        case '|': return a | b;
        case '^': return a ^ b;
        case '<<': return (a << b) & M;
        case '>>': return (a >> b) & M;
        // 比较：结果为 1 / 0，不参与 6 位算术
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        default: throw new EvalAstError(`未知运算符 "${ast.op}"`);
      }
    }

    case 'if': {
      const c = SIX(evalAst(ast.cond, env));
      return evalAst(c !== 0 ? ast.then : ast.otherwise, env);
    }

    case 'match': {
      const v = SIX(evalAst(ast.subject, env));
      for (const arm of ast.arms) {
        if (arm.pattern !== null && arm.pattern === v) return evalAst(arm.body, env);
      }
      for (const arm of ast.arms) {
        if (arm.pattern === null) return evalAst(arm.body, env);
      }
      throw new EvalAstError(`合 没有匹配的分支（值为 ${v}）（Y0201）`, 'Y0201');
    }

    case 'call': {
      const args = ast.args.map((a) => evalAst(a, env));
      return callBuiltin(ast.name, args, ast.tok);
    }

    default:
      throw new EvalAstError(`未知表达式节点 "${ast.t}"`);
  }
}

const ARITY = {
  变: 2, 静: 1, 错: 1, 综: 1, 互: 1, 变数: 1, 当位: 1, 卦: 1, 数: 1, 爻: 2,
  本: 1, 动: 1, 之: 1,
};

function callBuiltin(name, args, tok) {
  const want = ARITY[name];
  if (want === undefined) {
    throw new EvalAstError(`未知函数 "${name}"（第 ${tok?.line ?? '?'} 行）`, 'Y0014');
  }
  if (args.length !== want) {
    throw new EvalAstError(`${name} 需要 ${want} 个参数，收到 ${args.length} 个`);
  }

  switch (name) {
    case '变': return SIX(args[0]) | (SIX(args[1]) << 6);
    case '静': return SIX(args[0]);
    case '错': return cuo(SIX(args[0]));
    case '综': return zong(SIX(args[0]));
    case '互': return hu(SIX(args[0]));
    case '变数': return bianShu(args[0]);
    case '当位': return dangWei(SIX(args[0]));
    case '卦': return SIX(args[0]);
    case '数': return SIX(args[0]);
    case '本': return ben(args[0]);
    case '动': return dong(args[0]);
    case '之': return zhi(args[0]);
    case '爻': {
      const p = SIX(args[1]);
      if (p < 1 || p > 6) throw new EvalAstError(`爻位必须是 1..6，得到 ${p}`);
      const yang = (ben(args[0]) >> (p - 1)) & 1;
      const moving = (dong(args[0]) >> (p - 1)) & 1;
      return yang ? (moving ? 9 : 7) : moving ? 6 : 8;
    }
    default:
      throw new EvalAstError(`未实现的函数 "${name}"`);
  }
}

export { xu };
