import { customAlphabet } from 'nanoid';

/** URL-safe ids. The alphabet matches `parseDocName`'s validation in `@aimarkdown/shared`. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';

export const newId = customAlphabet(ALPHABET, 21);
export const newShortId = customAlphabet(ALPHABET, 12);
