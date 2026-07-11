import type { Response } from 'express';

/** 200 with the `{ data, meta? }` envelope. */
export function ok<T>(res: Response, data: T, meta?: unknown): void {
  if (meta === undefined) {
    res.status(200).json({ data });
  } else {
    res.status(200).json({ data, meta });
  }
}

/** 201 with the `{ data }` envelope. */
export function created<T>(res: Response, data: T): void {
  res.status(201).json({ data });
}

/** 202 Accepted — for enqueued async work. */
export function accepted<T>(res: Response, data: T): void {
  res.status(202).json({ data });
}

export function noContent(res: Response): void {
  res.status(204).end();
}
