/**
 * 密码强度检测（纯前端实现）。
 *
 * 逻辑移植自 60s 服务的 /password/check（password.module.ts）：
 * - score 计分：长度加权 + 字符类型加分 + 多样性加分 + 长度档位加分，
 *   重复字符 -10、连续序列 -15、命中常见密码表 -20；
 * - entropy：length * log2(字符集大小)，按 0.01 精度四舍五入；
 * - time_to_crack：按 2^entropy / (2 × 10^9 次/秒) 平均破解时间估算；
 * - recommendations / security_tips 生成规则与 60s 保持一致。
 *
 * 密码不会离开浏览器，全部在本地计算。
 */

import commonPasswordsData from './passwords.json';

export interface CharacterAnalysis {
  has_lowercase: boolean;
  has_uppercase: boolean;
  has_numbers: boolean;
  has_symbols: boolean;
  has_repeated: boolean;
  has_sequential: boolean;
  character_variety: number;
}

export interface PasswordStrengthResult {
  password: string;
  length: number;
  score: number;
  strength: string;
  description: string;
  entropy: number;
  time_to_crack: string;
  character_analysis: CharacterAnalysis;
  recommendations: string[];
  security_tips: string[];
}

interface ScoreAnalysis {
  hasLowercase: boolean;
  hasUppercase: boolean;
  hasNumbers: boolean;
  hasSymbols: boolean;
  hasRepeated: boolean;
  hasSequential: boolean;
  length: number;
}

interface RecommendationAnalysis extends ScoreAnalysis {
  score: number;
}

/** 攻击者按 10 亿次/秒暴力尝试时的平均破解时间（秒）。 */
const ATTEMPTS_PER_SECOND = 1_000_000_000;
const SECOND = 1;
const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;
const YEAR = 31_536_000;
const CENTURY = 31_536_000_000;

const SEQUENCES = [
  'abcdefghijklmnopqrstuvwxyz',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '0123456789',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

const calculateEntropy = (password: string, charsetSize: number): number => {
  if (charsetSize === 0) {
    return 0;
  }
  return Math.round(password.length * Math.log2(charsetSize) * 100) / 100;
};

const getStrengthFromScore = (score: number): { level: string; description: string } => {
  if (score < 30) {
    return { level: '极弱', description: '密码过于简单，需要立即改进' };
  }
  if (score < 50) {
    return { level: '弱', description: '密码强度不足，建议增强' };
  }
  if (score < 70) {
    return { level: '中等', description: '密码强度一般，可以进一步改进' };
  }
  if (score < 85) {
    return { level: '强', description: '密码强度良好' };
  }
  return { level: '极强', description: '密码强度优秀' };
};

const getTimeToCrack = (entropy: number): string => {
  const combinations = Math.pow(2, entropy);
  const secondsToCrack = combinations / (2 * ATTEMPTS_PER_SECOND);

  if (secondsToCrack < SECOND) {
    return '< 1秒';
  }
  if (secondsToCrack < MINUTE) {
    return `${Math.round(secondsToCrack)}秒`;
  }
  if (secondsToCrack < HOUR) {
    return `${Math.round(secondsToCrack / MINUTE)}分钟`;
  }
  if (secondsToCrack < DAY) {
    return `${Math.round(secondsToCrack / HOUR)}小时`;
  }
  if (secondsToCrack < YEAR) {
    return `${Math.round(secondsToCrack / DAY)}天`;
  }
  if (secondsToCrack < CENTURY) {
    return `${Math.round(secondsToCrack / YEAR)}年`;
  }
  return '数百万年';
};

/** 连续 3 个相同字符视为重复。 */
const hasRepeatedChars = (password: string): boolean => {
  for (let i = 0; i < password.length - 2; i++) {
    if (password[i] === password[i + 1] && password[i] === password[i + 2]) {
      return true;
    }
  }
  return false;
};

/** 命中字母序 / 数字序 / 键盘行序中任意 3 连（正序或逆序）视为连续。 */
const hasSequentialChars = (password: string): boolean => {
  for (const sequence of SEQUENCES) {
    for (let i = 0; i <= sequence.length - 3; i++) {
      const subSequence = sequence.substring(i, i + 3);
      if (
        password.includes(subSequence) ||
        password.includes(subSequence.split('').reverse().join(''))
      ) {
        return true;
      }
    }
  }
  return false;
};

/** 命中常见密码表（含键盘模式、中文常见密码、常用名、常用词）。 */
const isCommonPassword = (password: string): boolean => {
  const lowerPassword = password.toLowerCase();

  return (
    commonPasswordsData.keyboard_patterns.some(
      (pattern) =>
        lowerPassword.includes(pattern) || pattern.includes(lowerPassword),
    ) ||
    commonPasswordsData.common_passwords.includes(lowerPassword) ||
    commonPasswordsData.chinese_common_passwords.includes(lowerPassword) ||
    commonPasswordsData.common_names.includes(lowerPassword) ||
    commonPasswordsData.common_words.includes(lowerPassword)
  );
};

const calculatePasswordScore = (analysis: ScoreAnalysis): number => {
  let score = 0;

  score += analysis.length * 4;

  if (analysis.hasLowercase) {
    score += 2;
  }
  if (analysis.hasUppercase) {
    score += 2;
  }
  if (analysis.hasNumbers) {
    score += 4;
  }
  if (analysis.hasSymbols) {
    score += 6;
  }

  const varietyCount = [
    analysis.hasLowercase,
    analysis.hasUppercase,
    analysis.hasNumbers,
    analysis.hasSymbols,
  ].filter(Boolean).length;
  score += varietyCount * 2;

  if (analysis.length >= 8) {
    score += 5;
  }
  if (analysis.length >= 12) {
    score += 5;
  }
  if (analysis.length >= 16) {
    score += 5;
  }

  return score;
};

const getPasswordRecommendations = (
  password: string,
  analysis: RecommendationAnalysis,
): string[] => {
  const recommendations: string[] = [];

  if (analysis.length < 8) {
    recommendations.push('建议密码长度至少 8 位');
  } else if (analysis.length < 12) {
    recommendations.push('建议密码长度至少 12 位以获得更好安全性');
  }

  if (!analysis.hasLowercase) {
    recommendations.push('建议包含小写字母');
  }
  if (!analysis.hasUppercase) {
    recommendations.push('建议包含大写字母');
  }
  if (!analysis.hasNumbers) {
    recommendations.push('建议包含数字');
  }
  if (!analysis.hasSymbols) {
    recommendations.push('建议包含特殊符号');
  }

  if (analysis.hasRepeated) {
    recommendations.push('避免连续重复字符');
  }
  if (analysis.hasSequential) {
    recommendations.push('避免使用连续序列字符');
  }

  if (isCommonPassword(password)) {
    recommendations.push('避免使用常见密码');
  }

  if (analysis.score >= 85) {
    recommendations.push('密码强度已经很好！');
  }

  return recommendations;
};

const getSecurityTips = (): string[] => [
  '使用密码管理器生成和存储复杂密码',
  '为不同账户使用不同的密码',
  '定期更换重要账户的密码',
  '启用双因素认证（2FA）增强安全性',
  '避免在公共场合输入密码',
  '不要将密码保存在浏览器中（除非使用可信的密码管理器）',
  '避免使用个人信息作为密码',
  '长密码比复杂密码更安全',
];

const EMPTY_RESULT: PasswordStrengthResult = {
  password: '',
  length: 0,
  score: 0,
  strength: '极弱',
  description: '密码过于简单，需要立即改进',
  entropy: 0,
  time_to_crack: '< 1秒',
  character_analysis: {
    has_lowercase: false,
    has_uppercase: false,
    has_numbers: false,
    has_symbols: false,
    has_repeated: false,
    has_sequential: false,
    character_variety: 0,
  },
  recommendations: [],
  security_tips: [],
};

export const checkPasswordStrength = (
  password: string,
): PasswordStrengthResult => {
  // 空输入直接返回空结果，避免触发常见密码表的空串匹配。
  if (!password) {
    return EMPTY_RESULT;
  }

  const length = password.length;
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSymbols = /[^a-zA-Z0-9]/.test(password);
  const repeated = hasRepeatedChars(password);
  const sequential = hasSequentialChars(password);

  let characterVariety = 0;
  if (hasLowercase) {
    characterVariety += 26;
  }
  if (hasUppercase) {
    characterVariety += 26;
  }
  if (hasNumbers) {
    characterVariety += 10;
  }
  if (hasSymbols) {
    characterVariety += 32;
  }

  const entropy = calculateEntropy(password, characterVariety);
  const scoreAnalysis: ScoreAnalysis = {
    hasLowercase,
    hasUppercase,
    hasNumbers,
    hasSymbols,
    hasRepeated: repeated,
    hasSequential: sequential,
    length,
  };

  let score = calculatePasswordScore(scoreAnalysis);

  if (repeated) {
    score -= 10;
  }
  if (sequential) {
    score -= 15;
  }
  if (isCommonPassword(password)) {
    score -= 20;
  }

  score = Math.max(0, Math.min(100, score));

  const strength = getStrengthFromScore(score);
  const timeToCrack = getTimeToCrack(entropy);
  const recommendations = getPasswordRecommendations(password, {
    ...scoreAnalysis,
    score,
  });

  return {
    password,
    length,
    score,
    strength: strength.level,
    description: strength.description,
    entropy,
    time_to_crack: timeToCrack,
    character_analysis: {
      has_lowercase: hasLowercase,
      has_uppercase: hasUppercase,
      has_numbers: hasNumbers,
      has_symbols: hasSymbols,
      has_repeated: repeated,
      has_sequential: sequential,
      character_variety: characterVariety,
    },
    recommendations,
    security_tips: getSecurityTips(),
  };
};
