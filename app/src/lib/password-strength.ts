import { ZxcvbnFactory, type ZxcvbnResult } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';

import leaked from './leaked-passwords.json';

/**
 * Password rules, checked on the phone only: with OPAQUE the server never sees the password, so it can't check it.
 * Following NIST SP 800-63B: a minimum length, no composition rules (symbols and capitals are not required), and a
 * blocklist of passwords from breaches. On top, zxcvbn estimates how guessable it is and must score at least 3 of 4,
 * which refuses keyboard patterns, repeats, dates, dictionary words and anything built from the handle.
 *
 * The blocklist is zxcvbn's own (~49k) plus the UK NCSC's top 100,000 passwords from Have I Been Pwned, minus the ones
 * already in zxcvbn's (leaked-passwords.json, lowercased; via SecLists, MIT). Nothing is sent anywhere.
 */
export const MIN_PASSWORD = 12;
const MIN_SCORE = 3;

export type PasswordCheck = {
  ok: boolean;
  /** zxcvbn's 0–4, for the strength meter. */
  score: 0 | 1 | 2 | 3 | 4;
  /** Why it isn't accepted yet. */
  problem?: string;
};

let factory: ZxcvbnFactory | null = null;
let blocklist: Set<string> | null = null;

// Built on first use: the dictionaries take a moment to load, and most screens never need them.
function setup() {
  if (!factory || !blocklist) {
    factory = new ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...en.dictionary, 'passwords-leaked': leaked as string[] },
      graphs: common.adjacencyGraphs,
      translations: { ...en.translations, warnings: { ...en.translations.warnings, userInputs: 'Don’t use your handle in your password.' } },
    });
    blocklist = new Set([...(common.dictionary['passwords-common'] as string[]), ...(leaked as string[])]);
  }
  return { factory, blocklist };
}

export function checkPassword(password: string, handle?: string): PasswordCheck {
  if (!password) return { ok: false, score: 0 };
  const { factory, blocklist } = setup();
  const result: ZxcvbnResult = factory.check(password, handle ? [handle, 'circlo'] : ['circlo']);
  const score = result.score as PasswordCheck['score'];
  if (blocklist.has(password.toLowerCase())) {
    return { ok: false, score: 0, problem: 'This password has appeared in data breaches. Choose another.' };
  }
  if ([...password].length < MIN_PASSWORD) {
    return { ok: false, score, problem: `Use at least ${MIN_PASSWORD} characters. A few random words work well.` };
  }
  if (score < MIN_SCORE) {
    const warning = result.feedback.warning;
    return { ok: false, score, problem: `${warning ? `${warning} ` : ''}Add another word or two to make it harder to guess.` };
  }
  return { ok: true, score };
}
