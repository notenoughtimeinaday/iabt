// Keep browser feedback and server delivery validation consistent. Plus-addresses
// remain distinct accounts; never strip punctuation to guess a different address.
export const isValidAccountEmail = (value) => typeof value === "string"
  && value.trim().length <= 254
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
