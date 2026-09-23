import { notFound } from "next/navigation";
import { ApiError } from "./api";

// A screen either has its record or says why not. An unreachable engine is a
// state the screen shows; a missing id is a 404; anything else is an error.

export async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 404) notFound();
      throw e;
    }
    // fetch() failed outright: the engine is not running.
    return null;
  }
}
