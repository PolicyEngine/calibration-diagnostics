import { useMutation } from "@tanstack/react-query";
import { apiPost } from "../client";
import type { DecomposeResult } from "../types";

export function useDecompose() {
  return useMutation({
    mutationFn: (body: { variable: string; subgroup?: string }) =>
      apiPost<DecomposeResult>("/decompose", body),
  });
}
