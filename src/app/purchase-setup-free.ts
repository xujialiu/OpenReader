/** Free/Debug startup does not construct storage, a purchase controller or a native listener. */
export function startPurchases(): () => void {
  return () => {};
}
