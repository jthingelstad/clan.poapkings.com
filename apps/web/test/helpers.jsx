import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "elixir-mcp/packages/client/src/index.ts";

/**
 * Render a view the way the app renders it: inside a query provider.
 * A fresh client per render, so nothing a previous test fetched can be
 * served from cache here. Retries are off: a test that mocks a failure
 * wants to see the failure, not wait 1.5 s for the second try.
 */
export function renderWithProviders(ui, options) {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  const wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...render(ui, { wrapper, ...options }), queryClient: client };
}
