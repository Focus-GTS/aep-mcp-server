import { z } from "zod";

export const paginationSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum number of results to return (1-100)"),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip for pagination"),
};

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  results: T[];
  count: number;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export function buildPaginatedResponse<T>(
  results: T[],
  total: number,
  params: PaginationParams,
): PaginatedResponse<T> {
  return {
    results,
    count: results.length,
    total,
    offset: params.offset,
    limit: params.limit,
    hasMore: params.offset + results.length < total,
  };
}
