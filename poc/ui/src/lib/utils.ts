import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Same helper as Holotable's src/lib/utils.ts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
