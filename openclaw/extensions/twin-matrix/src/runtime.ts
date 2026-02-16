const DEFAULT_BACKEND_URL = "http://localhost:3400";

let _backendUrl: string = DEFAULT_BACKEND_URL;

export function configureRuntime(opts: { backendUrl?: string }): void {
  if (opts.backendUrl) {
    _backendUrl = opts.backendUrl;
  }
}

export function getBackendUrl(): string {
  return process.env.TWIN_MATRIX_BACKEND_URL ?? _backendUrl;
}
