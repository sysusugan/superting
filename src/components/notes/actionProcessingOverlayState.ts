import type { ActionProcessingState } from "../../hooks/useActionProcessing";

export function shouldShowActionProcessingOverlay(
  state: ActionProcessingState,
  isFadingOut: boolean
): boolean {
  return state === "processing" || state === "success" || isFadingOut;
}
