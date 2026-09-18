export interface CustomModelOption {
  value: string;
}

/** Keep a valid custom model selected while an endpoint's model list changes. */
export function selectCustomModel(
  currentModel: string,
  models: readonly CustomModelOption[]
): string {
  const current = currentModel.trim();
  if (current && models.some((model) => model.value === current)) {
    return current;
  }
  return models[0]?.value || "";
}
