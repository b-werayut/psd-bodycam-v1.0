/** Serialize bigint as string in JSON (ids are exposed as strings). Idempotent. */
export function installBigIntJson(): void {
  (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
    return this.toString();
  };
}
