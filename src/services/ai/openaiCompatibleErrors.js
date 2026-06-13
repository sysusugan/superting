function formatOpenAiCompatibleError({ status, fallbackMessage, isCustomProvider }) {
  if (isCustomProvider && status === 401) {
    return "Custom provider authentication failed (401). Check the custom endpoint API key and make sure it belongs to that provider.";
  }

  return fallbackMessage;
}

module.exports = { formatOpenAiCompatibleError };
